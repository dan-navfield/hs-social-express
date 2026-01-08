-- BuyICT Snoop Module Tables
-- Migration: 20250108000000_buyict_snoop.sql
-- Purpose: Procurement opportunity management from BuyICT
-- Scoped to existing spaces (workspaces) pattern

-- ============================================================================
-- 1. BuyICT Contacts (create first due to FK dependencies)
-- Deduplicated contact database extracted from opportunities
-- ============================================================================
CREATE TABLE IF NOT EXISTS buyict_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  
  -- Contact info
  email TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  
  -- Derived/aggregated fields (updated by triggers or application logic)
  linked_departments JSONB DEFAULT '[]', -- Derived from opportunities
  opportunity_count INT DEFAULT 0,
  
  -- Timestamps
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(space_id, email)
);

-- ============================================================================
-- 2. BuyICT Integrations (connection configuration per space)
-- ============================================================================
CREATE TABLE IF NOT EXISTS buyict_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  
  -- Connection method: 'upload' (MVP), 'api', 'browser_sync'
  connection_method TEXT NOT NULL CHECK (connection_method IN ('upload', 'api', 'browser_sync')),
  connection_status TEXT DEFAULT 'disconnected' CHECK (connection_status IN ('disconnected', 'connected', 'syncing', 'error')),
  
  -- For API/browser auth (encrypted at rest via Supabase Vault or app-level encryption)
  encrypted_credentials TEXT,
  
  -- Sync state
  last_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,
  
  -- Method-specific config (e.g., API endpoint, browser sync settings)
  config JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(space_id)
);

-- ============================================================================
-- 3. BuyICT Sync Jobs (audit log of sync operations)
-- ============================================================================
CREATE TABLE IF NOT EXISTS buyict_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES buyict_integrations(id) ON DELETE CASCADE,
  
  -- Job status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  sync_type TEXT NOT NULL CHECK (sync_type IN ('full', 'incremental', 'upload')),
  
  -- Stats for reporting
  stats JSONB DEFAULT '{}', -- { opportunities_added, opportunities_updated, contacts_found, errors, etc. }
  
  -- Error handling
  error TEXT,
  
  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Audit
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 4. BuyICT Opportunities (the core imported data)
-- ============================================================================
CREATE TABLE IF NOT EXISTS buyict_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  
  -- BuyICT identifiers
  buyict_reference TEXT NOT NULL, -- External reference/ID from BuyICT (e.g., "ATM123456")
  buyict_url TEXT, -- Link back to BuyICT portal
  
  -- Core fields
  title TEXT NOT NULL,
  buyer_entity_raw TEXT, -- Exact string from BuyICT (preserved verbatim)
  category TEXT, -- Panel classification if available
  description TEXT, -- Full description/detail text
  
  -- Dates
  publish_date DATE,
  closing_date TIMESTAMPTZ,
  
  -- Status
  opportunity_status TEXT, -- Open, Closed, Withdrawn, Draft, etc.
  
  -- Raw contact info (before extraction)
  contact_text_raw TEXT, -- Raw enquiries/contact officer text block
  
  -- Attachment metadata
  attachments JSONB DEFAULT '[]', -- [{ name, type, size, url }]
  
  -- Sync metadata
  source_hash TEXT, -- MD5 or similar for detecting changes during incremental sync
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  sync_job_id UUID REFERENCES buyict_sync_jobs(id) ON DELETE SET NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(space_id, buyict_reference)
);

-- ============================================================================
-- 5. Department Mappings (normalisation layer)
-- Maps raw buyer_entity strings to canonical department names
-- ============================================================================
CREATE TABLE IF NOT EXISTS buyict_department_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  
  -- Mapping rules
  source_pattern TEXT NOT NULL, -- The raw string or pattern to match
  match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'contains', 'regex', 'fuzzy')),
  canonical_department TEXT NOT NULL, -- The normalised department name
  canonical_agency TEXT, -- Optional higher-level agency grouping
  
  -- Confidence and approval
  confidence DECIMAL(3,2) DEFAULT 1.0, -- 0.0-1.0 for ML-suggested mappings
  is_approved BOOLEAN DEFAULT false, -- Admin has reviewed
  is_auto_generated BOOLEAN DEFAULT false, -- Was this created by ML suggestion
  
  -- Audit
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(space_id, source_pattern, match_type)
);

-- ============================================================================
-- 6. Opportunity Contacts (junction table with extraction provenance)
-- Links opportunities to contacts with source tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS buyict_opportunity_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES buyict_opportunities(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES buyict_contacts(id) ON DELETE CASCADE,
  
  -- Extraction provenance (critical for traceability)
  source_type TEXT NOT NULL CHECK (source_type IN ('structured_field', 'page_text', 'attachment')),
  source_detail TEXT, -- e.g., "Contact Officer field", "Page section: Enquiries", "Attachment: Terms.pdf"
  extraction_confidence DECIMAL(3,2) DEFAULT 1.0,
  
  -- Role context
  role_label TEXT, -- "Contact Officer", "Enquiries", "Technical Contact", etc.
  
  -- Timestamps
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(opportunity_id, contact_id, source_type)
);

