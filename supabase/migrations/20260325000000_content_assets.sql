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
