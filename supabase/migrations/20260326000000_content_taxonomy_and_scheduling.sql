-- Content taxonomy: layers and categories for posts
-- Plus scheduled_at for calendar scheduling

-- Add content_layer (strategic intent)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS content_layer TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS content_category TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

-- Index for calendar queries (date range lookups)
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_at ON posts(scheduled_at);

-- Index for filtering by layer/category
CREATE INDEX IF NOT EXISTS idx_posts_content_layer ON posts(content_layer);
CREATE INDEX IF NOT EXISTS idx_posts_content_category ON posts(content_category);
