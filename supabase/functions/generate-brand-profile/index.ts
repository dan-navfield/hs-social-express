// Generate Brand Profile - Create draft profile from confirmed website content
// For Brand Studio wizard step 2

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    console.log('=== generate-brand-profile called ===')
    console.log('Method:', req.method)
    
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        console.log('Parsing request body...')
        const body = await req.json()
        console.log('Body received:', JSON.stringify(body))
        const { space_id, selected_urls, detected_name } = body

        if (!space_id) {
            return new Response(
                JSON.stringify({ error: 'space_id is required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const openaiApiKey = Deno.env.get('OPENAI_API_KEY')

        if (!openaiApiKey) {
            return new Response(
                JSON.stringify({ error: 'OPENAI_API_KEY not configured' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        console.log('Starting generate-brand-profile for space:', space_id)
        console.log('Selected URLs:', selected_urls)
        console.log('Detected name:', detected_name)

        // If selected_urls provided, mark them as confirmed first
        if (selected_urls && Array.isArray(selected_urls) && selected_urls.length > 0) {
            console.log('Marking documents as confirmed...')
            
            // First, clear any previous confirmations
            const { error: clearError } = await supabase
                .from('source_documents')
                .update({ is_confirmed: false })
                .eq('space_id', space_id)
                .eq('source_type', 'website')
            
            if (clearError) {
                console.error('Error clearing confirmations:', clearError)
            }

            // Then confirm selected URLs
            for (const url of selected_urls) {
                const { error: confirmError } = await supabase
                    .from('source_documents')
                    .update({ is_confirmed: true })
                    .eq('space_id', space_id)
                    .eq('url', url)
                
                if (confirmError) {
                    console.error('Error confirming URL:', url, confirmError)
                }
            }
            console.log('Documents confirmed')

            // Update detected name if provided
            if (detected_name) {
                console.log('Updating detected name in brand_context_cache...')
                const { error: nameError } = await supabase.from('brand_context_cache').update({
                    detected_name: detected_name,
                    updated_at: new Date().toISOString(),
                }).eq('space_id', space_id)
                
                if (nameError) {
                    console.error('Error updating detected_name:', nameError)
                }
            }
        }

        // Get confirmed source documents
        console.log('Fetching confirmed source documents...')
        const { data: docs, error: docsError } = await supabase
            .from('source_documents')
            .select('title, content, metadata')
            .eq('space_id', space_id)
            .eq('is_confirmed', true)
            .eq('source_type', 'website')
            .order('created_at', { ascending: true })

        if (docsError) {
            console.error('Error fetching docs:', docsError)
            throw docsError
        }

        console.log('Found', docs?.length || 0, 'confirmed documents')

        if (!docs || docs.length === 0) {
            return new Response(
                JSON.stringify({ error: 'No confirmed source documents found' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Compile content for analysis
        const pageContents = docs.map(doc => 
            `### ${doc.title || 'Page'}\n${doc.content?.slice(0, 2000) || ''}`
        ).join('\n\n')

        console.log('Page contents compiled, length:', pageContents.length)

        // Get detected business name
        const { data: cache } = await supabase
            .from('brand_context_cache')
            .select('detected_name')
            .eq('space_id', space_id)
            .single()

        const businessName = cache?.detected_name || detected_name || 'this business'
        console.log('Using business name:', businessName)

        // Generate profile using OpenAI
        const systemPrompt = `You are a brand strategist analyzing website content to create a brand profile. 
Your output should be concise and actionable. Focus on what's explicitly stated or strongly implied.
Do NOT make assumptions or add information not present in the content.
If information for a section is not available, say "Not specified in content."`

        const userPrompt = `Analyze the following website content for "${businessName}" and extract a brand profile.

WEBSITE CONTENT:
${pageContents}

---

Generate a JSON response with exactly this structure:
{
  "who_we_are": "A 2-3 sentence description of the company identity and mission",
  "what_we_do": "A concise list of main services or products offered",
  "who_we_serve": "Target audience or ideal customers based on the content",
  "tone_notes": "2-3 adjectives describing the brand's communication style",
  "themes": ["theme1", "theme2", "theme3"],
  "services": ["service1", "service2", "service3"]
}

Only include information that can be grounded in the content. Keep each section brief.`

        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.3,
                max_tokens: 800,
                response_format: { type: 'json_object' },
            }),
        })

        if (!openaiResponse.ok) {
            const errorText = await openaiResponse.text()
            console.error('OpenAI API error:', errorText)
            throw new Error('Failed to generate profile')
        }

        const openaiData = await openaiResponse.json()
        const generatedContent = openaiData.choices?.[0]?.message?.content

        let profile
        try {
            profile = JSON.parse(generatedContent)
        } catch {
            console.error('Failed to parse OpenAI response:', generatedContent)
            throw new Error('Invalid response format from AI')
        }

        console.log('Generated profile:', JSON.stringify(profile))

        // Store the generated profile
        console.log('Storing profile in database...')
        const { error: profileError } = await supabase.from('brand_profile').upsert({
            space_id,
            who_we_are: profile.who_we_are || null,
            what_we_do: profile.what_we_do || null,
            who_we_serve: profile.who_we_serve || null,
            tone_notes: profile.tone_notes || null,
            themes: Array.isArray(profile.themes) ? profile.themes : [],
            services: Array.isArray(profile.services) ? profile.services : [],
            is_system_generated: true,
            last_generated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        }, { onConflict: 'space_id' })

        if (profileError) {
            console.error('Error storing profile:', profileError)
            throw profileError
        }
        console.log('Profile stored successfully')

        // Update setup status to profile_draft
        console.log('Updating setup status...')
        const { error: statusError } = await supabase.from('brand_context_cache').update({
            setup_status: 'profile_draft',
            updated_at: new Date().toISOString(),
        }).eq('space_id', space_id)

        if (statusError) {
            console.error('Error updating status:', statusError)
        }
        console.log('Setup status updated')

        return new Response(
            JSON.stringify({ success: true, profile }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Error in generate-brand-profile:', error)
        return new Response(
            JSON.stringify({ error: 'Failed to generate profile', details: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
