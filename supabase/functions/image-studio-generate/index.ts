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
        const { prompt, aspect_ratio, reference_image_urls, space_id, model: requestModel } = await req.json()

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

        // Load model from ai_settings (or use default)
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseKey)

        const { data: aiSettings } = await supabase
            .from('ai_settings')
            .select('image_model')
            .eq('space_id', space_id)
            .maybeSingle()

        // Request model takes priority, then ai_settings, then default
        const model = requestModel || aiSettings?.image_model || 'gemini-2.5-flash-image'
        console.log('[image-studio] Using model:', model)
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