-- ============================================================================
-- Indexes for performance
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_buyict_contacts_space_id ON buyict_contacts(space_id);
CREATE INDEX IF NOT EXISTS idx_buyict_contacts_email ON buyict_contacts(email);
CREATE INDEX IF NOT EXISTS idx_buyict_integrations_space_id ON buyict_integrations(space_id);
CREATE INDEX IF NOT EXISTS idx_buyict_sync_jobs_space_id ON buyict_sync_jobs(space_id);
CREATE INDEX IF NOT EXISTS idx_buyict_sync_jobs_integration ON buyict_sync_jobs(integration_id);
CREATE INDEX IF NOT EXISTS idx_buyict_sync_jobs_status ON buyict_sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_buyict_opportunities_space_id ON buyict_opportunities(space_id);
CREATE INDEX IF NOT EXISTS idx_buyict_opportunities_closing_date ON buyict_opportunities(closing_date);
CREATE INDEX IF NOT EXISTS idx_buyict_opportunities_status ON buyict_opportunities(opportunity_status);
CREATE INDEX IF NOT EXISTS idx_buyict_opportunities_buyer ON buyict_opportunities(buyer_entity_raw);
CREATE INDEX IF NOT EXISTS idx_buyict_opportunities_reference ON buyict_opportunities(buyict_reference);
CREATE INDEX IF NOT EXISTS idx_buyict_department_mappings_space_id ON buyict_department_mappings(space_id);
CREATE INDEX IF NOT EXISTS idx_buyict_department_mappings_pattern ON buyict_department_mappings(source_pattern);
CREATE INDEX IF NOT EXISTS idx_buyict_opportunity_contacts_opportunity ON buyict_opportunity_contacts(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_buyict_opportunity_contacts_contact ON buyict_opportunity_contacts(contact_id);

-- ============================================================================
-- Enable Row Level Security
-- ============================================================================
ALTER TABLE buyict_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyict_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyict_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyict_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyict_department_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyict_opportunity_contacts ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- RLS Policies (following existing space membership pattern)
-- ============================================================================

-- Contacts
CREATE POLICY "Users can view buyict_contacts in their spaces" ON buyict_contacts
  FOR SELECT USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid()));

CREATE POLICY "Editors can manage buyict_contacts" ON buyict_contacts
  FOR ALL USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')));

-- Integrations
CREATE POLICY "Users can view buyict_integrations in their spaces" ON buyict_integrations
  FOR SELECT USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid()));

CREATE POLICY "Editors can manage buyict_integrations" ON buyict_integrations
  FOR ALL USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')));

-- Sync Jobs
CREATE POLICY "Users can view buyict_sync_jobs in their spaces" ON buyict_sync_jobs
  FOR SELECT USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid()));

CREATE POLICY "Editors can manage buyict_sync_jobs" ON buyict_sync_jobs
  FOR ALL USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')));

-- Opportunities
CREATE POLICY "Users can view buyict_opportunities in their spaces" ON buyict_opportunities
  FOR SELECT USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid()));

CREATE POLICY "Editors can manage buyict_opportunities" ON buyict_opportunities
  FOR ALL USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')));

-- Department Mappings
CREATE POLICY "Users can view buyict_department_mappings in their spaces" ON buyict_department_mappings
  FOR SELECT USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid()));

CREATE POLICY "Editors can manage buyict_department_mappings" ON buyict_department_mappings
  FOR ALL USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')));

-- Opportunity Contacts (RLS via parent opportunity)
CREATE POLICY "Users can view buyict_opportunity_contacts via opportunities" ON buyict_opportunity_contacts
  FOR SELECT USING (opportunity_id IN (
    SELECT id FROM buyict_opportunities WHERE space_id IN (
      SELECT space_id FROM space_members WHERE user_id = auth.uid()
    )
  ));

CREATE POLICY "Editors can manage buyict_opportunity_contacts" ON buyict_opportunity_contacts
  FOR ALL USING (opportunity_id IN (
    SELECT id FROM buyict_opportunities WHERE space_id IN (
      SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')
    )
  ));

-- ============================================================================
-- Helper function: Get canonical department for a buyer entity
-- ============================================================================
CREATE OR REPLACE FUNCTION get_canonical_department(p_space_id UUID, p_buyer_entity TEXT)
RETURNS TABLE(canonical_department TEXT, canonical_agency TEXT, confidence DECIMAL, is_approved BOOLEAN)
LANGUAGE plpgsql
AS $$
BEGIN
  -- First try exact match
  RETURN QUERY
  SELECT m.canonical_department, m.canonical_agency, m.confidence, m.is_approved
  FROM buyict_department_mappings m
  WHERE m.space_id = p_space_id
    AND m.match_type = 'exact'
    AND m.source_pattern = p_buyer_entity
  LIMIT 1;
  
  IF FOUND THEN RETURN; END IF;
  
  -- Then try contains match
  RETURN QUERY
  SELECT m.canonical_department, m.canonical_agency, m.confidence, m.is_approved
  FROM buyict_department_mappings m
  WHERE m.space_id = p_space_id
    AND m.match_type = 'contains'
    AND p_buyer_entity ILIKE '%' || m.source_pattern || '%'
  ORDER BY m.confidence DESC
  LIMIT 1;
  
  IF FOUND THEN RETURN; END IF;
  
  -- Return null row if no match
  RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::DECIMAL, NULL::BOOLEAN;
END;
$$;
