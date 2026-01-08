-- Migration: Add new post status values
-- Run after: 20250104100000_fix_image_status_constraint.sql

-- Update posts status constraint to include new workflow statuses
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE posts ADD CONSTRAINT posts_status_check 
  CHECK (status IN (
    'draft', 
    'ready_to_publish', 
    'scheduled', 
    'published', 
    'selected_to_publish', 
    'sent_to_hubspot', 
    'failed', 
    'generating_text', 
    'generating_image'
  ));
