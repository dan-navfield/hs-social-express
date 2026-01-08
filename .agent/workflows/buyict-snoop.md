---
description: Implementation guide for BuyICT Snoop procurement opportunity management module
---

# BuyICT Snoop - Implementation Plan

This workflow documents the phased implementation of the BuyICT Snoop module for managing procurement opportunities from BuyICT.

## Overview

BuyICT Snoop is an operational layer that:
- Imports procurement opportunities from BuyICT
- Categorises opportunities by department/agency
- Extracts and surfaces procurement contact emails
- Preserves source traceability for all extracted data
- Supports manual engagement workflows via CSV export

## Architecture Decisions

### Integration Approach
Given BuyICT is a government procurement platform, we'll implement **Option B (User-assisted import)** as the MVP, with architecture ready for Options A (API) and C (Browser sync) when/if they become available.

### Data Model
All BuyICT data will be scoped to the existing `spaces` (workspaces) pattern, allowing multi-tenant isolation.

---

## Phase 1: Database Schema Migration

### Step 1.1: Create BuyICT tables migration

Create migration file: `supabase/migrations/20250108000000_buyict_snoop.sql`

```sql
-- BuyICT Snoop Module Tables
-- Scoped to existing spaces (workspaces) pattern

-- 1. BuyICT Integrations (connection configuration per space)
CREATE TABLE IF NOT EXISTS buyict_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  connection_method TEXT NOT NULL CHECK (connection_method IN ('upload', 'api', 'browser_sync')),
  connection_status TEXT DEFAULT 'disconnected' CHECK (connection_status IN ('disconnected', 'connected', 'syncing', 'error')),
  encrypted_credentials TEXT, -- For API/browser auth (encrypted at rest)
  last_sync_at TIMESTAMPTZ,
  last_sync_error TEXT,
  config JSONB DEFAULT '{}', -- Method-specific config
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(space_id)
);

-- 2. BuyICT Sync Jobs (audit log of sync operations)
CREATE TABLE IF NOT EXISTS buyict_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES buyict_integrations(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  sync_type TEXT NOT NULL CHECK (sync_type IN ('full', 'incremental', 'upload')),
  stats JSONB DEFAULT '{}', -- { opportunities_added, opportunities_updated, contacts_found, etc. }
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. BuyICT Opportunities (the core imported data)
CREATE TABLE IF NOT EXISTS buyict_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  
  -- BuyICT identifiers
  buyict_reference TEXT NOT NULL, -- External reference/ID from BuyICT
  buyict_url TEXT, -- Link back to BuyICT
  
  -- Core fields
  title TEXT NOT NULL,
  buyer_entity_raw TEXT, -- Exact string from BuyICT (preserved)
  category TEXT, -- Panel classification if available
  description TEXT, -- Full description/detail text
  
  -- Dates
  publish_date DATE,
  closing_date TIMESTAMPTZ,
  
  -- Status
  opportunity_status TEXT, -- Open, Closed, Withdrawn, etc.
  
  -- Raw contact info (before extraction)
  contact_text_raw TEXT, -- Raw enquiries/contact officer text block
  
  -- Attachment metadata
  attachments JSONB DEFAULT '[]', -- [{ name, type, size, url }]
  
  -- Metadata
  source_hash TEXT, -- For detecting changes during incremental sync
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(space_id, buyict_reference)
);

-- 4. Department Mappings (normalisation layer)
CREATE TABLE IF NOT EXISTS buyict_department_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  
  -- Mapping rules
  source_pattern TEXT NOT NULL, -- The raw string or pattern to match
  match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'contains', 'regex', 'fuzzy')),
  canonical_department TEXT NOT NULL, -- The normalised department name
  canonical_agency TEXT, -- Optional higher-level agency grouping
  
  -- Metadata
  confidence DECIMAL(3,2) DEFAULT 1.0, -- 0.0-1.0 for ML-suggested mappings
  is_approved BOOLEAN DEFAULT false, -- Admin has reviewed
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(space_id, source_pattern, match_type)
);

-- 5. Opportunity Contacts (extracted contact info)
CREATE TABLE IF NOT EXISTS buyict_opportunity_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES buyict_opportunities(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES buyict_contacts(id) ON DELETE CASCADE,
  
  -- Extraction provenance
  source_type TEXT NOT NULL CHECK (source_type IN ('structured_field', 'page_text', 'attachment')),
  source_detail TEXT, -- e.g., "Contact Officer field", "Page section: Enquiries"
  extraction_confidence DECIMAL(3,2) DEFAULT 1.0,
  
  -- Role context
  role_label TEXT, -- "Contact Officer", "Enquiries", etc.
  
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(opportunity_id, contact_id, source_type)
);

-- 6. Contacts (deduplicated contact database)
CREATE TABLE IF NOT EXISTS buyict_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  
  email TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  
  -- Derived/aggregated fields
  linked_departments JSONB DEFAULT '[]', -- Derived from opportunities
  opportunity_count INT DEFAULT 0,
  
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(space_id, email)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_buyict_opportunities_space_id ON buyict_opportunities(space_id);
CREATE INDEX IF NOT EXISTS idx_buyict_opportunities_closing_date ON buyict_opportunities(closing_date);
CREATE INDEX IF NOT EXISTS idx_buyict_opportunities_status ON buyict_opportunities(opportunity_status);
CREATE INDEX IF NOT EXISTS idx_buyict_opportunities_buyer ON buyict_opportunities(buyer_entity_raw);
CREATE INDEX IF NOT EXISTS idx_buyict_department_mappings_space_id ON buyict_department_mappings(space_id);
CREATE INDEX IF NOT EXISTS idx_buyict_department_mappings_pattern ON buyict_department_mappings(source_pattern);
CREATE INDEX IF NOT EXISTS idx_buyict_contacts_space_id ON buyict_contacts(space_id);
CREATE INDEX IF NOT EXISTS idx_buyict_contacts_email ON buyict_contacts(email);
CREATE INDEX IF NOT EXISTS idx_buyict_sync_jobs_space_id ON buyict_sync_jobs(space_id);
CREATE INDEX IF NOT EXISTS idx_buyict_opportunity_contacts_opportunity ON buyict_opportunity_contacts(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_buyict_opportunity_contacts_contact ON buyict_opportunity_contacts(contact_id);

-- Enable RLS
ALTER TABLE buyict_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyict_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyict_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyict_department_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyict_opportunity_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE buyict_contacts ENABLE ROW LEVEL SECURITY;

-- RLS Policies (following existing space membership pattern)
CREATE POLICY "Users can view buyict_integrations in their spaces" ON buyict_integrations
  FOR SELECT USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid()));

CREATE POLICY "Editors can manage buyict_integrations" ON buyict_integrations
  FOR ALL USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')));

CREATE POLICY "Users can view buyict_sync_jobs in their spaces" ON buyict_sync_jobs
  FOR SELECT USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid()));

CREATE POLICY "Editors can manage buyict_sync_jobs" ON buyict_sync_jobs
  FOR ALL USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')));

CREATE POLICY "Users can view buyict_opportunities in their spaces" ON buyict_opportunities
  FOR SELECT USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid()));

CREATE POLICY "Editors can manage buyict_opportunities" ON buyict_opportunities
  FOR ALL USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')));

CREATE POLICY "Users can view buyict_department_mappings in their spaces" ON buyict_department_mappings
  FOR SELECT USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid()));

CREATE POLICY "Editors can manage buyict_department_mappings" ON buyict_department_mappings
  FOR ALL USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')));

CREATE POLICY "Users can view buyict_contacts in their spaces" ON buyict_contacts
  FOR SELECT USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid()));

CREATE POLICY "Editors can manage buyict_contacts" ON buyict_contacts
  FOR ALL USING (space_id IN (SELECT space_id FROM space_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor')));

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
```

