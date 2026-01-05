# Image Generation Feature - Implementation Plan

## Overview
This plan outlines the implementation of a comprehensive image generation feature for posts, including an Image Modal, bulk operations, and image management capabilities.

## Phase 1: Database Schema Updates

### 1.1 Add new columns to `posts` table
```sql
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_prompt TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_prompt_style TEXT DEFAULT 'realistic'; -- 'realistic' | 'editorial'
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_settings JSONB DEFAULT '{}'; -- style, people, no_text, no_logos, aspect_ratio
ALTER TABLE posts ADD COLUMN IF NOT EXISTS primary_image_id UUID; -- references post_images
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_status TEXT DEFAULT 'no_image'; -- no_image, prompt_ready, generating, images_available, failed
```

### 1.2 Create `post_images` table for multiple images per post
```sql
CREATE TABLE IF NOT EXISTS post_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('generated', 'uploaded')),
    storage_path TEXT NOT NULL,
    thumbnail_path TEXT,
    prompt_used TEXT,
    settings_used JSONB DEFAULT '{}',
    generation_status TEXT DEFAULT 'pending' CHECK (generation_status IN ('pending', 'generating', 'completed', 'failed')),
    error TEXT,
    is_primary BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_post_images_post_id ON post_images(post_id);
CREATE INDEX idx_post_images_is_primary ON post_images(post_id, is_primary) WHERE is_primary = TRUE;
```

## Phase 2: Image Modal Component

### 2.1 Create `ImageModal.tsx` component
Structure:
- **Post Context Section** (collapsible, read-only)
  - Display post body text
  - Copy button
  - Collapse/expand toggle

- **Image Prompt Section**
  - "Generate Prompt" button (two options: realistic, editorial)
  - Editable prompt textarea
  - Settings controls:
    - Style toggle: Photographic / Illustrative
    - People toggle: Include / Exclude
    - Text/Logo toggle: Include / Exclude
    - Aspect ratio selector: 1:1, 4:5, 16:9, 9:16

- **Image Generation Section**
  - "Generate Images" button (generates 2 at a time)
  - Progress indicators for each generation
  - Retry button for failed generations

- **Image Gallery Section**
  - Grid of all attached images (generated + uploaded)
  - Each image has:
    - Preview button (full size modal)
    - Select as primary button
    - Delete button
  - Visual indicator for primary image
  - Drag-and-drop upload zone

## Phase 3: Edge Functions

### 3.1 Create `generate-image-prompt` function
- Input: post_id, style ('realistic' | 'editorial')
- Uses Gemini to generate image prompt from post body
- Returns suggested prompt

### 3.2 Update `generate-image` function
- Input: post_id, prompt, settings, count (default 2)
- Generates multiple images simultaneously
- Stores each in post_images table
- Returns image IDs and paths

### 3.3 Create `bulk-generate-prompts` function
- Input: post_ids[], style
- Generates prompts for multiple posts
- Updates posts in batch

### 3.4 Create `bulk-generate-images` function
- Input: post_ids[] (uses existing prompts)
- Generates images for all posts with prompts
- Tracks progress per post

## Phase 4: Posts Table Updates

### 4.1 Add Image Status Column
- Add `image_status` indicator to table rows
- Status pills: No Image, Prompt Ready, Generating, Available, Failed

### 4.2 Add Image Thumbnail
- Show small thumbnail of primary image when available
- Click opens Image Modal

### 4.3 Update Image Action Button
- Click opens Image Modal instead of direct generation
- Visual state based on image_status

### 4.4 Update Bulk Actions
- Add: Generate Prompts (Selected)
- Add: Generate Images (Selected) - for posts with prompts
- Add: Regenerate Images (Selected)
- Add: Clear Images (Selected)

## Phase 5: API & Types

### 5.1 TypeScript Types
```typescript
interface PostImage {
    id: string;
    post_id: string;
    space_id: string;
    source_type: 'generated' | 'uploaded';
    storage_path: string;
    thumbnail_path: string | null;
    prompt_used: string | null;
    settings_used: ImageSettings | null;
    generation_status: 'pending' | 'generating' | 'completed' | 'failed';
    error: string | null;
    is_primary: boolean;
    created_at: string;
}

interface ImageSettings {
    style: 'photographic' | 'illustrative';
    include_people: boolean;
    include_text: boolean;
    include_logos: boolean;
    aspect_ratio: '1:1' | '4:5' | '16:9' | '9:16';
}

type ImageStatus = 'no_image' | 'prompt_ready' | 'generating' | 'images_available' | 'failed';
```

## File Structure

```
src/
├── components/
│   ├── posts/
│   │   ├── ImageModal.tsx          # Main image modal
│   │   ├── ImagePromptSection.tsx  # Prompt generation & editing
│   │   ├── ImageGallery.tsx        # Image grid & selection
│   │   ├── ImageUploader.tsx       # Drag & drop upload
│   │   └── ImagePreview.tsx        # Full-size image viewer
│   └── ui/
│       └── (existing components)
├── pages/
│   └── Posts.tsx                   # Updated with modal integration
└── types/
    └── image.ts                    # Image-related types

supabase/
├── functions/
│   ├── generate-image/             # Updated function
│   ├── generate-image-prompt/      # New function
│   ├── bulk-generate-prompts/      # New function
│   └── bulk-generate-images/       # New function
└── migrations/
    └── 20250104000000_post_images.sql  # New migration
```

## Implementation Order

1. **Day 1: Database & Types**
   - Create migration for post_images table
   - Add columns to posts table
   - Create TypeScript types
   - Make buckets public as needed

2. **Day 2: Image Modal Core**
   - Create ImageModal component shell
   - Implement Post Context section
   - Implement Image Prompt section (UI only)

3. **Day 3: Prompt Generation**
   - Create generate-image-prompt edge function
   - Connect to modal
   - Add style options

4. **Day 4: Image Generation**
   - Update generate-image edge function
   - Create post_images records
   - Add progress tracking

5. **Day 5: Image Gallery**
   - Create ImageGallery component
   - Implement image preview
   - Implement primary selection
   - Implement delete

6. **Day 6: Image Upload**
   - Create ImageUploader component
   - Handle drag & drop
   - Store in post_images

7. **Day 7: Posts Table Integration**
   - Add image status column
   - Add thumbnail preview
   - Update Image action button

8. **Day 8: Bulk Operations**
   - Create bulk edge functions
   - Add bulk action handlers
   - Add progress indicators

9. **Day 9: Polish & Testing**
   - Error handling
   - Loading states
   - Edge cases
   - UX refinements

## Questions to Clarify

1. **Aspect ratio dimensions**: What pixel dimensions for each ratio?
   - 1:1 = 1024x1024
   - 4:5 = 1024x1280
   - 16:9 = 1920x1080
   - 9:16 = 1080x1920

2. **Storage bucket**: Use existing `generated-images` or create new `post-images`?

3. **Thumbnail generation**: Generate thumbnails on upload/generation or on-demand?

4. **Max images per post**: Is there a limit?

5. **Image generation API**: Continue with Gemini or switch to another provider (DALL-E, Stability)?
