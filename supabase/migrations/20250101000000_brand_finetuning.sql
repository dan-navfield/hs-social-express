-- Migration: Brand Fine-tuning Support
-- Adds fields for OpenAI fine-tuned model training

-- Add fine-tuning fields to brand_profile
ALTER TABLE brand_profile 
ADD COLUMN IF NOT EXISTS fine_tuned_model_id TEXT,
ADD COLUMN IF NOT EXISTS training_status TEXT DEFAULT 'not_started',
ADD COLUMN IF NOT EXISTS training_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS training_completed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS training_error TEXT,
ADD COLUMN IF NOT EXISTS training_examples_count INTEGER DEFAULT 0;

-- Create training_examples table to store generated training data
CREATE TABLE IF NOT EXISTS training_examples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    system_prompt TEXT NOT NULL,
    user_prompt TEXT NOT NULL,
    assistant_response TEXT NOT NULL,
    source_document TEXT,
    category TEXT, -- 'linkedin_post', 'brand_description', 'project_summary', etc.
    is_approved BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create brand_knowledge table for structured knowledge extraction
CREATE TABLE IF NOT EXISTS brand_knowledge (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    category TEXT NOT NULL, -- 'clients', 'projects', 'technologies', etc.
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    user_notes TEXT,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(space_id, category)
);

-- Create sync_progress table to track document processing
CREATE TABLE IF NOT EXISTS sync_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL, -- 'sharepoint', 'manual'
    source_path TEXT,
    status TEXT DEFAULT 'pending', -- 'pending', 'scanning', 'processing', 'paused', 'completed', 'failed'
    total_documents INTEGER DEFAULT 0,
    processed_documents INTEGER DEFAULT 0,
    estimated_tokens INTEGER DEFAULT 0,
    actual_tokens INTEGER DEFAULT 0,
    estimated_cost DECIMAL(10,4) DEFAULT 0,
    actual_cost DECIMAL(10,4) DEFAULT 0,
    error_log JSONB DEFAULT '[]'::jsonb,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_training_examples_space ON training_examples(space_id);
CREATE INDEX IF NOT EXISTS idx_brand_knowledge_space ON brand_knowledge(space_id);
CREATE INDEX IF NOT EXISTS idx_sync_progress_space ON sync_progress(space_id);

-- Disable RLS for dev
ALTER TABLE training_examples DISABLE ROW LEVEL SECURITY;
ALTER TABLE brand_knowledge DISABLE ROW LEVEL SECURITY;
ALTER TABLE sync_progress DISABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE training_examples IS 'Stores training examples for OpenAI fine-tuning';
COMMENT ON TABLE brand_knowledge IS 'Structured brand knowledge extracted from documents';
COMMENT ON TABLE sync_progress IS 'Tracks document sync/processing progress';