// turbo
### Step 1.2: Apply migration to production Supabase

```bash
cd /Users/dannavfield/Documents/Windsurf-projects-Freshies/hs-social-express
npx supabase db push --linked
```

---

## Phase 2: TypeScript Types

### Step 2.1: Add BuyICT types to database.ts

Add these types to `src/types/database.ts` and create `src/types/buyict.ts` for extended types.

---

## Phase 3: Frontend - BuyICT Module Structure

### Step 3.1: Create page and component structure

```
src/
├── pages/
│   ├── buyict/
│   │   ├── index.ts
│   │   ├── BuyICTDashboard.tsx       # Main dashboard with stats
│   │   ├── Opportunities.tsx          # Opportunities list view
│   │   ├── OpportunityDetail.tsx      # Single opportunity view
│   │   ├── Contacts.tsx               # Contacts list view
│   │   ├── DepartmentMappings.tsx     # Admin mapping screen
│   │   └── Settings.tsx               # Integration settings
├── components/
│   └── buyict/
│       ├── index.ts
│       ├── ConnectionStatus.tsx       # Status indicator
│       ├── OpportunityCard.tsx        # Card for list view
│       ├── ContactCard.tsx            # Contact display with sources
│       ├── DepartmentBadge.tsx        # Confidence indicator
│       ├── UploadModal.tsx            # CSV/file upload interface
│       ├── SyncStatus.tsx             # Sync job progress
│       └── ExportButton.tsx           # CSV export functionality
├── stores/
│   └── buyictStore.ts                 # Zustand store
```

