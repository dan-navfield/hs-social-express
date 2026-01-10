// Supabase Edge Function: Apollo.io People Enrichment
// This proxies requests to Apollo API to avoid CORS issues

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const APOLLO_API_KEY = Deno.env.get('APOLLO_API_KEY') || ''

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface EnrichRequest {
    first_name: string
    last_name: string
    organization_name: string
    domain?: string
    title?: string
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }
    
    try {
        const { first_name, last_name, organization_name, domain, title } = await req.json() as EnrichRequest
        
        console.log(`Apollo: Searching for ${first_name} ${last_name} at ${organization_name}`)
        
        // Step 1: Search for the person
        const searchResponse = await fetch('https://api.apollo.io/v1/mixed_people/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'X-Api-Key': APOLLO_API_KEY
            },
            body: JSON.stringify({
                q_organization_domains: domain || undefined,
                q_organization_name: organization_name,
                person_titles: title ? [title] : undefined,
                q_keywords: `${first_name} ${last_name}`,
                page: 1,
                per_page: 5
            })
        })
        
        if (!searchResponse.ok) {
            const errorText = await searchResponse.text()
            console.error('Apollo search failed:', errorText)
            return new Response(
                JSON.stringify({ error: 'Search failed', details: errorText }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }
        
        const searchData = await searchResponse.json()
        console.log(`Apollo search: ${searchData.people?.length || 0} matches`)
        
        // Find best match
        const matchedPerson = searchData.people?.find((p: { first_name?: string; last_name?: string }) =>
            p.first_name?.toLowerCase() === first_name.toLowerCase() ||
            p.last_name?.toLowerCase() === last_name.toLowerCase()
        ) || searchData.people?.[0]
        
        if (!matchedPerson?.id) {
            return new Response(
                JSON.stringify({ person: null, message: 'No match found' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }
        
        console.log(`Apollo: Found match ID ${matchedPerson.id}`)
        
        // Step 2: Enrich by ID
        const enrichResponse = await fetch('https://api.apollo.io/v1/people/match', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'X-Api-Key': APOLLO_API_KEY
            },
            body: JSON.stringify({
                id: matchedPerson.id,
                reveal_personal_emails: true,
                reveal_phone_number: true
            })
        })
        
        if (!enrichResponse.ok) {
            const errorText = await enrichResponse.text()
            console.error('Apollo enrichment failed:', errorText)
            return new Response(
                JSON.stringify({ error: 'Enrichment failed', details: errorText }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }
        
        const enrichData = await enrichResponse.json()
        
        if (enrichData.person) {
            const p = enrichData.person
            
            // Extract mobile phone if available
            let phone = null
            if (p.phone_numbers?.length > 0) {
                const mobile = p.phone_numbers.find((ph: { type?: string }) => ph.type === 'mobile')
                phone = mobile?.sanitized_number || p.phone_numbers[0]?.sanitized_number
            }
            
            return new Response(
                JSON.stringify({
                    person: {
                        email: p.email || null,
                        phone: phone,
                        linkedin_url: p.linkedin_url || null,
                        photo_url: p.photo_url || null
                    }
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }
        
        return new Response(
            JSON.stringify({ person: null }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
        
    } catch (error) {
        console.error('Edge function error:', error)
        return new Response(
            JSON.stringify({ error: 'Server error', details: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
