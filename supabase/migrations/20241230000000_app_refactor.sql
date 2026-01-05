-- Migration: App Refactor - New tables and posts modifications
-- Run after: 20241229000001_disable_rls.sql

-- 1. brand_context_cache: compiled brand info for fast retrieval
CREATE TABLE IF NOT EXISTS brand_context_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  compiled_text TEXT NOT NULL,
  compiled_from JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(space_id)
);

-- 2. brand_sources: enabled source types per space
CREATE TABLE IF NOT EXISTS brand_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('website', 'sharepoint', 'manual')),
  enabled BOOLEAN DEFAULT true,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(space_id, source_type)
);

-- 3. brand_manual_profile: manual text inputs
CREATE TABLE IF NOT EXISTS brand_manual_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(space_id, field_name)
);

-- 4. source_documents: crawled/scanned documents
CREATE TABLE IF NOT EXISTS source_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('website', 'sharepoint')),
  url TEXT,
  title TEXT,
  content TEXT,
  metadata JSONB DEFAULT '{}',
  last_scanned TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. source_chunks: chunked content for retrieval
CREATE TABLE IF NOT EXISTS source_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. campaigns: replaces jobs/batches
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_count INT DEFAULT 10,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'completed', 'failed')),
  locked_source_settings JSONB DEFAULT '{}',
  template_ids JSONB DEFAULT '{}',
  generation_settings JSONB DEFAULT '{}',
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. hubspot_connections
CREATE TABLE IF NOT EXISTS hubspot_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  encrypted_tokens TEXT,
  scopes TEXT[],
  account_meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(space_id)
);

-- 8. Modify posts table: add new columns
ALTER TABLE posts 
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sequence_number INT,
  ADD COLUMN IF NOT EXISTS sources_used JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS generation_meta JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS image_status TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS overlay_status TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS publish_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS hubspot_social_post_id TEXT,
  ADD COLUMN IF NOT EXISTS hubspot_status TEXT,
  ADD COLUMN IF NOT EXISTS hubspot_meta JSONB;

-- 9. Update posts status constraint (drop old, add new)
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE posts ADD CONSTRAINT posts_status_check 
  CHECK (status IN ('draft', 'selected_to_publish', 'sent_to_hubspot', 'failed', 'generating_text', 'generating_image'));

-- 10. Add image_status and overlay_status constraints
ALTER TABLE posts ADD CONSTRAINT posts_image_status_check 
  CHECK (image_status IN ('none', 'generating', 'ready', 'failed'));
ALTER TABLE posts ADD CONSTRAINT posts_overlay_status_check 
  CHECK (overlay_status IN ('none', 'compositing', 'ready', 'failed'));

-- 11. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_campaigns_space_id ON campaigns(space_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_posts_campaign_id ON posts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_source_documents_space_id ON source_documents(space_id);
CREATE INDEX IF NOT EXISTS idx_source_chunks_document_id ON source_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_brand_sources_space_id ON brand_sources(space_id);
CREATE INDEX IF NOT EXISTS idx_brand_manual_profile_space_id ON brand_manual_profile(space_id);

-- 12. Enable RLS on new tables
ALTER TABLE brand_context_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_manual_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE hubspot_connections ENABLE ROW LEVEL SECURITY;

-- 13. RLS Policies for new tables (using space membership pattern)
CREATE POLICY "Users can view brand_context_cache in their spaces" ON brand_context_cache
  FOR SELECT USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid()));

CREATE POLICY "Editors can manage brand_context_cache" ON brand_context_cache
  FOR ALL USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')));

CREATE POLICY "Users can view brand_sources in their spaces" ON brand_sources
  FOR SELECT USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid()));

CREATE POLICY "Editors can manage brand_sources" ON brand_sources
  FOR ALL USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')));

CREATE POLICY "Users can view brand_manual_profile in their spaces" ON brand_manual_profile
  FOR SELECT USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid()));

CREATE POLICY "Editors can manage brand_manual_profile" ON brand_manual_profile
  FOR ALL USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')));

CREATE POLICY "Users can view source_documents in their spaces" ON source_documents
  FOR SELECT USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid()));

CREATE POLICY "Editors can manage source_documents" ON source_documents
  FOR ALL USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')));

CREATE POLICY "Users can view source_chunks via documents" ON source_chunks
  FOR SELECT USING (document_id IN (
    SELECT id FROM source_documents WHERE space_id IN (
      SELECT space_id FROM space_members WHERE user_id = auth.uid()
    )
  ));

CREATE POLICY "Editors can manage source_chunks" ON source_chunks
  FOR ALL USING (document_id IN (
    SELECT id FROM source_documents WHERE space_id IN (
      SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
  ));

CREATE POLICY "Users can view campaigns in their spaces" ON campaigns
  FOR SELECT USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid()));

CREATE POLICY "Editors can manage campaigns" ON campaigns
  FOR ALL USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')));

CREATE POLICY "Users can view hubspot_connections in their spaces" ON hubspot_connections
  FOR SELECT USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid()));

CREATE POLICY "Owners can manage hubspot_connections" ON hubspot_connections
  FOR ALL USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role = 'owner'));
