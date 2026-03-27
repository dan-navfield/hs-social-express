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
        const { campaign_id, count_to_generate, ideas: providedIdeas } = await req.json()

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
        const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')

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

        // Load AI settings for this space
        const { data: aiSettings } = await supabase
            .from('ai_settings')
            .select('text_provider, text_model')
            .eq('space_id', typedCampaign.space_id)
            .maybeSingle()

        const textProvider = aiSettings?.text_provider || 'openai'
        const textModel = aiSettings?.text_model || 'gpt-4o-mini'
        console.log(`Using text provider: ${textProvider}, model: ${textModel}`)

        // Validate API key for chosen provider
        if (textProvider === 'openai' && !openaiApiKey) {
            return new Response(
                JSON.stringify({ error: 'OPENAI_API_KEY not configured' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }
        if (textProvider === 'claude' && !anthropicApiKey) {
            return new Response(
                JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured. Set it in Supabase secrets.' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

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

        // Get topics from provided ideas (if any) or from generation settings
        let topicsList: string[] = []
        if (providedIdeas && Array.isArray(providedIdeas) && providedIdeas.length > 0) {
            // Use the provided ideas (when generating for selected items)
            topicsList = providedIdeas.filter((t: string) => t && t.trim().length > 0)
        } else if (genSettings.topics) {
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

            const systemPrompt = `You are an experienced product and digital transformation practitioner writing for senior peers on LinkedIn.

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

            const userPrompt = `Write a LinkedIn post based on the following idea or topic:

"${topic}"

The post should feel modern, sharp, and human - written for experienced product, digital, and transformation leaders, not beginners.

Guidelines:

Open with a strong, opinionated hook that would stop a senior product or digital leader scrolling.

Use contemporary product language and ways of working (for example: discovery, hypotheses, product thinking, AI-assisted delivery, iteration, learning fast, real users, decision-making under uncertainty).

Assume the reader is aware of AI tools (such as AI-assisted coding and product workflows) and focus on how thinking, clarity, and judgement still matter.

Be confident and insightful, not salesy or preachy.

Avoid generic advice, buzzwords, and vague statements.

Write as if this comes from practitioners who have seen what works and what fails.

Keep the tone human, slightly witty, and thoughtful rather than corporate.

Include a clear takeaway or reflective question at the end to invite engagement.

Do NOT:

Mention campaign names, quarters, or planning periods.

Use emojis.

Sound like a marketing slogan or leadership quote.

Explain basic concepts as if the reader is new to digital or product work.`

            try {
                // Call LLM (OpenAI or Claude based on settings)
                const maxTokens = genSettings.post_length === 'long' ? 800 : genSettings.post_length === 'short' ? 300 : 500
                let generatedBody = ''
                let usageTokens = 0

                if (textProvider === 'claude') {
                    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: {
                            'x-api-key': anthropicApiKey!,
                            'content-type': 'application/json',
                            'anthropic-version': '2023-06-01',
                        },
                        body: JSON.stringify({
                            model: textModel,
                            max_tokens: maxTokens,
                            system: systemPrompt,
                            messages: [{ role: 'user', content: userPrompt }],
                            temperature: 0.7,
                        }),
                    })

                    if (!claudeResponse.ok) {
                        const errorText = await claudeResponse.text()
                        console.error('Claude API error:', errorText)
                        continue
                    }

                    const claudeData = await claudeResponse.json()
                    generatedBody = claudeData.content?.[0]?.text || ''
                    usageTokens = (claudeData.usage?.input_tokens || 0) + (claudeData.usage?.output_tokens || 0)
                } else {
                    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${openaiApiKey}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            model: textModel,
                            messages: [
                                { role: 'system', content: systemPrompt },
                                { role: 'user', content: userPrompt },
                            ],
                            temperature: 0.7,
                            max_tokens: maxTokens,
                        }),
                    })

                    if (!openaiResponse.ok) {
                        const errorText = await openaiResponse.text()
                        console.error('OpenAI API error:', errorText)
                        continue
                    }

                    const openaiData = await openaiResponse.json()
                    generatedBody = openaiData.choices?.[0]?.message?.content || ''
                    usageTokens = openaiData.usage?.total_tokens || 0
                }

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
                            provider: textProvider,
                            model: textModel,
                            tokens: usageTokens,
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
