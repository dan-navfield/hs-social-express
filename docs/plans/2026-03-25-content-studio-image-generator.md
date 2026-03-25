# Content Studio & Image Generator — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port the Content Studio homepage and Image Studio (AI image generator with single/carousel modes, logo overlay, reference images) from Frame the Fairway into HS Social Express.

**Architecture:** The FTF version uses Next.js API routes — we convert these to Supabase Edge Functions (Deno). The FTF UI components are React with dark theme — we adapt them to match HS Social Express's light theme with teal accent. The client-side logo overlay and comparison view port directly. A new `content_assets` table stores generated images.

**Tech Stack:** React + Vite, Supabase Edge Functions (Deno), Google Gemini API (image gen), Supabase Storage, Tailwind CSS

---

## Key Differences: FTF → HS Social Express

| Concern | Frame the Fairway | HS Social Express |
|---------|------------------|-------------------|
| API routes | Next.js `/api/...` (Node) | Supabase Edge Functions (Deno) |
| Data fetching | SWR hooks | Direct Supabase client calls |
| Theme | Dark (#0a0a0a, gold #c9a962) | Light (white, teal `var(--color-primary)`) |
| Logo paths | `/images/logo/ftf-logo-{variant}.svg` | Brand assets from Supabase Storage |
| Auth | `requireStaff('content.edit')` | Supabase auth (session-based) |
| Animation | Framer Motion | CSS transitions (no framer-motion dep) |
| Routing | Next.js App Router | React Router |

---

### Task 1: Create `content_assets` Table Migration

**Files:**
- Create: `supabase/migrations/20260325000000_content_assets.sql`

**Step 1: Write the migration**

```sql
-- Content assets table for Image Studio and uploaded media
CREATE TABLE IF NOT EXISTS content_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    public_url TEXT,
    mime_type TEXT NOT NULL DEFAULT 'image/png',
    file_size INTEGER,
    tags TEXT[] DEFAULT '{}',
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_content_assets_space ON content_assets(space_id);
CREATE INDEX idx_content_assets_tags ON content_assets USING GIN(tags);
```

**Step 2: Apply migration**

The migration history is out of sync so we can't use `supabase db push`. Apply via the Supabase Dashboard SQL Editor, or use the JS client to run raw SQL via RPC. Alternatively, create the table via the Supabase client:

```bash
# Via Supabase Dashboard > SQL Editor, paste the migration SQL
```

**Step 3: Commit**

```bash
git add supabase/migrations/20260325000000_content_assets.sql
git commit -m "feat: add content_assets table for Image Studio"
```

---

### Task 2: Create `image-studio-generate` Edge Function

This is the core image generation backend. It takes a prompt, optional reference images, and aspect ratio, calls Gemini, stores the result in Supabase Storage, and creates a `content_assets` record.

**Files:**
- Create: `supabase/functions/image-studio-generate/index.ts`

**Step 1: Write the edge function**

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const VALID_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:5', '3:4'] as const

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { prompt, aspect_ratio, reference_image_urls, space_id } = await req.json()

        if (!prompt?.trim()) {
            return new Response(
                JSON.stringify({ error: 'prompt is required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }
        if (!space_id) {
            return new Response(
                JSON.stringify({ error: 'space_id is required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const resolvedRatio = aspect_ratio || '1:1'
        if (!VALID_ASPECT_RATIOS.includes(resolvedRatio)) {
            return new Response(
                JSON.stringify({ error: `Invalid aspect_ratio. Must be one of: ${VALID_ASPECT_RATIOS.join(', ')}` }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
        if (!geminiApiKey) {
            return new Response(
                JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Fetch reference images and convert to base64 (max 3)
        const referenceImages: { data: string; mimeType: string }[] = []
        if (reference_image_urls?.length) {
            for (const url of (reference_image_urls as string[]).slice(0, 3)) {
                try {
                    const refRes = await fetch(url)
                    if (!refRes.ok) continue
                    const refBuffer = await refRes.arrayBuffer()
                    const refMimeType = refRes.headers.get('content-type') || 'image/png'
                    const base64 = btoa(String.fromCharCode(...new Uint8Array(refBuffer)))
                    referenceImages.push({ data: base64, mimeType: refMimeType })
                } catch {
                    // Skip failed reference fetches
                }
            }
        }

        // Build Gemini request
        const model = 'gemini-2.5-flash-image'
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`

        const parts = [
            ...referenceImages.map(ref => ({
                inlineData: { data: ref.data, mimeType: ref.mimeType },
            })),
            { text: prompt.trim() },
        ]

        const body = {
            contents: [{ parts }],
            generationConfig: {
                responseModalities: ['IMAGE', 'TEXT'],
                imageConfig: { aspectRatio: resolvedRatio },
            },
        }

        // Retry up to 3 times on rate-limit
        let lastError: string | null = null
        let imageData: string | null = null
        let imageMimeType = 'image/png'

        for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) {
                await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1)))
            }

            const geminiRes = await fetch(geminiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })

            if (geminiRes.status === 429 || geminiRes.status === 503) {
                lastError = `Gemini rate limited (${geminiRes.status})`
                continue
            }

            if (!geminiRes.ok) {
                const errorBody = await geminiRes.text()
                console.error('[image-studio] Gemini error:', geminiRes.status, errorBody)
                return new Response(
                    JSON.stringify({ error: `Gemini API error (${geminiRes.status})` }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            const data = await geminiRes.json()
            const responseParts = data.candidates?.[0]?.content?.parts ?? []

            for (const part of responseParts) {
                if (part.inlineData) {
                    imageData = part.inlineData.data
                    imageMimeType = part.inlineData.mimeType || 'image/png'
                    break
                }
            }

            if (imageData) break
            lastError = 'Gemini returned no images'
        }

        if (!imageData) {
            return new Response(
                JSON.stringify({ error: lastError || 'Image generation failed after retries' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Decode base64 to Uint8Array
        const binaryStr = atob(imageData)
        const bytes = new Uint8Array(binaryStr.length)
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i)
        }

        // Upload to Supabase Storage
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseKey)

        const timestamp = Date.now()
        const random = Math.random().toString(36).substring(2, 10)
        const extension = imageMimeType === 'image/jpeg' ? 'jpg' : 'png'
        const storagePath = `image-studio/${space_id}/${timestamp}-${random}.${extension}`
        const filename = `${timestamp}-${random}.${extension}`

        const { error: uploadError } = await supabase.storage
            .from('generated-images')
            .upload(storagePath, bytes, { contentType: imageMimeType, upsert: true })

        if (uploadError) {
            console.error('[image-studio] Upload error:', uploadError)
            return new Response(
                JSON.stringify({ error: 'Failed to upload generated image' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
            .from('generated-images')
            .getPublicUrl(storagePath)

        // Create content_assets record
        const { data: asset, error: dbError } = await supabase
            .from('content_assets')
            .insert({
                space_id,
                filename,
                storage_path: storagePath,
                public_url: publicUrl,
                mime_type: imageMimeType,
                file_size: bytes.length,
                tags: ['image-studio', `ratio:${resolvedRatio}`],
            })
            .select('id')
            .single()

        if (dbError) {
            console.error('[image-studio] DB error:', dbError)
            return new Response(
                JSON.stringify({ error: 'Failed to save asset record' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        return new Response(
            JSON.stringify({
                success: true,
                asset: {
                    id: asset.id,
                    publicUrl,
                    storagePath,
                },
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    } catch (error) {
        console.error('[image-studio] Error:', error)
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
```

**Step 2: Deploy**

```bash
supabase functions deploy image-studio-generate --project-ref dbfrxagaccnitfpdtpen
```

**Step 3: Commit**

```bash
git add supabase/functions/image-studio-generate/index.ts
git commit -m "feat: add image-studio-generate edge function with Gemini"
```

---

### Task 3: Create `image-studio-split-prompt` Edge Function

Splits a single carousel prompt into multiple slide-specific prompts via Gemini.

**Files:**
- Create: `supabase/functions/image-studio-split-prompt/index.ts`

**Step 1: Write the edge function**

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { prompt, slide_count = 4 } = await req.json()

        if (!prompt?.trim()) {
            return new Response(
                JSON.stringify({ error: 'prompt is required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const geminiApiKey = Deno.env.get('GEMINI_API_KEY')
        if (!geminiApiKey) {
            return new Response(
                JSON.stringify({ error: 'GEMINI_API_KEY not configured' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`

        const splitPrompt = `You are helping create a carousel of ${slide_count} images that tell a visual story.

Given this description: "${prompt.trim()}"

Split it into ${slide_count} sequential moments that would make a compelling carousel. Each slide should:
- Represent a distinct moment in the sequence
- Work as a standalone image
- Progress the story naturally
- Maintain consistent style, lighting, and subjects across all slides

Return ONLY a JSON array of strings, each being a detailed image generation prompt for that slide. No other text.

Example format: ["Slide 1 detailed prompt...", "Slide 2 detailed prompt...", "Slide 3 detailed prompt...", "Slide 4 detailed prompt..."]`

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: splitPrompt }] }],
                generationConfig: { responseMimeType: 'application/json' },
            }),
        })

        if (!res.ok) {
            const errorBody = await res.text()
            console.error('[split-prompt] Gemini error:', res.status, errorBody)
            return new Response(
                JSON.stringify({ error: 'Failed to split prompt' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const data = await res.json()
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text

        const slides = JSON.parse(text)
        if (!Array.isArray(slides)) throw new Error('Not an array')

        return new Response(
            JSON.stringify({ success: true, slides: slides.map(String) }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    } catch (error) {
        console.error('[split-prompt] Error:', error)
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to parse slide prompts' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
```

**Step 2: Deploy**

```bash
supabase functions deploy image-studio-split-prompt --project-ref dbfrxagaccnitfpdtpen
```

**Step 3: Commit**

```bash
git add supabase/functions/image-studio-split-prompt/index.ts
git commit -m "feat: add image-studio-split-prompt edge function for carousel"
```

---

### Task 4: Create `image-studio-upload` Edge Function

Handles manual image uploads to the content asset library.

**Files:**
- Create: `supabase/functions/image-studio-upload/index.ts`

**Step 1: Write the edge function**

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const formData = await req.formData()
        const file = formData.get('file') as File | null
        const spaceId = formData.get('space_id') as string | null
        const tagsJson = formData.get('tags') as string | null

        if (!file || !spaceId) {
            return new Response(
                JSON.stringify({ error: 'file and space_id are required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (!file.type.startsWith('image/')) {
            return new Response(
                JSON.stringify({ error: 'Only image files are accepted' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (file.size > 10 * 1024 * 1024) {
            return new Response(
                JSON.stringify({ error: 'File too large (max 10MB)' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseKey)

        const bytes = new Uint8Array(await file.arrayBuffer())
        const timestamp = Date.now()
        const random = Math.random().toString(36).substring(2, 10)
        const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png'
        const storagePath = `image-studio/${spaceId}/uploads/${timestamp}-${random}.${ext}`
        const filename = `${timestamp}-${random}.${ext}`

        const { error: uploadError } = await supabase.storage
            .from('generated-images')
            .upload(storagePath, bytes, { contentType: file.type, upsert: true })

        if (uploadError) {
            return new Response(
                JSON.stringify({ error: 'Upload failed' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const { data: { publicUrl } } = supabase.storage
            .from('generated-images')
            .getPublicUrl(storagePath)

        const tags = tagsJson ? JSON.parse(tagsJson) : ['uploaded']

        const { data: asset, error: dbError } = await supabase
            .from('content_assets')
            .insert({
                space_id: spaceId,
                filename,
                storage_path: storagePath,
                public_url: publicUrl,
                mime_type: file.type,
                file_size: bytes.length,
                tags,
            })
            .select('id')
            .single()

        if (dbError) {
            return new Response(
                JSON.stringify({ error: 'Failed to save asset record' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        return new Response(
            JSON.stringify({ success: true, asset: { id: asset.id, publicUrl, storagePath } }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    } catch (error) {
        console.error('[image-studio-upload] Error:', error)
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Upload failed' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
```

**Step 2: Deploy**

```bash
supabase functions deploy image-studio-upload --project-ref dbfrxagaccnitfpdtpen
```

**Step 3: Commit**

```bash
git add supabase/functions/image-studio-upload/index.ts
git commit -m "feat: add image-studio-upload edge function for manual uploads"
```

---

### Task 5: Create Logo Overlay Utility

Port the client-side canvas-based logo overlay from FTF. Adapt logo paths to use brand assets from Supabase Storage instead of static files.

**Files:**
- Create: `src/lib/logo-overlay.ts`

**Step 1: Write the utility**

```typescript
export type LogoVariant = 'light' | 'dark'

export type LogoPosition =
    | 'tl' | 'tc' | 'tr'
    | 'cl' | 'cc' | 'cr'
    | 'bl' | 'bc' | 'br'

export const LOGO_POSITIONS: LogoPosition[] = [
    'tl', 'tc', 'tr',
    'cl', 'cc', 'cr',
    'bl', 'bc', 'br',
]

export const POSITION_LABELS: Record<LogoPosition, string> = {
    tl: 'TL', tc: 'TC', tr: 'TR',
    cl: 'CL', cc: 'CC', cr: 'CR',
    bl: 'BL', bc: 'BC', br: 'BR',
}

/**
 * Composites a logo onto an image at a given position.
 * Logo sizing: 12% of image width, 3% padding from edges.
 */
export async function applyLogoToImage(
    imageUrl: string,
    logoUrl: string,
    position: LogoPosition,
): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new window.Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            const ctx = canvas.getContext('2d')!
            ctx.drawImage(img, 0, 0)

            const logo = new window.Image()
            logo.crossOrigin = 'anonymous'
            logo.onload = () => {
                const logoW = Math.round(canvas.width * 0.12)
                const logoH = Math.round(logoW * (logo.naturalHeight / logo.naturalWidth))
                const pad = Math.round(canvas.width * 0.03)

                let x = pad, y = pad
                if (position.endsWith('c')) x = (canvas.width - logoW) / 2
                if (position.endsWith('r')) x = canvas.width - logoW - pad
                if (position.startsWith('c')) y = (canvas.height - logoH) / 2
                if (position.startsWith('b')) y = canvas.height - logoH - pad

                ctx.drawImage(logo, x, y, logoW, logoH)
                canvas.toBlob(
                    (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
                    'image/png',
                )
            }
            logo.onerror = () => reject(new Error('Failed to load logo'))
            logo.src = logoUrl
        }
        img.onerror = () => reject(new Error('Failed to load image'))
        img.src = imageUrl
    })
}

/**
 * Auto-detect whether to use light or dark logo variant based on image brightness.
 * Samples the bottom-right 15% of the image.
 */
export async function detectLogoVariant(imageUrl: string): Promise<LogoVariant> {
    return new Promise((resolve) => {
        const img = new window.Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            const ctx = canvas.getContext('2d')!
            ctx.drawImage(img, 0, 0)

            const sampleX = Math.floor(canvas.width * 0.85)
            const sampleY = Math.floor(canvas.height * 0.85)
            const sampleW = canvas.width - sampleX
            const sampleH = canvas.height - sampleY
            const data = ctx.getImageData(sampleX, sampleY, sampleW, sampleH).data

            let totalBrightness = 0
            const pixelCount = data.length / 4
            for (let i = 0; i < data.length; i += 4) {
                totalBrightness += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114)
            }
            const avgBrightness = totalBrightness / pixelCount

            resolve(avgBrightness < 128 ? 'light' : 'dark')
        }
        img.onerror = () => resolve('light')
        img.src = imageUrl
    })
}
```

**Step 2: Commit**

```bash
git add src/lib/logo-overlay.ts
git commit -m "feat: add client-side logo overlay utility with auto-contrast detection"
```

---

### Task 6: Create Content Studio Homepage

Port the Content Studio overview page adapted for HS Social Express's light theme and existing pages.

**Files:**
- Create: `src/pages/ContentStudio.tsx`
- Modify: `src/App.tsx` (add route)
- Modify: `src/components/layout/Layout.tsx` (add nav link)

**Step 1: Create the Content Studio page**

This page provides a dashboard hub with "Create" and "Configure" sections linking to existing pages and the new Image Studio. Adapt colors from FTF's dark theme to the light theme used in HS Social Express.

Key sections:
- **Create**: Posts, Campaigns, Image Studio, Asset Library (count from content_assets)
- **Configure**: Brand Studio, Prompts, HubSpot
- **Recent Assets**: Grid of 6 most recent content_assets with thumbnails

Uses direct Supabase queries instead of SWR hooks. Links use React Router `<Link>` instead of Next.js `<Link>`.

**Step 2: Add route in App.tsx**

```typescript
import { ContentStudio } from '@/pages/ContentStudio'
// Add route:
<Route path="/content-studio" element={<ProtectedRoute><ContentStudio /></ProtectedRoute>} />
```

**Step 3: Add nav link in Layout.tsx**

Replace the existing workspace-specific nav items or add a "Content Studio" entry:
```typescript
{ path: '/content-studio', icon: Palette, label: 'Content Studio', isGlobal: false },
```

**Step 4: Commit**

```bash
git add src/pages/ContentStudio.tsx src/App.tsx src/components/layout/Layout.tsx
git commit -m "feat: add Content Studio homepage with dashboard hub"
```

---

### Task 7: Create Image Studio Page

This is the largest task. Port the full Image Studio page (~1600 lines in FTF) adapted for:
- Light theme (white backgrounds, teal accents instead of dark/gold)
- Supabase Edge Functions instead of Next.js API routes
- Direct Supabase calls for asset fetching instead of SWR
- React Router instead of Next.js routing
- CSS transitions instead of Framer Motion (skip the dependency)
- Brand assets from Supabase Storage for logos (queried at runtime)

**Files:**
- Create: `src/pages/ImageStudio.tsx`
- Modify: `src/App.tsx` (add route)

**Key sub-components to include (all in the same file):**

1. **AssetBrowser** — Left sidebar (264px) with:
   - Upload section (drag-drop + click)
   - Reference image selection (max 3)
   - Library grid (recent generations + all assets)
   - Calls `image-studio-upload` edge function for uploads
   - Fetches assets from `content_assets` table via Supabase

2. **ComparisonView** — Center area with:
   - Side-by-side comparison (previous vs latest)
   - Single image view (first generation)
   - Generations strip (horizontal thumbnails)
   - Logo preview overlay

3. **PromptBar** — Input area with:
   - Reference image chips
   - Main textarea (Cmd+Enter to generate)
   - Refinement input (appears after first generation)
   - Aspect ratio pills (1:1, 4:5, 9:16, 16:9, 3:4)
   - Generate/Regenerate button

4. **SlideStrip** — Carousel slide selector
   - Numbered slide buttons
   - Add slide button
   - "All" toggle

5. **LogoPanel** — Right sidebar (224px, toggleable) with:
   - Logo variant toggle (fetched from brand_assets table)
   - 3x3 position grid
   - Apply & Cancel buttons

6. **Action bar** — Bottom bar with:
   - Add Logo, Save, Download, Start Over
   - Download All, Regenerate All (carousel mode)

**API calls adapted for edge functions:**
- Generate: `supabase.functions.invoke('image-studio-generate', { body: { prompt, aspect_ratio, reference_image_urls, space_id } })`
- Split prompt: `supabase.functions.invoke('image-studio-split-prompt', { body: { prompt, slide_count } })`
- Upload: `supabase.functions.invoke('image-studio-upload', { body: formData })` — Note: Edge functions support FormData

**Step 1: Write ImageStudio.tsx**

Full page component. See FTF source at `/Users/dannavfield/Vibe coding/Projects/Framethefairway/src/components/admin/content/image-studio-page.tsx` for the complete logic.

Key adaptations:
- Replace all `bg-[#111]` → `bg-white border border-[var(--color-gray-200)]`
- Replace `text-white/90` → `text-[var(--color-gray-900)]`
- Replace `text-white/40` → `text-[var(--color-gray-400)]`
- Replace `border-white/[0.06]` → `border-[var(--color-gray-200)]`
- Replace `bg-[#c9a962]` → `bg-[var(--color-primary)]`
- Replace `text-[#c9a962]` → `text-[var(--color-primary)]`
- Replace `motion.div` → regular `div` (no framer-motion)
- Replace `useSWRConfig` → direct Supabase queries
- Replace `fetch('/api/...')` → `supabase.functions.invoke('...')`
- Remove `'use client'` directive (not needed in Vite)
- Remove `@next/next/no-img-element` comments
- Replace JSZip with simple sequential download (or add jszip dependency)

**Step 2: Add route in App.tsx**

```typescript
import { ImageStudio } from '@/pages/ImageStudio'
// Add route:
<Route path="/image-studio" element={<ProtectedRoute><ImageStudio /></ProtectedRoute>} />
```

**Step 3: Verify build**

```bash
npm run build
```

**Step 4: Commit**

```bash
git add src/pages/ImageStudio.tsx src/App.tsx
git commit -m "feat: add Image Studio page with single/carousel generation"
```

---

### Task 8: Deploy and Verify

**Step 1: Deploy edge functions**

```bash
supabase functions deploy image-studio-generate --project-ref dbfrxagaccnitfpdtpen
supabase functions deploy image-studio-split-prompt --project-ref dbfrxagaccnitfpdtpen
supabase functions deploy image-studio-upload --project-ref dbfrxagaccnitfpdtpen
```

**Step 2: Ensure GEMINI_API_KEY is set**

```bash
supabase secrets list --project-ref dbfrxagaccnitfpdtpen
# If not set:
supabase secrets set GEMINI_API_KEY=your-key-here --project-ref dbfrxagaccnitfpdtpen
```

**Step 3: Create content_assets table** (via Supabase Dashboard SQL Editor)

Paste the migration SQL from Task 1.

**Step 4: Build and deploy frontend**

```bash
npm run build
vercel --prod --yes
```

**Step 5: Test end-to-end**

1. Navigate to Content Studio in sidebar
2. Click "Image Studio"
3. Type a prompt and click Generate
4. Verify image appears in comparison view
5. Try refinement prompt
6. Switch to Carousel mode, generate all slides
7. Test logo overlay (requires brand assets uploaded)
8. Test download
9. Verify assets appear in library sidebar

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: deploy Content Studio and Image Studio"
```

---

## Dependency Notes

- **JSZip**: FTF uses `jszip` for carousel ZIP downloads. Either add it (`npm install jszip`) or implement sequential downloads as a simpler alternative.
- **Framer Motion**: FTF uses this for the mode toggle underline animation. We skip this and use CSS transitions instead.
- **SWR**: Not needed — we use direct Supabase queries with `useState`/`useEffect`.

## Testing Flow

1. Content Studio homepage → verify all cards link correctly
2. Image Studio → generate a single image → verify it appears
3. Refinement → add refinement text → regenerate → verify comparison view
4. Reference images → upload an image → select as reference → generate with it
5. Carousel → switch mode → enter prompt → generate all → verify slide strip
6. Logo → click Add Logo → select position → apply → verify composite
7. Download → download single image → verify file
8. Save → save to library → verify it appears in sidebar
