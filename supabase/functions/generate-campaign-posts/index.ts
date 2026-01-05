// Generate Campaign Posts - RAG-based content generation
// This edge function generates posts for a campaign using:
// 1. Manual profile data
// 2. Website/SharePoint source chunks
// 3. OpenAI GPT-4 for generation with grounding rules

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
    length_rules?: string
    cta_rules?: string
    hashtag_rules?: string
    diversity_constraints?: string
    post_length?: 'short' | 'medium' | 'long'
    include_hashtags?: boolean
    include_cta?: boolean
    include_emojis?: 'none' | 'subtle' | 'frequent'
}

interface LockedSourceSettings {
    use_website?: boolean
    use_sharepoint?: boolean
    use_manual?: boolean
}

interface TemplateIds {
    text_template_id?: string
    image_template_id?: string
}

interface Campaign {
    id: string
    space_id: string
    name: string
    target_count: number
    locked_source_settings: LockedSourceSettings
    template_ids: TemplateIds
    generation_settings: GenerationSettings
    created_by: string
}

Deno.serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { campaign_id, count_to_generate } = await req.json()

        if (!campaign_id) {
            return new Response(
                JSON.stringify({ error: 'campaign_id is required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Initialize Supabase client with service role
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

        // Fetch campaign details
        const { data: campaign, error: campaignError } = await supabase
            .from('campaigns')
            .select('*')
            .eq('id', campaign_id)
            .single()

        if (campaignError || !campaign) {
            return new Response(
                JSON.stringify({ error: 'Campaign not found', details: campaignError }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const typedCampaign = campaign as Campaign
        const targetCount = count_to_generate || typedCampaign.target_count

        // Fetch prompt template
        const textTemplateId = typedCampaign.template_ids?.text_template_id
        let promptTemplate = ''

        if (textTemplateId) {
            const { data: template } = await supabase
                .from('prompt_templates')
                .select('template')
                .eq('id', textTemplateId)
                .single()

            if (template) {
                promptTemplate = template.template
            }
        }

        if (!promptTemplate) {
            // Default template if none selected
            promptTemplate = `Write a professional LinkedIn post about {topic}.
The post should be engaging and provide value to the reader.
Use the brand context provided to ensure consistency.
Keep it concise (100-200 words) and include a clear call to action.`
        }

        // Gather brand context based on source settings
        const sourceSettings = typedCampaign.locked_source_settings || {}
        let brandContext = ''
        const sourcesUsed: { type: string; id?: string; name?: string }[] = []

        // 1. Manual Profile
        if (sourceSettings.use_manual !== false) {
            const { data: profileFields } = await supabase
                .from('brand_manual_profile')
                .select('field_name, field_value')
                .eq('space_id', typedCampaign.space_id)

            if (profileFields && profileFields.length > 0) {
                brandContext += '## Brand Information\n'
                for (const field of profileFields) {
                    if (field.field_value) {
                        brandContext += `- ${field.field_name.replace(/_/g, ' ')}: ${field.field_value}\n`
                    }
                }
                brandContext += '\n'
                sourcesUsed.push({ type: 'manual_profile' })
            }
        }

        // 2. Website Sources
        if (sourceSettings.use_website !== false) {
            const { data: websiteDocs } = await supabase
                .from('source_documents')
                .select('id, title, content')
                .eq('space_id', typedCampaign.space_id)
                .eq('source_type', 'website')
                .limit(5)

            if (websiteDocs && websiteDocs.length > 0) {
                brandContext += '## Website Content\n'
                for (const doc of websiteDocs) {
                    if (doc.content && doc.content !== '(Content will be fetched by crawler)') {
                        brandContext += `### ${doc.title || 'Page'}\n${doc.content.slice(0, 1000)}\n\n`
                        sourcesUsed.push({ type: 'website', id: doc.id, name: doc.title || 'Unknown' })
                    }
                }
            }
        }

        // 3. SharePoint Sources
        if (sourceSettings.use_sharepoint) {
            const { data: sharepointDocs } = await supabase
                .from('source_documents')
                .select('id, title, content')
                .eq('space_id', typedCampaign.space_id)
                .eq('source_type', 'sharepoint')
                .limit(5)

            if (sharepointDocs && sharepointDocs.length > 0) {
                brandContext += '## SharePoint Documents\n'
                for (const doc of sharepointDocs) {
                    if (doc.content) {
                        brandContext += `### ${doc.title || 'Document'}\n${doc.content.slice(0, 1000)}\n\n`
                        sourcesUsed.push({ type: 'sharepoint', id: doc.id, name: doc.title || 'Unknown' })
                    }
                }
            }
        }

        // Build generation constraints
        const genSettings = typedCampaign.generation_settings || {}
        let constraints = ''
        if (genSettings.tone_modifiers) constraints += `Tone: ${genSettings.tone_modifiers}\n`
        if (genSettings.audience_notes) constraints += `Audience: ${genSettings.audience_notes}\n`
        if (genSettings.length_rules) constraints += `Length: ${genSettings.length_rules}\n`
        if (genSettings.cta_rules) constraints += `CTA: ${genSettings.cta_rules}\n`
        if (genSettings.hashtag_rules) constraints += `Hashtags: ${genSettings.hashtag_rules}\n`

        // Get topics from generation settings (user-provided list)
        let topicsList: string[] = []
        if (genSettings.topics) {
            topicsList = genSettings.topics.split('\n').filter((t: string) => t.trim().length > 0)
        }
        
        // If no topics provided, generate generic ones (fallback)
        if (topicsList.length === 0) {
            topicsList = generateTopics(targetCount)
        }

        // Get example post for style reference
        const examplePost = genSettings.example_post || ''

        // Generate posts
        const createdPosts: string[] = []

        // Build format instructions from settings
        const lengthWords = genSettings.post_length === 'short' ? '80-120' : genSettings.post_length === 'long' ? '280-350' : '180-220'
        const hashtagInstr = genSettings.include_hashtags === false ? 'Do NOT include any hashtags.' : 'Include 2-4 relevant hashtags at the end.'
        const ctaInstr = genSettings.include_cta === false ? 'Do NOT include a call-to-action.' : 'End with a subtle call-to-action or question to encourage engagement.'
        const emojiInstr = genSettings.include_emojis === 'none' 
            ? 'Do NOT use any emojis.' 
            : genSettings.include_emojis === 'frequent'
                ? 'Use emojis liberally throughout the post to add energy and visual interest.'
                : 'Use 1-2 emojis sparingly to add warmth without overdoing it.'

        for (let i = 0; i < Math.min(targetCount, topicsList.length); i++) {
            const topic = topicsList[i]
            const previousPosts = createdPosts.slice(-3).join('\n---\n')

            const systemPrompt = `You are a professional LinkedIn content writer. Your task is to create engaging posts that are grounded in the provided brand context.

LANGUAGE REQUIREMENT:
- ALWAYS use British/Australian English spelling and conventions
- Examples: specialise (not specialize), organisation (not organization), colour (not color), behaviour (not behavior), realise (not realize), centre (not center), programme (not program)
- Never use American English spellings

CRITICAL GROUNDING RULES:
1. Only include facts, claims, or details that can be traced to the brand context provided
2. If you cannot ground a specific detail in the context, do not include it
3. Never make up statistics, customer testimonials, or specific achievements not in the context
4. It's better to be general than to fabricate specifics

FORMAT REQUIREMENTS:
- Target length: ${lengthWords} words
- ${hashtagInstr}
- ${ctaInstr}
- ${emojiInstr}
- NEVER use em-dashes (—) or en-dashes (–). Use commas, periods, or colons instead.

${examplePost ? `STYLE REFERENCE - Match this format, structure, and voice:
---
${examplePost}
---
Analyze the above example for: paragraph length, opening hook style, use of questions, hashtag approach, overall tone. Match this style closely.
` : ''}
${constraints ? `GENERATION CONSTRAINTS:\n${constraints}\n` : ''}
${brandContext ? `BRAND CONTEXT:\n${brandContext}` : 'Note: No brand context provided, keep content general and avoid specific claims.'}

${previousPosts ? `PREVIOUS POSTS (ensure diversity, do not repeat ideas):\n${previousPosts}` : ''}`

            const userPrompt = `Write a LinkedIn post about this topic: "${topic}"

Do NOT mention campaign names, quarter references (like Q1, Q2, Q3, Q4), or planning period labels in the post. Focus only on the topic itself.`

            try {
                // Call OpenAI
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
                        temperature: 0.7,
                        max_tokens: genSettings.post_length === 'long' ? 800 : genSettings.post_length === 'short' ? 300 : 500,
                    }),
                })

                if (!openaiResponse.ok) {
                    const errorText = await openaiResponse.text()
                    console.error('OpenAI API error:', errorText)
                    continue
                }

                const openaiData = await openaiResponse.json()
                let generatedBody = openaiData.choices?.[0]?.message?.content || ''

                if (!generatedBody) continue

                // Post-process: remove em-dashes and en-dashes
                generatedBody = generatedBody
                    .replace(/—/g, ', ')  // em-dash to comma
                    .replace(/–/g, '-')    // en-dash to hyphen
                    .replace(/\s+,/g, ',') // clean up any double spaces before comma

                // Create post in database
                const { data: newPost, error: postError } = await supabase
                    .from('posts')
                    .insert({
                        space_id: typedCampaign.space_id,
                        campaign_id: campaign_id,
                        title: topic,
                        topic: topic,
                        body: generatedBody,
                        status: 'draft',
                        author_id: typedCampaign.created_by,
                        sequence_number: i + 1,
                        sources_used: sourcesUsed,
                        generation_meta: {
                            model: 'gpt-4o-mini',
                            tokens: openaiData.usage?.total_tokens || 0,
                            generated_at: new Date().toISOString(),
                        },
                        image_status: 'none',
                        overlay_status: 'none',
                    })
                    .select('id')
                    .single()

                if (postError) {
                    console.error('Error creating post:', postError)
                    continue
                }

                if (newPost) {
                    createdPosts.push(generatedBody)
                }
            } catch (genError) {
                console.error('Error generating post:', genError)
            }
        }

        // Update campaign status
        await supabase
            .from('campaigns')
            .update({
                status: createdPosts.length === targetCount ? 'completed' : 'completed',
                updated_at: new Date().toISOString(),
            })
            .eq('id', campaign_id)

        return new Response(
            JSON.stringify({
                success: true,
                posts_created: createdPosts.length,
                campaign_id,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Error in generate-campaign-posts:', error)
        return new Response(
            JSON.stringify({ error: 'Internal server error', details: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})

// Helper function to generate generic topic variations (fallback only)
function generateTopics(count: number): string[] {
    const baseTopics = [
        'Industry trends and insights',
        'Best practices for success',
        'Lessons learned from experience',
        'Key strategies that work',
        'Common challenges and solutions',
        'Future predictions and opportunities',
        'Expert tips and recommendations',
        'Case study highlights',
        'Innovation in our field',
        'Building stronger outcomes',
    ]

    const topics: string[] = []
    for (let i = 0; i < count; i++) {
        topics.push(baseTopics[i % baseTopics.length])
    }
    return topics
}
