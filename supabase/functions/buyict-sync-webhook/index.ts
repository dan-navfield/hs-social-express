/**
 * BuyICT Sync Webhook
 * 
 * This edge function receives scraped opportunity data from Apify
 * and upserts it into the buyict_opportunities table.
 * 
 * Endpoint: POST /functions/v1/buyict-sync-webhook
 * 
 * Expected payload:
 * {
 *   spaceId: string,
 *   opportunities: OpportunityData[],
 *   scrapedAt: string,
 *   totalCount: number
 * }
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface OpportunityPayload {
    buyict_reference: string
    buyict_url: string
    title: string
    buyer_entity_raw: string | null
    category: string | null
    description: string | null
    publish_date: string | null
    closing_date: string | null
    opportunity_status: string | null
    contact_text_raw: string | null
    rfq_id?: string | null
    target_sector?: string | null
    engagement_type?: string | null
    estimated_value?: string | null
    location?: string | null
    experience_level?: string | null
    working_arrangement?: string | null
    key_duties?: string | null
    criteria?: string[]
    attachments: { name: string; url: string; type: string }[]
    // Extended fields
    rfq_type?: string | null
    deadline_for_questions?: string | null
    buyer_contact?: string | null
    estimated_start_date?: string | null
    initial_contract_duration?: string | null
    extension_term?: string | null
    extension_term_details?: string | null
    number_of_extensions?: string | null
    industry_briefing?: string | null
    requirements?: string | null
    // Labour Hire specific fields
    opportunity_type?: string | null
    max_hours?: string | null
    security_clearance?: string | null
}

interface WebhookPayload {
    spaceId: string
    opportunities: OpportunityPayload[]
    scrapedAt: string
    totalCount: number
    source?: string
}

// Email extraction helper
function extractEmails(text: string): string[] {
    if (!text) return []
    const emailRegex = /[\w.-]+@[\w.-]+\.\w+/g
    const matches = text.match(emailRegex) || []
    // Filter out common false positives
    return matches.filter(email => 
        !email.includes('example.') &&
        !email.includes('test.') &&
        !email.startsWith('no-reply') &&
        !email.startsWith('noreply')
    )
}

// Parse date strings to ISO format
function parseDate(dateStr: string | null): string | null {
    if (!dateStr) return null
    
    try {
        // Try various date formats
        const date = new Date(dateStr)
        if (!isNaN(date.getTime())) {
            return date.toISOString()
        }
        
        // Try Australian format (DD/MM/YYYY)
        const auMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
        if (auMatch) {
            const [, day, month, year] = auMatch
            return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`).toISOString()
        }
        
        // Try "Day, DD Month YYYY" format
        const textMatch = dateStr.match(/\d{1,2}\s+\w+\s+\d{4}/)
        if (textMatch) {
            const date = new Date(textMatch[0])
            if (!isNaN(date.getTime())) {
                return date.toISOString()
            }
        }
    } catch {
        // Ignore parsing errors
    }
    
    return null
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders })
    }
    
    if (req.method !== 'POST') {
        return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
    
    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        
        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        
        const payload: WebhookPayload = await req.json()
        
        if (!payload.spaceId || !payload.opportunities) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields: spaceId and opportunities' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }
        
        console.log(`Received ${payload.opportunities.length} opportunities for space ${payload.spaceId}`)
        
        // Get or create integration record
        let { data: integration } = await supabase
            .from('buyict_integrations')
            .select('id')
            .eq('space_id', payload.spaceId)
            .single()
        
        if (!integration) {
            const { data: newIntegration, error: integrationError } = await supabase
                .from('buyict_integrations')
                .insert({
                    space_id: payload.spaceId,
                    connection_method: 'api',
                    connection_status: 'connected'
                })
                .select('id')
                .single()
            
            if (integrationError) {
                console.error('Failed to create integration:', integrationError)
                throw integrationError
            }
            integration = newIntegration
        }
        
        // Create sync job record
        const { data: syncJob, error: syncJobError } = await supabase
            .from('buyict_sync_jobs')
            .insert({
                space_id: payload.spaceId,
                integration_id: integration.id,
                status: 'running',
                sync_type: 'full',
                started_at: new Date().toISOString(),
                created_by: 'system' // Webhook doesn't have user context
            })
            .select('id')
            .single()
        
        if (syncJobError) {
            console.error('Failed to create sync job:', syncJobError)
            // Continue anyway
        }
        
        let opportunitiesAdded = 0
        let opportunitiesUpdated = 0
        let contactsFound = 0
        let emailsExtracted = 0
        const errors: string[] = []
        
        // Process each opportunity
        for (const opp of payload.opportunities) {
            try {
                // Prepare opportunity data with ALL fields
                const oppData = {
                    space_id: payload.spaceId,
                    buyict_reference: opp.buyict_reference,
                    buyict_url: opp.buyict_url,
                    title: opp.title,
                    buyer_entity_raw: opp.buyer_entity_raw,
                    category: opp.category,
                    description: opp.description || opp.requirements || opp.key_duties,
                    publish_date: parseDate(opp.publish_date),
                    closing_date: parseDate(opp.closing_date),
                    opportunity_status: opp.opportunity_status || 'Open',
                    contact_text_raw: opp.contact_text_raw || opp.buyer_contact,
                    attachments: opp.attachments || [],
                    // Extended fields
                    rfq_type: opp.rfq_type || opp.engagement_type,
                    rfq_id: opp.rfq_id,
                    deadline_for_questions: opp.deadline_for_questions,
                    buyer_contact: opp.buyer_contact,
                    estimated_start_date: opp.estimated_start_date,
                    initial_contract_duration: opp.initial_contract_duration,
                    extension_term: opp.extension_term,
                    extension_term_details: opp.extension_term_details,
                    number_of_extensions: opp.number_of_extensions,
                    industry_briefing: opp.industry_briefing,
                    requirements: opp.requirements,
                    criteria: opp.criteria || [],
                    location: opp.location,
                    working_arrangement: opp.working_arrangement,
                    engagement_type: opp.engagement_type,
                    // Labour Hire specific fields
                    opportunity_type: opp.opportunity_type,
                    key_duties: opp.key_duties,
                    experience_level: opp.experience_level,
                    max_hours: opp.max_hours,
                    security_clearance: opp.security_clearance,
                    last_synced_at: new Date().toISOString(),
                    sync_job_id: syncJob?.id
                }
                
                // Upsert opportunity
                const { data: existingOpp } = await supabase
                    .from('buyict_opportunities')
                    .select('id')
                    .eq('space_id', payload.spaceId)
                    .eq('buyict_reference', opp.buyict_reference)
                    .single()
                
                let opportunityId: string
                
                if (existingOpp) {
                    // Update existing
                    const { data: updated, error: updateError } = await supabase
                        .from('buyict_opportunities')
                        .update(oppData)
                        .eq('id', existingOpp.id)
                        .select('id')
                        .single()
                    
                    if (updateError) throw updateError
                    opportunityId = updated.id
                    opportunitiesUpdated++
                } else {
                    // Insert new
                    const { data: inserted, error: insertError } = await supabase
                        .from('buyict_opportunities')
                        .insert(oppData)
                        .select('id')
                        .single()
                    
                    if (insertError) throw insertError
                    opportunityId = inserted.id
                    opportunitiesAdded++
                }
                
                // Extract and process contacts from various fields
                const emailSources: { email: string; source: string }[] = []
                
                if (opp.contact_text_raw) {
                    const emails = extractEmails(opp.contact_text_raw)
                    emails.forEach(email => emailSources.push({ email, source: 'contact_field' }))
                }
                
                if (opp.description) {
                    const emails = extractEmails(opp.description)
                    emails.forEach(email => emailSources.push({ email, source: 'description' }))
                }
                
                // Process extracted emails
                for (const { email, source } of emailSources) {
                    emailsExtracted++
                    
                    // Upsert contact
                    const { data: existingContact } = await supabase
                        .from('buyict_contacts')
                        .select('id, opportunity_count')
                        .eq('space_id', payload.spaceId)
                        .eq('email', email.toLowerCase())
                        .single()
                    
                    let contactId: string
                    
                    if (existingContact) {
                        // Update existing contact
                        await supabase
                            .from('buyict_contacts')
                            .update({
                                opportunity_count: existingContact.opportunity_count + 1,
                                last_seen_at: new Date().toISOString()
                            })
                            .eq('id', existingContact.id)
                        
                        contactId = existingContact.id
                    } else {
                        // Create new contact
                        const { data: newContact, error: contactError } = await supabase
                            .from('buyict_contacts')
                            .insert({
                                space_id: payload.spaceId,
                                email: email.toLowerCase(),
                                opportunity_count: 1,
                                first_seen_at: new Date().toISOString(),
                                last_seen_at: new Date().toISOString()
                            })
                            .select('id')
                            .single()
                        
                        if (contactError) {
                            console.error('Failed to create contact:', contactError)
                            continue
                        }
                        
                        contactId = newContact.id
                        contactsFound++
                    }
                    
                    // Link contact to opportunity
                    await supabase
                        .from('buyict_opportunity_contacts')
                        .upsert({
                            opportunity_id: opportunityId,
                            contact_id: contactId,
                            source_type: source === 'contact_field' ? 'structured_field' : 'page_text',
                            source_detail: source,
                            extraction_confidence: 0.9,
                            last_seen_at: new Date().toISOString()
                        }, {
                            onConflict: 'opportunity_id,contact_id,source_type'
                        })
                }
                
            } catch (error) {
                console.error(`Error processing opportunity ${opp.buyict_reference}:`, error)
                errors.push(`${opp.buyict_reference}: ${error.message}`)
            }
        }
        
        // Update sync job with results
        if (syncJob) {
            const stats = {
                opportunities_added: opportunitiesAdded,
                opportunities_updated: opportunitiesUpdated,
                contacts_found: contactsFound,
                emails_extracted: emailsExtracted,
                errors: errors.length
            }
            
            await supabase
                .from('buyict_sync_jobs')
                .update({
                    status: errors.length === payload.opportunities.length ? 'failed' : 'completed',
                    stats,
                    completed_at: new Date().toISOString(),
                    error: errors.length > 0 ? errors.slice(0, 5).join('; ') : null
                })
                .eq('id', syncJob.id)
        }
        
        // Update integration status
        await supabase
            .from('buyict_integrations')
            .update({
                connection_status: 'connected',
                last_sync_at: new Date().toISOString()
            })
            .eq('id', integration.id)
        
        const response = {
            success: true,
            stats: {
                opportunitiesAdded,
                opportunitiesUpdated,
                contactsFound,
                emailsExtracted,
                errors: errors.length
            },
            syncJobId: syncJob?.id
        }
        
        console.log('Sync completed:', response)
        
        return new Response(
            JSON.stringify(response),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
        
    } catch (error) {
        console.error('Webhook error:', error)
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
