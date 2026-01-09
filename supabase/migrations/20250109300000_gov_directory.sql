-- Government Directory Module
-- Tables for storing federal government agencies and their key people

-- =============================================================================
-- GOV_AGENCIES - Federal Government Agencies
-- =============================================================================
CREATE TABLE IF NOT EXISTS gov_agencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id UUID REFERENCES spaces(id) ON DELETE CASCADE,
    
    -- Core info from directory.gov.au
    name TEXT NOT NULL,
    short_name TEXT,
    acronym TEXT,
    website TEXT,
    
    -- Classification
    agency_type TEXT, -- 'department', 'agency', 'authority', 'commission', 'office'
    portfolio TEXT, -- Parent portfolio (e.g., "Defence", "Home Affairs")
    parent_agency_id UUID REFERENCES gov_agencies(id),
    
    -- Contact info
    head_office_address TEXT,
    postal_address TEXT,
    phone TEXT,
    email TEXT,
    abn TEXT,
    
    -- Org chart discovery
    org_chart_url TEXT,
    org_chart_status TEXT DEFAULT 'pending', -- 'pending', 'found', 'not_found', 'scraped', 'error'
    org_chart_last_scraped TIMESTAMPTZ,
    
    -- Source tracking
    directory_gov_id TEXT, -- ID from directory.gov.au if available
    directory_gov_url TEXT, -- Link to the agency page on directory.gov.au
    
    -- Notes & tracking
    notes TEXT,
    is_priority BOOLEAN DEFAULT FALSE, -- Mark as priority target
    
    -- Timestamps
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- Ensure unique agency per space
    UNIQUE(space_id, name)
);

-- =============================================================================
-- GOV_AGENCY_PEOPLE - Key People at Agencies
-- =============================================================================
CREATE TABLE IF NOT EXISTS gov_agency_people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID REFERENCES gov_agencies(id) ON DELETE CASCADE,
    
    -- Person info
    name TEXT NOT NULL,
    title TEXT, -- Position title
    division TEXT, -- Division/Group they lead
    bio TEXT,
    photo_url TEXT,
    
    -- Contact info (when publicly available)
    email TEXT,
    phone TEXT,
    
    -- LinkedIn discovery
    linkedin_url TEXT,
    linkedin_status TEXT DEFAULT 'pending', -- 'pending', 'found', 'not_found', 'verified'
    linkedin_last_checked TIMESTAMPTZ,
    
    -- Hierarchy
    seniority_level INTEGER, -- 1=Secretary, 2=Deputy Sec, 3=FAS/Group Manager, 4=Director, etc.
    reports_to_id UUID REFERENCES gov_agency_people(id),
    
    -- Source tracking
    source_url TEXT, -- URL where this person was found
    extracted_at TIMESTAMPTZ,
    extraction_method TEXT, -- 'manual', 'scraper', 'ai'
    
    -- Notes
    notes TEXT,
    is_key_contact BOOLEAN DEFAULT FALSE, -- Mark as key contact for outreach
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- GOV_AGENCY_RELATIONSHIPS - Track relationships with agencies
-- =============================================================================
CREATE TABLE IF NOT EXISTS gov_agency_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id UUID REFERENCES gov_agencies(id) ON DELETE CASCADE,
    
    -- Relationship details
    relationship_type TEXT, -- 'current_client', 'target', 'past_client', 'partner'
    status TEXT, -- 'active', 'dormant', 'prospecting'
    notes TEXT,
    
    -- Key dates
    first_engagement_date DATE,
    last_interaction_date DATE,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- INDEXES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_gov_agencies_space ON gov_agencies(space_id);
CREATE INDEX IF NOT EXISTS idx_gov_agencies_type ON gov_agencies(agency_type);
CREATE INDEX IF NOT EXISTS idx_gov_agencies_portfolio ON gov_agencies(portfolio);
CREATE INDEX IF NOT EXISTS idx_gov_agencies_priority ON gov_agencies(is_priority) WHERE is_priority = TRUE;

CREATE INDEX IF NOT EXISTS idx_gov_people_agency ON gov_agency_people(agency_id);
CREATE INDEX IF NOT EXISTS idx_gov_people_seniority ON gov_agency_people(seniority_level);
CREATE INDEX IF NOT EXISTS idx_gov_people_key_contact ON gov_agency_people(is_key_contact) WHERE is_key_contact = TRUE;

-- =============================================================================
-- RLS POLICIES
-- =============================================================================
ALTER TABLE gov_agencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_agency_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE gov_agency_relationships ENABLE ROW LEVEL SECURITY;

-- Agencies: Users can see agencies in their spaces
CREATE POLICY "Users can view agencies in their spaces" ON gov_agencies
    FOR SELECT USING (
        space_id IN (
            SELECT space_id FROM space_members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert agencies in their spaces" ON gov_agencies
    FOR INSERT WITH CHECK (
        space_id IN (
            SELECT space_id FROM space_members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update agencies in their spaces" ON gov_agencies
    FOR UPDATE USING (
        space_id IN (
            SELECT space_id FROM space_members WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete agencies in their spaces" ON gov_agencies
    FOR DELETE USING (
        space_id IN (
            SELECT space_id FROM space_members WHERE user_id = auth.uid()
        )
    );

-- People: Access through agency relationship
CREATE POLICY "Users can view people in their agencies" ON gov_agency_people
    FOR SELECT USING (
        agency_id IN (
            SELECT id FROM gov_agencies WHERE space_id IN (
                SELECT space_id FROM space_members WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY "Users can insert people in their agencies" ON gov_agency_people
    FOR INSERT WITH CHECK (
        agency_id IN (
            SELECT id FROM gov_agencies WHERE space_id IN (
                SELECT space_id FROM space_members WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY "Users can update people in their agencies" ON gov_agency_people
    FOR UPDATE USING (
        agency_id IN (
            SELECT id FROM gov_agencies WHERE space_id IN (
                SELECT space_id FROM space_members WHERE user_id = auth.uid()
            )
        )
    );

CREATE POLICY "Users can delete people in their agencies" ON gov_agency_people
    FOR DELETE USING (
        agency_id IN (
            SELECT id FROM gov_agencies WHERE space_id IN (
                SELECT space_id FROM space_members WHERE user_id = auth.uid()
            )
        )
    );

-- Relationships: Access through agency
CREATE POLICY "Users can manage relationships in their agencies" ON gov_agency_relationships
    FOR ALL USING (
        agency_id IN (
            SELECT id FROM gov_agencies WHERE space_id IN (
                SELECT space_id FROM space_members WHERE user_id = auth.uid()
            )
        )
    );
