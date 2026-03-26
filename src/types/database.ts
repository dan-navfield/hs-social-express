export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

// Updated PostStatus for new workflow
export type PostStatus =
    | 'draft'
    | 'ready_to_publish'
    | 'scheduled'
    | 'published'
    | 'sent_to_hubspot'
    | 'failed'
    | 'generating_text'
    | 'generating_image'

export type ImageStatus = 'none' | 'generating' | 'ready' | 'failed'

export type OverlayStatus = 'none' | 'compositing' | 'ready' | 'failed'

export type CampaignStatus = 'draft' | 'running' | 'completed' | 'failed'

export type SourceType = 'website' | 'sharepoint' | 'manual'

export type SpaceRole = 'owner' | 'editor' | 'viewer'

export type PromptType = 'linkedin_text' | 'image_prompt'

export type ContentLayer = 'general' | 'things_we_sell' | 'market_insights' | 'hot_topics'

export type ContentCategory =
    | 'culture'
    | 'milestone'
    | 'behind_the_scenes'
    | 'product'
    | 'case_study'
    | 'testimonial'
    | 'industry_trend'
    | 'opinion'
    | 'data_insight'
    | 'news_reaction'
    | 'event'
    | 'trending'

export const CONTENT_LAYERS: { value: ContentLayer; label: string; description: string }[] = [
    { value: 'general', label: 'General', description: 'Brand awareness, culture, values' },
    { value: 'things_we_sell', label: 'Things We Sell', description: 'Products, services, case studies' },
    { value: 'market_insights', label: 'Market Insights', description: 'Industry trends, thought leadership' },
    { value: 'hot_topics', label: 'Hot Topics', description: 'Timely/reactive, what happened today' },
]

export const CONTENT_CATEGORIES: { value: ContentCategory; label: string; layer: ContentLayer }[] = [
    { value: 'culture', label: 'Culture & Team', layer: 'general' },
    { value: 'milestone', label: 'Milestones & Wins', layer: 'general' },
    { value: 'behind_the_scenes', label: 'Behind the Scenes', layer: 'general' },
    { value: 'product', label: 'Product/Service', layer: 'things_we_sell' },
    { value: 'case_study', label: 'Case Study', layer: 'things_we_sell' },
    { value: 'testimonial', label: 'Testimonial', layer: 'things_we_sell' },
    { value: 'industry_trend', label: 'Industry Trend', layer: 'market_insights' },
    { value: 'opinion', label: 'Opinion/POV', layer: 'market_insights' },
    { value: 'data_insight', label: 'Data & Research', layer: 'market_insights' },
    { value: 'news_reaction', label: 'News Reaction', layer: 'hot_topics' },
    { value: 'event', label: 'Event/Conference', layer: 'hot_topics' },
    { value: 'trending', label: 'Trending Topic', layer: 'hot_topics' },
]

// Generation settings stored in campaigns
export interface GenerationSettings {
    tone_modifiers?: string
    audience_notes?: string
    length_rules?: string
    cta_rules?: string
    hashtag_rules?: string
    diversity_constraints?: string
}

// Template IDs stored in campaigns
export interface TemplateIds {
    text_template_id?: string
    image_template_id?: string
}

// Locked source settings for campaigns
export interface LockedSourceSettings {
    use_website?: boolean
    use_sharepoint?: boolean
    use_manual?: boolean
}

