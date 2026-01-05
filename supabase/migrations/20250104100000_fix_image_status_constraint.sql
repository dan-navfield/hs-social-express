-- Migration: Fix image_status constraint
-- Updates the posts.image_status check constraint to match new values

-- Drop the old constraint
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_image_status_check;

-- Add the new constraint with updated values
ALTER TABLE posts ADD CONSTRAINT posts_image_status_check 
  CHECK (image_status IN ('no_image', 'none', 'prompt_ready', 'generating', 'images_available', 'ready', 'failed'));

-- Update any existing 'none' values to 'no_image'
UPDATE posts SET image_status = 'no_image' WHERE image_status = 'none';
UPDATE posts SET image_status = 'images_available' WHERE image_status = 'ready';
