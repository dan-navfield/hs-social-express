import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface GenerateRequest {
  post_ids: string[]
  space_id: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { post_ids, space_id }: GenerateRequest = await req.json()

    if (!post_ids?.length || !space_id) {
      throw new Error('post_ids and space_id are required')
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const openaiKey = Deno.env.get('OPENAI_API_KEY')

    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY is not configured')
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Fetch posts to generate
    const { data: posts, error: postsError } = await supabase
      .from('posts')
      .select('id, title, topic')
      .in('id', post_ids)
      .eq('space_id', space_id)

    if (postsError) throw postsError
    if (!posts?.length) throw new Error('No posts found')

    // Fetch active text prompt template
    const { data: template, error: templateError } = await supabase
      .from('prompt_templates')
      .select('template')
      .eq('space_id', space_id)
      .eq('type', 'linkedin_text')
      .eq('is_active', true)
      .single()

    if (templateError || !template) {
      throw new Error('No active text prompt template found. Please set one in Prompt Studio.')
    }

    // Update posts to generating_text status
    await supabase
      .from('posts')
      .update({ status: 'generating_text' })
      .in('id', post_ids)

    const results: { id: string; success: boolean; error?: string }[] = []

    // Generate text for each post
    for (const post of posts) {
      try {
        // Substitute variables in template
        let prompt = template.template
          .replace(/\{topic\}/g, post.topic || post.title)
          .replace(/\{audience\}/g, 'LinkedIn professionals')
          .replace(/\{tone_notes\}/g, 'professional, engaging')
          .replace(/\{constraints\}/g, 'under 3000 characters')

        // Call OpenAI API
        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4',
            messages: [
              {
                role: 'system',
                content: 'You are a professional LinkedIn content writer. Generate engaging, professional posts that drive engagement. IMPORTANT: Always use British/Australian English spelling and conventions (e.g., specialise, organisation, colour, behaviour, realise, centre, programme). Never use American English spellings.',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: 0.7,
            max_tokens: 1000,
          }),
        })

        if (!openaiResponse.ok) {
          const errorData = await openaiResponse.text()
          throw new Error(`OpenAI API error: ${errorData}`)
        }

        const openaiData = await openaiResponse.json()
        const generatedText = openaiData.choices[0]?.message?.content

        if (!generatedText) {
          throw new Error('No content generated from OpenAI')
        }

        // Update post with generated content
        await supabase
          .from('posts')
          .update({
            body: generatedText,
            status: 'draft',
            openai_meta: {
              model: openaiData.model,
              usage: openaiData.usage,
              generated_at: new Date().toISOString(),
            },
          })
          .eq('id', post.id)

        results.push({ id: post.id, success: true })
      } catch (postError) {
        console.error(`Error generating text for post ${post.id}:`, postError)
        
        // Update post with error
        await supabase
          .from('posts')
          .update({
            status: 'failed',
            error: postError instanceof Error ? postError.message : 'Unknown error',
          })
          .eq('id', post.id)

        results.push({ 
          id: post.id, 
          success: false, 
          error: postError instanceof Error ? postError.message : 'Unknown error',
        })
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        processed: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in generate-posts:', error)
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