export interface Database {
    public: {
        Tables: {
            spaces: {
                Row: {
                    id: string
                    name: string
                    created_by: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    name: string
                    created_by: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    name?: string
                    created_by?: string
                    created_at?: string
                }
            }
            space_members: {
                Row: {
                    id: string
                    space_id: string
                    user_id: string
                    role: SpaceRole
                    created_at: string
                }
                Insert: {
                    id?: string
                    space_id: string
                    user_id: string
                    role: SpaceRole
                    created_at?: string
                }
                Update: {
                    id?: string
                    space_id?: string
                    user_id?: string
                    role?: SpaceRole
                    created_at?: string
                }
            }
            prompt_templates: {
                Row: {
                    id: string
                    space_id: string
                    name: string
                    type: PromptType
                    template: string
                    version: number
                    is_active: boolean
                    created_by: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    space_id: string
                    name: string
                    type: PromptType
                    template: string
                    version?: number
                    is_active?: boolean
                    created_by: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    space_id?: string
                    name?: string
                    type?: PromptType
                    template?: string
                    version?: number
                    is_active?: boolean
                    created_by?: string
                    created_at?: string
                }
            }
            campaigns: {
                Row: {
                    id: string
                    space_id: string
                    name: string
                    target_count: number
                    status: CampaignStatus
                    locked_source_settings: LockedSourceSettings
                    template_ids: TemplateIds
                    generation_settings: GenerationSettings
                    created_by: string
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    space_id: string
                    name: string
                    target_count?: number
                    status?: CampaignStatus
                    locked_source_settings?: LockedSourceSettings
                    template_ids?: TemplateIds
                    generation_settings?: GenerationSettings
                    created_by: string
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    space_id?: string
                    name?: string
                    target_count?: number
                    status?: CampaignStatus
                    locked_source_settings?: LockedSourceSettings
                    template_ids?: TemplateIds
                    generation_settings?: GenerationSettings
                    created_by?: string
                    created_at?: string
                    updated_at?: string
                }
            }
            posts: {
                Row: {
                    id: string
                    space_id: string
                    campaign_id: string | null
                    title: string
                    topic: string | null
                    status: PostStatus
                    body: string | null
                    author_id: string
                    sequence_number: number | null
                    sources_used: Json
                    generation_meta: Json
                    likes: number
                    comments: number
                    openai_meta: Json | null
                    image_meta: Json | null
                    generated_image_path: string | null
                    final_image_path: string | null
                    image_status: ImageStatus
                    overlay_status: OverlayStatus
                    publish_snapshot: Json | null
                    hubspot_social_post_id: string | null
                    hubspot_status: string | null
                    hubspot_meta: Json | null
                    content_layer: ContentLayer | null
                    content_category: ContentCategory | null
                    scheduled_at: string | null
                    error: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    space_id: string
                    campaign_id?: string | null
                    title: string
                    topic?: string | null
                    status?: PostStatus
                    body?: string | null
                    author_id: string
                    sequence_number?: number | null
                    sources_used?: Json
                    generation_meta?: Json
                    likes?: number
                    comments?: number
                    openai_meta?: Json | null
                    image_meta?: Json | null
                    generated_image_path?: string | null
                    final_image_path?: string | null
                    image_status?: ImageStatus
                    overlay_status?: OverlayStatus
                    publish_snapshot?: Json | null
                    hubspot_social_post_id?: string | null
                    hubspot_status?: string | null
                    hubspot_meta?: Json | null
                    content_layer?: ContentLayer | null
                    content_category?: ContentCategory | null
                    scheduled_at?: string | null
                    error?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    space_id?: string
                    campaign_id?: string | null
                    title?: string
                    topic?: string | null
                    status?: PostStatus
                    body?: string | null
                    author_id?: string
                    sequence_number?: number | null
                    sources_used?: Json
                    generation_meta?: Json
                    likes?: number
                    comments?: number
                    openai_meta?: Json | null
                    image_meta?: Json | null
                    generated_image_path?: string | null
                    final_image_path?: string | null
                    image_status?: ImageStatus
                    overlay_status?: OverlayStatus
                    publish_snapshot?: Json | null
                    hubspot_social_post_id?: string | null
                    hubspot_status?: string | null
                    hubspot_meta?: Json | null
                    content_layer?: ContentLayer | null
                    content_category?: ContentCategory | null
                    scheduled_at?: string | null
                    error?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            brand_context_cache: {
                Row: {
                    id: string
                    space_id: string
                    compiled_text: string
                    compiled_from: Json
                    updated_at: string
                }
                Insert: {
                    id?: string
                    space_id: string
                    compiled_text: string
                    compiled_from?: Json
                    updated_at?: string
                }
                Update: {
                    id?: string
                    space_id?: string
                    compiled_text?: string
                    compiled_from?: Json
                    updated_at?: string
                }
            }
            brand_sources: {
                Row: {
                    id: string
                    space_id: string
                    source_type: SourceType
                    enabled: boolean
                    config: Json
                    created_at: string
                }
                Insert: {
                    id?: string
                    space_id: string
                    source_type: SourceType
                    enabled?: boolean
                    config?: Json
                    created_at?: string
                }
                Update: {
                    id?: string
                    space_id?: string
                    source_type?: SourceType
                    enabled?: boolean
                    config?: Json
                    created_at?: string
                }
            }
            brand_manual_profile: {
                Row: {
                    id: string
                    space_id: string
                    field_name: string
                    field_value: string | null
                    updated_at: string
                }
                Insert: {
                    id?: string
                    space_id: string
                    field_name: string
                    field_value?: string | null
                    updated_at?: string
                }
                Update: {
                    id?: string
                    space_id?: string
                    field_name?: string
                    field_value?: string | null
                    updated_at?: string
                }
            }
            source_documents: {
                Row: {
                    id: string
                    space_id: string
                    source_type: 'website' | 'sharepoint'
                    url: string | null
                    title: string | null
                    content: string | null
                    metadata: Json
                    last_scanned: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    space_id: string
                    source_type: 'website' | 'sharepoint'
                    url?: string | null
                    title?: string | null
                    content?: string | null
                    metadata?: Json
                    last_scanned?: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    space_id?: string
                    source_type?: 'website' | 'sharepoint'
                    url?: string | null
                    title?: string | null
                    content?: string | null
                    metadata?: Json
                    last_scanned?: string
                    created_at?: string
                }
            }
            source_chunks: {
                Row: {
                    id: string
                    document_id: string
                    chunk_index: number
                    content: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    document_id: string
                    chunk_index: number
                    content: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    document_id?: string
                    chunk_index?: number
                    content?: string
                    created_at?: string
                }
            }
            hubspot_connections: {
                Row: {
                    id: string
                    space_id: string
                    encrypted_tokens: string | null
                    scopes: string[] | null
                    account_meta: Json
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    space_id: string
                    encrypted_tokens?: string | null
                    scopes?: string[] | null
                    account_meta?: Json
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    space_id?: string
                    encrypted_tokens?: string | null
                    scopes?: string[] | null
                    account_meta?: Json
                    created_at?: string
                    updated_at?: string
                }
            }
            brand_assets: {
                Row: {
                    id: string
                    space_id: string
                    type: string
                    file_path: string
                    label: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    space_id: string
                    type: string
                    file_path: string
                    label?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    space_id?: string
                    type?: string
                    file_path?: string
                    label?: string | null
                    created_at?: string
                }
            }
            brand_rules: {
                Row: {
                    id: string
                    space_id: string
                    rules: Json
                    updated_at: string
                }
                Insert: {
                    id?: string
                    space_id: string
                    rules: Json
                    updated_at?: string
                }
                Update: {
                    id?: string
                    space_id?: string
                    rules?: Json
                    updated_at?: string
                }
            }
            // BuyICT Snoop Module Tables
            buyict_integrations: {
                Row: {
                    id: string
                    space_id: string
                    connection_method: 'upload' | 'api' | 'browser_sync'
                    connection_status: 'disconnected' | 'connected' | 'syncing' | 'error'
                    encrypted_credentials: string | null
                    last_sync_at: string | null
                    last_sync_error: string | null
                    config: Json
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    space_id: string
                    connection_method: 'upload' | 'api' | 'browser_sync'
                    connection_status?: 'disconnected' | 'connected' | 'syncing' | 'error'
                    encrypted_credentials?: string | null
                    last_sync_at?: string | null
                    last_sync_error?: string | null
                    config?: Json
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    space_id?: string
                    connection_method?: 'upload' | 'api' | 'browser_sync'
                    connection_status?: 'disconnected' | 'connected' | 'syncing' | 'error'
                    encrypted_credentials?: string | null
                    last_sync_at?: string | null
                    last_sync_error?: string | null
                    config?: Json
                    created_at?: string
                    updated_at?: string
                }
            }
            buyict_sync_jobs: {
                Row: {
                    id: string
                    space_id: string
                    integration_id: string
                    status: 'pending' | 'running' | 'completed' | 'failed'
                    sync_type: 'full' | 'incremental' | 'upload'
                    stats: Json
                    error: string | null
                    started_at: string | null
                    completed_at: string | null
                    created_by: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    space_id: string
                    integration_id: string
                    status?: 'pending' | 'running' | 'completed' | 'failed'
                    sync_type: 'full' | 'incremental' | 'upload'
                    stats?: Json
                    error?: string | null
                    started_at?: string | null
                    completed_at?: string | null
                    created_by: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    space_id?: string
                    integration_id?: string
                    status?: 'pending' | 'running' | 'completed' | 'failed'
                    sync_type?: 'full' | 'incremental' | 'upload'
                    stats?: Json
                    error?: string | null
                    started_at?: string | null
                    completed_at?: string | null
                    created_by?: string
                    created_at?: string
                }
            }
            buyict_opportunities: {
                Row: {
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
                    attachments: Json
                    source_hash: string | null
                    last_synced_at: string
                    sync_job_id: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    space_id: string
                    buyict_reference: string
                    buyict_url?: string | null
                    title: string
                    buyer_entity_raw?: string | null
                    category?: string | null
                    description?: string | null
                    publish_date?: string | null
                    closing_date?: string | null
                    opportunity_status?: string | null
                    contact_text_raw?: string | null
                    attachments?: Json
                    source_hash?: string | null
                    last_synced_at?: string
                    sync_job_id?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    space_id?: string
                    buyict_reference?: string
                    buyict_url?: string | null
                    title?: string
                    buyer_entity_raw?: string | null
                    category?: string | null
                    description?: string | null
                    publish_date?: string | null
                    closing_date?: string | null
                    opportunity_status?: string | null
                    contact_text_raw?: string | null
                    attachments?: Json
                    source_hash?: string | null
                    last_synced_at?: string
                    sync_job_id?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            buyict_department_mappings: {
                Row: {
                    id: string
                    space_id: string
                    source_pattern: string
                    match_type: 'exact' | 'contains' | 'regex' | 'fuzzy'
                    canonical_department: string
                    canonical_agency: string | null
                    confidence: number
                    is_approved: boolean
                    is_auto_generated: boolean
                    created_by: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    space_id: string
                    source_pattern: string
                    match_type: 'exact' | 'contains' | 'regex' | 'fuzzy'
                    canonical_department: string
                    canonical_agency?: string | null
                    confidence?: number
                    is_approved?: boolean
                    is_auto_generated?: boolean
                    created_by?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    space_id?: string
                    source_pattern?: string
                    match_type?: 'exact' | 'contains' | 'regex' | 'fuzzy'
                    canonical_department?: string
                    canonical_agency?: string | null
                    confidence?: number
                    is_approved?: boolean
                    is_auto_generated?: boolean
                    created_by?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            buyict_contacts: {
                Row: {
                    id: string
                    space_id: string
                    email: string
                    name: string | null
                    phone: string | null
                    linked_departments: Json
                    opportunity_count: number
                    first_seen_at: string
                    last_seen_at: string
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    space_id: string
                    email: string
                    name?: string | null
                    phone?: string | null
                    linked_departments?: Json
                    opportunity_count?: number
                    first_seen_at?: string
                    last_seen_at?: string
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    space_id?: string
                    email?: string
                    name?: string | null
                    phone?: string | null
                    linked_departments?: Json
                    opportunity_count?: number
                    first_seen_at?: string
                    last_seen_at?: string
                    created_at?: string
                    updated_at?: string
                }
            }
            buyict_opportunity_contacts: {
                Row: {
                    id: string
                    opportunity_id: string
                    contact_id: string
                    source_type: 'structured_field' | 'page_text' | 'attachment'
                    source_detail: string | null
                    extraction_confidence: number
                    role_label: string | null
                    last_seen_at: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    opportunity_id: string
                    contact_id: string
                    source_type: 'structured_field' | 'page_text' | 'attachment'
                    source_detail?: string | null
                    extraction_confidence?: number
                    role_label?: string | null
                    last_seen_at?: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    opportunity_id?: string
                    contact_id?: string
                    source_type?: 'structured_field' | 'page_text' | 'attachment'
                    source_detail?: string | null
                    extraction_confidence?: number
                    role_label?: string | null
                    last_seen_at?: string
                    created_at?: string
                }
            }
        }
        Views: {}
        Functions: {}
        Enums: {}
    }
}
