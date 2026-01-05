// Generate Content Ideas for a Campaign
// Uses brand context + settings to generate topic ideas

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface GenerationSettings {
    topics?: string
    example_post?: string
    tone_modifiers?: string
    audience_notes?: string
    target_topics?: string
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { campaign_id, count } = await req.json()

        if (!campaign_id) {
            return new Response(
                JSON.stringify({ error: 'campaign_id is required' }),
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

        // Fetch campaign
        const { data: campaign, error: campaignError } = await supabase
            .from('campaigns')
            .select('*')
            .eq('id', campaign_id)
            .single()

        if (campaignError || !campaign) {
            return new Response(
                JSON.stringify({ error: 'Campaign not found' }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const targetCount = count || campaign.target_count || 10
        const genSettings = (campaign.generation_settings || {}) as GenerationSettings

        // Fetch brand profile for context
        const { data: profile } = await supabase
            .from('brand_profile')
            .select('*')
            .eq('space_id', campaign.space_id)
            .single()

        // Build context for idea generation
        let brandContext = ''
        if (profile) {
            if (profile.detected_name) brandContext += `Brand: ${profile.detected_name}\n`
            if (profile.taglines?.length) brandContext += `Taglines: ${profile.taglines.join(', ')}\n`
            if (profile.services?.length) brandContext += `Services: ${profile.services.join(', ')}\n`
            if (profile.key_messaging) brandContext += `Key Messaging: ${profile.key_messaging}\n`
            if (profile.target_audience) brandContext += `Target Audience: ${profile.target_audience}\n`
            if (profile.tone_of_voice) brandContext += `Tone: ${profile.tone_of_voice}\n`
        }

        // Parse target topics if provided
        const targetTopicsList = genSettings.target_topics 
            ? genSettings.target_topics.split('\n').filter((t: string) => t.trim().length > 0)
            : []

        const systemPrompt = `You are a LinkedIn content strategist. Generate exactly ${targetCount} unique post topic ideas.

Each idea should be:
- A compelling one-liner that could become a full LinkedIn post
- Focused on thought leadership, insights, or valuable perspectives
- Varied in angle (mix of trends, lessons learned, advice, opinions, case observations)
- NOT generic marketing speak

${brandContext ? `BRAND CONTEXT:\n${brandContext}\n` : ''}
${genSettings.tone_modifiers ? `TONE: ${genSettings.tone_modifiers}\n` : ''}
${genSettings.audience_notes ? `TARGET AUDIENCE: ${genSettings.audience_notes}\n` : ''}
${genSettings.example_post ? `EXAMPLE POST STYLE (match this voice):\n${genSettings.example_post}\n` : ''}
${targetTopicsList.length > 0 ? `
INSPIRATION TOPICS (use some of these as jumping-off points, but DON'T make all posts about them - create variety):
${targetTopicsList.map((t: string) => `- ${t}`).join('\n')}

Create roughly ${Math.min(Math.ceil(targetTopicsList.length * 1.5), Math.floor(targetCount * 0.6))} ideas inspired by these topics, and the rest on related but different themes.
` : ''}

Return ONLY a JSON array of strings, each being a topic idea. Example format:
["Topic idea 1", "Topic idea 2", "Topic idea 3"]

Do not include numbering, bullets, or any other formatting. Just the JSON array.`

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
                    { role: 'user', content: `Generate ${targetCount} LinkedIn post topic ideas.` },
                ],
                temperature: 0.9,
                max_tokens: 2000,
            }),
        })

        if (!openaiResponse.ok) {
            const errorText = await openaiResponse.text()
            console.error('OpenAI error:', errorText)
            return new Response(
                JSON.stringify({ error: 'Failed to generate ideas' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const openaiData = await openaiResponse.json()
        const content = openaiData.choices?.[0]?.message?.content || '[]'

        // Parse the JSON array
        let ideas: string[] = []
        try {
            // Handle potential markdown code blocks
            const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
            ideas = JSON.parse(cleanedContent)
        } catch (parseError) {
            console.error('Parse error:', parseError, 'Content:', content)
            // Fallback: try to extract lines
            ideas = content.split('\n').filter((line: string) => line.trim().length > 10)
        }

        // Update campaign with generated ideas
        await supabase
            .from('campaigns')
            .update({
                generation_settings: {
                    ...genSettings,
                    generated_ideas: ideas,
                },
                updated_at: new Date().toISOString(),
            })
            .eq('id', campaign_id)

        return new Response(
            JSON.stringify({ 
                success: true, 
                ideas,
                count: ideas.length,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Error:', error)
        return new Response(
            JSON.stringify({ error: 'Internal server error', details: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
