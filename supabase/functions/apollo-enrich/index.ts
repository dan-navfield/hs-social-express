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
        
        console.log(`Apollo: Enriching ${first_name} ${last_name} at ${organization_name}, domain: ${domain}`)
        
        // Method 1: Try direct enrichment with name + org
        // Note: reveal_phone_number requires a webhook, so we only request emails
        console.log('Trying Method 1: Direct match with name + org')
        const enrichResponse = await fetch('https://api.apollo.io/v1/people/match', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'X-Api-Key': APOLLO_API_KEY
            },
            body: JSON.stringify({
                first_name: first_name,
                last_name: last_name,
                organization_name: organization_name,
                reveal_personal_emails: true
            })
        })
        
        const enrichData = await enrichResponse.json()
        console.log('Method 1 response:', JSON.stringify(enrichData).slice(0, 500))
        
        if (enrichData.person) {
            const p = enrichData.person
            console.log(`Apollo: Direct match found!`)
            
            // Get phone from phone_numbers if available (may already be in profile)
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
        
        // Method 2: Try with domain instead of org name
        if (domain) {
            console.log('Trying Method 2: Direct match with domain')
            const domainResponse = await fetch('https://api.apollo.io/v1/people/match', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                    'X-Api-Key': APOLLO_API_KEY
                },
                body: JSON.stringify({
                    first_name: first_name,
                    last_name: last_name,
                    domain: domain,
                    reveal_personal_emails: true
                })
            })
            
            const domainData = await domainResponse.json()
            console.log('Method 2 response:', JSON.stringify(domainData).slice(0, 500))
            
            if (domainData.person) {
                const p = domainData.person
                console.log(`Apollo: Domain match found!`)
                
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
        }
        
        // Method 3: Try mixed_people search endpoint (the non-deprecated one)
        console.log('Trying Method 3: Mixed people search')
        const searchResponse = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache',
                'X-Api-Key': APOLLO_API_KEY
            },
            body: JSON.stringify({
                q_keywords: `${first_name} ${last_name}`,
                organization_domains: domain ? [domain] : undefined,
                page: 1,
                per_page: 5
            })
        })
        
        const searchData = await searchResponse.json()
        console.log('Method 3 response:', JSON.stringify(searchData).slice(0, 500))
        
        if (searchData.people?.length > 0) {
            // Find best match
            const match = searchData.people.find((p: { first_name?: string; last_name?: string }) =>
                p.first_name?.toLowerCase() === first_name.toLowerCase() &&
                p.last_name?.toLowerCase() === last_name.toLowerCase()
            ) || searchData.people[0]
            
            if (match) {
                console.log(`Apollo: Search match found: ${match.first_name} ${match.last_name}`)
                
                let phone = null
                if (match.phone_numbers?.length > 0) {
                    const mobile = match.phone_numbers.find((ph: { type?: string }) => ph.type === 'mobile')
                    phone = mobile?.sanitized_number || match.phone_numbers[0]?.sanitized_number
                }
                
                return new Response(
                    JSON.stringify({
                        person: {
                            email: match.email || null,
                            phone: phone,
                            linkedin_url: match.linkedin_url || null,
                            photo_url: match.photo_url || null
                        }
                    }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }
        }
        
        console.log('Apollo: No match found with any method')
        return new Response(
            JSON.stringify({ person: null, message: 'No match found' }),
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