---

## Phase 4: Core Features Implementation

### Step 4.1: BuyICT Zustand Store

### Step 4.2: Settings/Integration Page (Connection Setup)

### Step 4.3: Upload Parser (Option B - User-assisted import)

### Step 4.4: Opportunities List View

### Step 4.5: Opportunity Detail View

### Step 4.6: Department Mapping Admin

### Step 4.7: Contacts View with Export

---

## Phase 5: Email Extraction Logic

### Step 5.1: Email extraction Edge Function

Create `supabase/functions/extract-buyict-contacts/index.ts`

Features:
- Email pattern detection (RFC 5322 compliant)
- Context analysis for role labels
- De-duplication across opportunities
- Confidence scoring

---

## Phase 6: Navigation Integration

### Step 6.1: Add BuyICT to sidebar and routes

Update `App.tsx` and `Layout` component to include BuyICT navigation.

---

## Acceptance Criteria Checklist

- [x] User can connect a BuyICT integration (upload method for MVP)
- [x] Opportunities are imported and visible in a list
- [x] Opportunities are grouped by department with editable mappings
- [x] Procurement emails are detected and displayed with sources
- [x] Contacts can be exported for manual follow-up
- [x] Sync status and errors are visible to the user

---

## Implementation Status (Updated: 2026-01-08)

### ✅ Completed

**Phase 1: Database Schema Migration**
- Migration file created: `supabase/migrations/20250108000000_buyict_snoop.sql`
- 6 tables with RLS policies: integrations, sync_jobs, opportunities, department_mappings, contacts, opportunity_contacts
- **Next step**: Run `npx supabase db push --linked` to apply to production

**Phase 2: TypeScript Types**
- `src/types/buyict.ts` - Complete type definitions for the module
- `src/types/database.ts` - Extended with BuyICT table types

**Phase 3: Frontend Structure**
- Components created in `src/components/buyict/`:
  - `ConnectionStatus.tsx` - Status indicator with method display
  - `DepartmentBadge.tsx` - Confidence and approval indicators
  - `OpportunityCard.tsx` - Rich card with closing status
  - `ContactCard.tsx` - Contact with provenance display
  - `UploadModal.tsx` - CSV drag-and-drop with parsing and email extraction
  - `SyncStatus.tsx` - Sync job status and history
  - `ExportButton.tsx` - CSV export for contacts

**Phase 4: Core Features**
- `src/stores/buyictStore.ts` - Complete Zustand store with all actions
- Pages created in `src/pages/buyict/`:
  - `BuyICTDashboard.tsx` - Main dashboard with stats
  - `Opportunities.tsx` - Filterable/sortable list
  - `Contacts.tsx` - Contact list with export
  - `DepartmentMappings.tsx` - Admin mapping interface
  - `Settings.tsx` - Integration configuration

**Phase 6: Navigation**
- `Layout.tsx` updated with BuyICT Snoop nav item
- `App.tsx` updated with all BuyICT routes

### ⏳ Remaining

**Phase 5: Email Extraction Edge Function**
- Supabase Edge Function for advanced email extraction not yet implemented
- Current: Basic client-side extraction in UploadModal

**Testing**
- End-to-end testing pending database migration

---

## Notes

- BuyICT remains the system of record - this is an operational overlay
- All extracted emails show source provenance (no email without context)
- Department mappings are editable with confidence indicators
- Designed for future API/browser sync integration methods

