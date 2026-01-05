-- Brand Studio Wizard Database Changes
-- Adds setup_status tracking and structured brand_profile table

-- Add setup_status to brand_context_cache
ALTER TABLE brand_context_cache 
ADD COLUMN IF NOT EXISTS setup_status TEXT DEFAULT 'empty' CHECK (setup_status IN ('empty', 'website_pending', 'profile_draft', 'ready')),
ADD COLUMN IF NOT EXISTS detected_name TEXT,
ADD COLUMN IF NOT EXISTS detected_linkedin TEXT,
ADD COLUMN IF NOT EXISTS linkedin_confidence TEXT CHECK (linkedin_confidence IN ('high', 'medium', 'low'));

-- Create brand_profile table for structured profile data
CREATE TABLE IF NOT EXISTS brand_profile (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE NOT NULL,
    
    -- Core profile sections
    who_we_are TEXT,
    what_we_do TEXT,
    who_we_serve TEXT,
    tone_notes TEXT,
    
    -- Additional sections
    themes TEXT[], -- Common themes/topics
    services TEXT[], -- List of services
    do_not_say TEXT[], -- Exclusion list
    compliance_notes TEXT,
    
    -- Generation metadata
    is_system_generated BOOLEAN DEFAULT true,
    last_generated_at TIMESTAMPTZ,
    last_edited_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(space_id)
);

-- Add confirmed flag to source_documents for wizard flow
ALTER TABLE source_documents
ADD COLUMN IF NOT EXISTS is_confirmed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS discovery_session_id UUID;

-- RLS for brand_profile
ALTER TABLE brand_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view brand_profile in their spaces" ON brand_profile
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM space_members
            WHERE space_members.space_id = brand_profile.space_id
            AND space_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage brand_profile in their spaces" ON brand_profile
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM space_members
            WHERE space_members.space_id = brand_profile.space_id
            AND space_members.user_id = auth.uid()
            AND space_members.role IN ('owner', 'editor')
        )
    );

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_brand_profile_space ON brand_profile(space_id);
CREATE INDEX IF NOT EXISTS idx_source_documents_confirmed ON source_documents(space_id, is_confirmed);
