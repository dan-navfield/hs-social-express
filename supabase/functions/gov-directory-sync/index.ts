// Gov Directory Sync Webhook
// Receives scraped agency data from the directory.gov.au Apify actor

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface AgencyPayload {
    name: string
    portfolio: string | null
    description: string | null
    website: string | null
    phone: string | null
    fax: string | null
    abn: string | null
    address: string | null
    type_of_body: string | null
    gfs_classification: string | null
    established_under: string | null
    established_info: string | null
    classification: string | null
    materiality: string | null
    creation_date: string | null
    directory_gov_url: string
}

interface WebhookPayload {
    spaceId: string
    agencies: AgencyPayload[]
    scrapedAt: string
    totalCount: number
    isFinal: boolean
    source: string
}

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders })
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseKey)

        const payload: WebhookPayload = await req.json()
        console.log(`Received ${payload.agencies.length} agencies from ${payload.source}`)

        if (!payload.spaceId) {
            return new Response(
                JSON.stringify({ error: 'Missing spaceId' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        let successCount = 0
        let errorCount = 0

        // Upsert each agency
        for (const agency of payload.agencies) {
            try {
                const agencyData = {
                    space_id: payload.spaceId,
                    name: agency.name,
                    portfolio: agency.portfolio,
                    website: agency.website,
                    phone: agency.phone,
                    // Store fax in notes for now
                    email: null,
                    abn: agency.abn,
                    head_office_address: agency.address,
                    agency_type: agency.type_of_body,
                    // Store additional fields in notes or dedicated columns
                    directory_gov_url: agency.directory_gov_url,
                    notes: [
                        agency.description && `Description: ${agency.description}`,
                        agency.gfs_classification && `GFS Classification: ${agency.gfs_classification}`,
                        agency.established_under && `Established Under: ${agency.established_under}`,
                        agency.established_info && `${agency.established_info}`,
                        agency.classification && `Classification: ${agency.classification}`,
                        agency.materiality && `Materiality: ${agency.materiality}`,
                        agency.creation_date && `Creation Date: ${agency.creation_date}`,
                        agency.fax && `Fax: ${agency.fax}`,
                    ].filter(Boolean).join('\n\n'),
                    last_synced_at: new Date().toISOString(),
                    org_chart_status: 'pending'
                }

                const { error } = await supabase
                    .from('gov_agencies')
                    .upsert(agencyData, { 
                        onConflict: 'space_id,name',
                        ignoreDuplicates: false 
                    })

                if (error) {
                    console.error(`Failed to upsert ${agency.name}:`, error.message)
                    errorCount++
                } else {
                    successCount++
                }
            } catch (err) {
                console.error(`Error processing ${agency.name}:`, err)
                errorCount++
            }
        }

        console.log(`Sync complete: ${successCount} success, ${errorCount} errors`)

        return new Response(
            JSON.stringify({
                success: true,
                processed: payload.agencies.length,
                successCount,
                errorCount,
                isFinal: payload.isFinal
            }),
            { 
                status: 200, 
                headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
        )

    } catch (error) {
        console.error('Webhook error:', error)
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
