-- BuyICT Organisations Table
-- Migration: 20250109000000_buyict_organisations.sql
-- Purpose: Aggregate organisations from opportunities for CRM-like tracking

-- ============================================================================
-- 1. BuyICT Organisations (aggregated from buyer_entity_raw)
-- ============================================================================
CREATE TABLE IF NOT EXISTS buyict_organisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  
  -- Identity
  name TEXT NOT NULL, -- Normalised organisation name
  raw_names JSONB DEFAULT '[]', -- All variations of the name seen ["Dept of Health", "Health Dept", etc.]
  
  -- Type/Classification
  org_type TEXT, -- 'federal_department', 'state_department', 'agency', 'other'
  portfolio TEXT, -- e.g., 'Health', 'Defence', 'Finance'
  
  -- Contact summary (aggregated from opportunities)
  primary_email TEXT,
  contact_emails JSONB DEFAULT '[]', -- All unique emails seen
  contact_names JSONB DEFAULT '[]', -- All contact names seen
  
  -- Stats (denormalised for performance)
  opportunity_count INT DEFAULT 0,
  open_opportunity_count INT DEFAULT 0,
  total_estimated_value DECIMAL(15,2),
  first_opportunity_date DATE,
  last_opportunity_date DATE,
  
  -- Common procurement areas (analysed from opportunities)
  common_categories JSONB DEFAULT '[]', -- ["Software Development", "Consulting", ...]
  common_modules JSONB DEFAULT '[]', -- BuyICT modules they use
  common_working_arrangements JSONB DEFAULT '[]', -- ["Remote", "Hybrid", "Onsite"]
  common_locations JSONB DEFAULT '[]', -- ["Canberra", "Sydney", ...]
  
  -- AI-generated insights
  ai_summary TEXT, -- Brief AI-generated summary of what they procure
  ai_analysis JSONB DEFAULT '{}', -- Detailed analysis
  ai_analysed_at TIMESTAMPTZ,
  
  -- User notes
  notes TEXT,
  is_target BOOLEAN DEFAULT false, -- User has marked as target org
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(space_id, name)
);

-- ============================================================================
-- 2. Link opportunities to organisations
-- ============================================================================
ALTER TABLE buyict_opportunities 
  ADD COLUMN IF NOT EXISTS organisation_id UUID REFERENCES buyict_organisations(id) ON DELETE SET NULL;

-- Index for the FK
CREATE INDEX IF NOT EXISTS idx_buyict_opportunities_org ON buyict_opportunities(organisation_id);

-- ============================================================================
-- 3. Indexes for organisations
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_buyict_organisations_space_id ON buyict_organisations(space_id);
CREATE INDEX IF NOT EXISTS idx_buyict_organisations_name ON buyict_organisations(name);
CREATE INDEX IF NOT EXISTS idx_buyict_organisations_is_target ON buyict_organisations(is_target) WHERE is_target = true;
CREATE INDEX IF NOT EXISTS idx_buyict_organisations_priority ON buyict_organisations(priority);
CREATE INDEX IF NOT EXISTS idx_buyict_organisations_opp_count ON buyict_organisations(opportunity_count DESC);

-- ============================================================================
-- 4. Enable Row Level Security
-- ============================================================================
ALTER TABLE buyict_organisations ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 5. RLS Policies
-- ============================================================================
CREATE POLICY "Users can view buyict_organisations in their spaces" ON buyict_organisations
  FOR SELECT USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid()));

CREATE POLICY "Editors can manage buyict_organisations" ON buyict_organisations
  FOR ALL USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')));

-- ============================================================================
-- 6. Function to refresh organisation stats from opportunities
-- ============================================================================
CREATE OR REPLACE FUNCTION refresh_organisation_stats(p_org_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_space_id UUID;
  v_stats RECORD;
BEGIN
  -- Get space_id for the org
  SELECT space_id INTO v_space_id FROM buyict_organisations WHERE id = p_org_id;
  
  -- Calculate stats from linked opportunities
  SELECT 
    COUNT(*)::INT as opp_count,
    COUNT(*) FILTER (WHERE opportunity_status = 'Open' OR closing_date > NOW())::INT as open_count,
    MIN(publish_date) as first_date,
    MAX(publish_date) as last_date,
    ARRAY_AGG(DISTINCT category) FILTER (WHERE category IS NOT NULL) as categories,
    ARRAY_AGG(DISTINCT module) FILTER (WHERE module IS NOT NULL) as modules,
    ARRAY_AGG(DISTINCT working_arrangement) FILTER (WHERE working_arrangement IS NOT NULL) as arrangements,
    ARRAY_AGG(DISTINCT location) FILTER (WHERE location IS NOT NULL) as locations,
    ARRAY_AGG(DISTINCT buyer_contact) FILTER (WHERE buyer_contact IS NOT NULL AND buyer_contact LIKE '%@%') as emails
  INTO v_stats
  FROM buyict_opportunities
  WHERE organisation_id = p_org_id;
  
  -- Update the org
  UPDATE buyict_organisations
  SET 
    opportunity_count = COALESCE(v_stats.opp_count, 0),
    open_opportunity_count = COALESCE(v_stats.open_count, 0),
    first_opportunity_date = v_stats.first_date,
    last_opportunity_date = v_stats.last_date,
    common_categories = COALESCE(to_jsonb(v_stats.categories), '[]'::jsonb),
    common_modules = COALESCE(to_jsonb(v_stats.modules), '[]'::jsonb),
    common_working_arrangements = COALESCE(to_jsonb(v_stats.arrangements), '[]'::jsonb),
    common_locations = COALESCE(to_jsonb(v_stats.locations), '[]'::jsonb),
    contact_emails = COALESCE(to_jsonb(v_stats.emails), '[]'::jsonb),
    updated_at = NOW()
  WHERE id = p_org_id;
END;
$$;

-- ============================================================================
-- 7. Function to create/update org from opportunity
-- ============================================================================
CREATE OR REPLACE FUNCTION upsert_organisation_from_opportunity(p_opp_id UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_opp RECORD;
  v_org_id UUID;
  v_org_name TEXT;
BEGIN
  -- Get opportunity details
  SELECT * INTO v_opp FROM buyict_opportunities WHERE id = p_opp_id;
  
  IF v_opp IS NULL OR v_opp.buyer_entity_raw IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Use buyer_entity_raw as the org name (could be enhanced with mapping)
  v_org_name := TRIM(v_opp.buyer_entity_raw);
  
  -- Skip if name is too short or generic
  IF LENGTH(v_org_name) < 3 THEN
    RETURN NULL;
  END IF;
  
  -- Try to find existing org or create new one
  INSERT INTO buyict_organisations (space_id, name, raw_names)
  VALUES (
    v_opp.space_id, 
    v_org_name, 
    jsonb_build_array(v_org_name)
  )
  ON CONFLICT (space_id, name) 
  DO UPDATE SET 
    raw_names = (
      CASE 
        WHEN NOT buyict_organisations.raw_names ? v_org_name 
        THEN buyict_organisations.raw_names || jsonb_build_array(v_org_name)
        ELSE buyict_organisations.raw_names
      END
    ),
    updated_at = NOW()
  RETURNING id INTO v_org_id;
  
  -- Link opportunity to org
  UPDATE buyict_opportunities 
  SET organisation_id = v_org_id 
  WHERE id = p_opp_id;
  
  -- Refresh org stats
  PERFORM refresh_organisation_stats(v_org_id);
  
  RETURN v_org_id;
END;
$$;
