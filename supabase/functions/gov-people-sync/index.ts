/**
 * Gov People Sync Webhook
 * 
 * Receives extracted personnel data from the org chart scraper
 * and upserts them into the gov_agency_people table.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

interface ExtractedPerson {
    name: string
    title: string
    division?: string
    seniority_level?: number
    photo_url?: string
    email?: string
    phone?: string
}

interface WebhookPayload {
    agencyId: string
    people: ExtractedPerson[]
    orgChartUrl?: string
    extractedAt: string
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
        console.log(`Received ${payload.people.length} people for agency ${payload.agencyId}`)

        if (!payload.agencyId) {
            return new Response(
                JSON.stringify({ error: 'Missing agencyId' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        let successCount = 0
        let errorCount = 0

        // Upsert each person
        for (const person of payload.people) {
            try {
                const personData = {
                    agency_id: payload.agencyId,
                    name: person.name,
                    title: person.title,
                    division: person.division || null,
                    seniority_level: person.seniority_level || null,
                    photo_url: person.photo_url || null,
                    email: person.email || null,
                    phone: person.phone || null,
                    source_url: payload.orgChartUrl || null,
                    extracted_at: payload.extractedAt,
                    extraction_method: 'ai'
                }

                // Upsert on agency_id + name combination
                const { error } = await supabase
                    .from('gov_agency_people')
                    .upsert(personData, { 
                        onConflict: 'agency_id,name',
                        ignoreDuplicates: false 
                    })

                if (error) {
                    console.error(`Failed to upsert ${person.name}:`, error.message)
                    errorCount++
                } else {
                    successCount++
                }
            } catch (err) {
                console.error(`Error processing ${person.name}:`, err)
                errorCount++
            }
        }

        // Update the agency's org chart status
        if (successCount > 0) {
            await supabase
                .from('gov_agencies')
                .update({
                    org_chart_status: 'scraped',
                    org_chart_url: payload.orgChartUrl,
                    org_chart_last_scraped: new Date().toISOString()
                })
                .eq('id', payload.agencyId)
        }

        console.log(`People sync complete: ${successCount} success, ${errorCount} errors`)

        return new Response(
            JSON.stringify({
                success: true,
                processed: payload.people.length,
                successCount,
                errorCount
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
