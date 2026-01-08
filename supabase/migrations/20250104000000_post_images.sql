-- Migration: Post Images System
-- Enables multiple images per post with prompt management

-- Add image-related columns to posts table
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_prompt TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_prompt_style TEXT DEFAULT 'realistic'; -- 'realistic' | 'editorial'
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_settings JSONB DEFAULT '{}';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS image_status TEXT DEFAULT 'no_image';

-- Create post_images table for multiple images per post
CREATE TABLE IF NOT EXISTS post_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL CHECK (source_type IN ('generated', 'uploaded')),
    storage_path TEXT NOT NULL,
    thumbnail_path TEXT,
    prompt_used TEXT,
    settings_used JSONB DEFAULT '{}',
    generation_status TEXT DEFAULT 'completed' CHECK (generation_status IN ('pending', 'generating', 'completed', 'failed')),
    error TEXT,
    is_primary BOOLEAN DEFAULT FALSE,
    width INTEGER DEFAULT 1024,
    height INTEGER DEFAULT 1024,
    file_size INTEGER,
    mime_type TEXT DEFAULT 'image/png',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_post_images_post_id ON post_images(post_id);
CREATE INDEX IF NOT EXISTS idx_post_images_space_id ON post_images(space_id);
CREATE INDEX IF NOT EXISTS idx_post_images_is_primary ON post_images(post_id, is_primary) WHERE is_primary = TRUE;
CREATE INDEX IF NOT EXISTS idx_post_images_generation_status ON post_images(generation_status);

-- Enable RLS
ALTER TABLE post_images ENABLE ROW LEVEL SECURITY;

-- RLS Policies for post_images
DROP POLICY IF EXISTS "Users can view post images in their spaces" ON post_images;
CREATE POLICY "Users can view post images in their spaces" ON post_images
    FOR SELECT USING (
        space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid())
    );

DROP POLICY IF EXISTS "Editors and owners can manage post images" ON post_images;
CREATE POLICY "Editors and owners can manage post images" ON post_images
    FOR ALL USING (
        space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor'))
    );

-- Function to ensure only one primary image per post
CREATE OR REPLACE FUNCTION ensure_single_primary_image()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_primary = TRUE THEN
        -- Unset any existing primary images for this post
        UPDATE post_images
        SET is_primary = FALSE
        WHERE post_id = NEW.post_id
        AND id != NEW.id
        AND is_primary = TRUE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for primary image management
DROP TRIGGER IF EXISTS trigger_ensure_single_primary_image ON post_images;
CREATE TRIGGER trigger_ensure_single_primary_image
    BEFORE INSERT OR UPDATE OF is_primary ON post_images
    FOR EACH ROW
    EXECUTE FUNCTION ensure_single_primary_image();

-- Function to update post image_status based on post_images
CREATE OR REPLACE FUNCTION update_post_image_status()
RETURNS TRIGGER AS $$
DECLARE
    generating_count INTEGER;
    completed_count INTEGER;
    failed_count INTEGER;
    new_status TEXT;
BEGIN
    -- Get counts for the post
    SELECT 
        COUNT(*) FILTER (WHERE generation_status = 'generating' OR generation_status = 'pending'),
        COUNT(*) FILTER (WHERE generation_status = 'completed'),
        COUNT(*) FILTER (WHERE generation_status = 'failed')
    INTO generating_count, completed_count, failed_count
    FROM post_images
    WHERE post_id = COALESCE(NEW.post_id, OLD.post_id);

    -- Determine new status
    IF generating_count > 0 THEN
        new_status := 'generating';
    ELSIF completed_count > 0 THEN
        new_status := 'images_available';
    ELSIF failed_count > 0 THEN
        new_status := 'failed';
    ELSE
        -- Check if post has a prompt
        IF EXISTS (
            SELECT 1 FROM posts 
            WHERE id = COALESCE(NEW.post_id, OLD.post_id) 
            AND image_prompt IS NOT NULL 
            AND image_prompt != ''
        ) THEN
            new_status := 'prompt_ready';
        ELSE
            new_status := 'no_image';
        END IF;
    END IF;

    -- Update the post
    UPDATE posts
    SET image_status = new_status
    WHERE id = COALESCE(NEW.post_id, OLD.post_id);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger for image status updates
DROP TRIGGER IF EXISTS trigger_update_post_image_status ON post_images;
CREATE TRIGGER trigger_update_post_image_status
    AFTER INSERT OR UPDATE OR DELETE ON post_images
    FOR EACH ROW
    EXECUTE FUNCTION update_post_image_status();

-- Add valid image_status values comment
COMMENT ON COLUMN posts.image_status IS 'Image status: no_image, prompt_ready, generating, images_available, failed';

-- Update existing posts to have correct image_status based on existing data
UPDATE posts 
SET image_status = 
    CASE 
        WHEN generated_image_path IS NOT NULL OR final_image_path IS NOT NULL THEN 'images_available'
        WHEN status = 'generating_image' THEN 'generating'
        ELSE 'no_image'
    END
WHERE image_status IS NULL OR image_status = 'no_image';
