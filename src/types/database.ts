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
        }
        Views: {}
        Functions: {}
        Enums: {}
    }
}
