// BuyICT Snoop Module Types
// Extends the main database types for the procurement opportunity management module

import type { Json } from './database'

// ============================================================================
// Enums / Literals
// ============================================================================

export type BuyICTConnectionMethod = 'upload' | 'api' | 'browser_sync'

export type BuyICTConnectionStatus = 'disconnected' | 'connected' | 'syncing' | 'error'

export type BuyICTSyncJobStatus = 'pending' | 'running' | 'completed' | 'failed'

export type BuyICTSyncType = 'full' | 'incremental' | 'upload'

export type BuyICTMatchType = 'exact' | 'contains' | 'regex' | 'fuzzy'

export type BuyICTContactSourceType = 'structured_field' | 'page_text' | 'attachment'

// ============================================================================
// Database Row Types
// ============================================================================

export interface BuyICTIntegration {
  id: string
  space_id: string
  connection_method: BuyICTConnectionMethod
  connection_status: BuyICTConnectionStatus
  encrypted_credentials: string | null
  last_sync_at: string | null
  last_sync_error: string | null
  config: Json
  created_at: string
  updated_at: string
}

export interface BuyICTSyncJob {
  id: string
  space_id: string
  integration_id: string
  status: BuyICTSyncJobStatus
  sync_type: BuyICTSyncType
  stats: BuyICTSyncStats
  error: string | null
  started_at: string | null
  completed_at: string | null
  created_by: string
  created_at: string
}

export interface BuyICTSyncStats {
  opportunities_added?: number
  opportunities_updated?: number
  opportunities_unchanged?: number
  contacts_found?: number
  contacts_new?: number
  emails_extracted?: number
  errors?: string[]
  duration_ms?: number
}

export interface BuyICTOpportunity {
  id: string
  space_id: string
  buyict_reference: string
  buyict_url: string | null
  title: string
  buyer_entity_raw: string | null
  category: string | null
  description: string | null
  publish_date: string | null
  closing_date: string | null
  opportunity_status: string | null
  contact_text_raw: string | null
  attachments: BuyICTAttachment[]
  source_hash: string | null
  last_synced_at: string
  sync_job_id: string | null
  created_at: string
  updated_at: string
}

export interface BuyICTAttachment {
  name: string
  type: string
  size?: number
  url?: string
}

export interface BuyICTDepartmentMapping {
  id: string
  space_id: string
  source_pattern: string
  match_type: BuyICTMatchType
  canonical_department: string
  canonical_agency: string | null
  confidence: number
  is_approved: boolean
  is_auto_generated: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface BuyICTOpportunityContact {
  id: string
  opportunity_id: string
  contact_id: string
  source_type: BuyICTContactSourceType
  source_detail: string | null
  extraction_confidence: number
  role_label: string | null
  last_seen_at: string
  created_at: string
}

export interface BuyICTContact {
  id: string
  space_id: string
  email: string
  name: string | null
  phone: string | null
  linked_departments: string[]
  opportunity_count: number
  first_seen_at: string
  last_seen_at: string
  created_at: string
  updated_at: string
}

// ============================================================================
// Extended/Joined Types (for UI display)
// ============================================================================

/**
 * Opportunity with mapped department info
 */
export interface BuyICTOpportunityWithDepartment extends BuyICTOpportunity {
  canonical_department?: string | null
  canonical_agency?: string | null
  mapping_confidence?: number | null
  mapping_approved?: boolean | null
  contacts_count?: number
}

/**
 * Contact with linked opportunities and provenance
 */
export interface BuyICTContactWithProvenance extends BuyICTContact {
  opportunities: {
    id: string
    title: string
    buyict_reference: string
    source_type: BuyICTContactSourceType
    source_detail: string | null
    role_label: string | null
    extraction_confidence: number
  }[]
}

/**
 * Opportunity with full contact details
 */
export interface BuyICTOpportunityWithContacts extends BuyICTOpportunityWithDepartment {
  contacts: {
    id: string
    email: string
    name: string | null
    role_label: string | null
    source_type: BuyICTContactSourceType
    source_detail: string | null
    extraction_confidence: number
  }[]
}

// ============================================================================
// Upload/Import Types
// ============================================================================

/**
 * Structure for CSV/Excel import
 * Maps common BuyICT export column names to our model
 */
export interface BuyICTUploadRow {
  reference?: string
  'Reference'?: string
  'ATM ID'?: string
  'Opportunity ID'?: string
  
  title?: string
  'Title'?: string
  'Opportunity Title'?: string
  
  buyer?: string
  'Buyer'?: string
  'Agency'?: string
  'Department'?: string
  'Buying Entity'?: string
  
  category?: string
  'Category'?: string
  'Panel'?: string
  
  description?: string
  'Description'?: string
  'Summary'?: string
  
  publish_date?: string
  'Publish Date'?: string
  'Published'?: string
  
  closing_date?: string
  'Closing Date'?: string
  'Close Date'?: string
  'Closes'?: string
  
  status?: string
  'Status'?: string
  
  contact?: string
  'Contact'?: string
  'Contact Officer'?: string
  'Enquiries'?: string
  
  url?: string
  'URL'?: string
  'Link'?: string
}

/**
 * Parsed upload data ready for database insertion
 */
export interface BuyICTParsedOpportunity {
  buyict_reference: string
  title: string
  buyer_entity_raw: string | null
  category: string | null
  description: string | null
  publish_date: Date | null
  closing_date: Date | null
  opportunity_status: string | null
  contact_text_raw: string | null
  buyict_url: string | null
  attachments: BuyICTAttachment[]
}

// ============================================================================
// Email Extraction Types
// ============================================================================

export interface ExtractedEmail {
  email: string
  name: string | null
  role_label: string | null
  source_type: BuyICTContactSourceType
  source_detail: string
  confidence: number
}

// ============================================================================
// Filter/Query Types
// ============================================================================

export interface BuyICTOpportunityFilters {
  department?: string
  agency?: string
  status?: string
  closingDateFrom?: Date
  closingDateTo?: Date
  hasContacts?: boolean
  searchTerm?: string
}

export interface BuyICTContactFilters {
  department?: string
  searchTerm?: string
  minOpportunities?: number
}

// ============================================================================
// Export Types
// ============================================================================

export interface BuyICTContactExportRow {
  email: string
  name: string | null
  departments: string
  opportunity_count: number
  linked_opportunities: string
  first_seen: string
  last_seen: string
}
