-- SharePoint Integration Schema
-- For connecting and syncing SharePoint content

-- Enable vector extension for embeddings (if not already)
CREATE EXTENSION IF NOT EXISTS vector;

-- SharePoint connection credentials per workspace
CREATE TABLE IF NOT EXISTS sharepoint_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE NOT NULL,
    
    -- OAuth tokens (encrypted in practice)
    access_token TEXT,
    refresh_token TEXT,
    token_expires_at TIMESTAMPTZ,
    
    -- Microsoft tenant info
    tenant_id TEXT,
    user_email TEXT,
    
    -- Connection status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'expired', 'error')),
    last_error TEXT,
    
    connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(space_id)
);

-- Selected SharePoint sites/folders to sync
CREATE TABLE IF NOT EXISTS sharepoint_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE NOT NULL,
    connection_id UUID REFERENCES sharepoint_connections(id) ON DELETE CASCADE NOT NULL,
    
    -- SharePoint resource info
    site_id TEXT NOT NULL,
    site_name TEXT,
    drive_id TEXT,
    folder_path TEXT, -- root if whole site
    folder_name TEXT,
    
    -- Sync settings
    is_enabled BOOLEAN DEFAULT true,
    sync_depth INTEGER DEFAULT 3, -- How many folder levels deep
    file_types TEXT[] DEFAULT ARRAY['docx', 'pptx', 'pdf', 'txt', 'md'],
    
    -- Sync status
    last_sync_at TIMESTAMPTZ,
    delta_token TEXT, -- For incremental sync
    total_items INTEGER DEFAULT 0,
    synced_items INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Document chunks with embeddings for RAG
CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE NOT NULL,
    source_document_id UUID REFERENCES source_documents(id) ON DELETE CASCADE,
    
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    token_count INTEGER,
    
    -- Vector embedding for semantic search
    embedding vector(1536), -- OpenAI ada-002 dimension
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Sync job queue for background processing
CREATE TABLE IF NOT EXISTS sync_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE NOT NULL,
    source_id UUID REFERENCES sharepoint_sources(id) ON DELETE CASCADE,
    
    job_type TEXT NOT NULL CHECK (job_type IN ('full_sync', 'incremental', 'single_file')),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    
    -- Progress tracking
    total_items INTEGER DEFAULT 0,
    processed_items INTEGER DEFAULT 0,
    failed_items INTEGER DEFAULT 0,
    
    -- Error tracking
    last_error TEXT,
    error_count INTEGER DEFAULT 0,
    
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS Policies
ALTER TABLE sharepoint_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sharepoint_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;

-- Users can view/manage their workspace's SharePoint connections
CREATE POLICY "Users can manage sharepoint_connections in their spaces" ON sharepoint_connections
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM space_members
            WHERE space_members.space_id = sharepoint_connections.space_id
            AND space_members.user_id = auth.uid()
            AND space_members.role IN ('owner', 'editor')
        )
    );

CREATE POLICY "Users can manage sharepoint_sources in their spaces" ON sharepoint_sources
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM space_members
            WHERE space_members.space_id = sharepoint_sources.space_id
            AND space_members.user_id = auth.uid()
            AND space_members.role IN ('owner', 'editor')
        )
    );

CREATE POLICY "Users can view document_chunks in their spaces" ON document_chunks
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM space_members
            WHERE space_members.space_id = document_chunks.space_id
            AND space_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can view sync_jobs in their spaces" ON sync_jobs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM space_members
            WHERE space_members.space_id = sync_jobs.space_id
            AND space_members.user_id = auth.uid()
        )
    );

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sharepoint_connections_space ON sharepoint_connections(space_id);
CREATE INDEX IF NOT EXISTS idx_sharepoint_sources_space ON sharepoint_sources(space_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_space ON document_chunks(space_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_source ON document_chunks(source_document_id);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_space ON sync_jobs(space_id);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status);

-- Vector index for semantic search (ivfflat for faster queries at scale)
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding ON document_chunks 
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
