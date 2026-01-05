import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface GeneratePromptRequest {
  post_id: string
  space_id: string
  style: 'realistic' | 'editorial'
  post_body: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { post_id, space_id, style, post_body }: GeneratePromptRequest = await req.json()

    if (!post_id || !space_id || !post_body) {
      throw new Error('post_id, space_id, and post_body are required')
    }

    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    if (!geminiKey) {
      throw new Error('GEMINI_API_KEY is not configured')
    }

    // Define style-specific system prompts
    const stylePrompts = {
      realistic: `You are an expert at creating image prompts for professional social media posts.
Given the post content, create a detailed image prompt that describes a REALISTIC, believable scene.
Focus on:
- Real-world settings and situations
- Natural lighting and composition
- Professional business contexts
- Authentic human interactions if applicable
- High-quality photography style

The image should complement the post message and resonate with a LinkedIn audience.`,
      
      editorial: `You are an expert at creating image prompts for professional social media posts.
Given the post content, create a detailed image prompt that is CONCEPTUAL and metaphor-driven.
Focus on:
- Abstract concepts made visual
- Symbolic representations of ideas
- Editorial or magazine-style imagery
- Bold compositions and striking visuals
- Thought-provoking imagery that sparks curiosity

The image should creatively interpret the post's message in an unexpected way.`,
    }

    // Call Gemini to generate the prompt
    const geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': geminiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `${stylePrompts[style]}

POST CONTENT:
${post_body}

Generate a concise but detailed image prompt (2-4 sentences) that would create a compelling visual for this post. 
The prompt should be ready to send directly to an image generation AI.
Do NOT include any preamble or explanation - just the image prompt itself.`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 300,
          },
        }),
      }
    )

    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.text()
      throw new Error(`Gemini API error: ${errorData}`)
    }

    const geminiData = await geminiResponse.json()
    const generatedPrompt = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

    if (!generatedPrompt) {
      throw new Error('Failed to generate prompt from Gemini')
    }

    // Update the post with the generated prompt
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    await supabase
      .from('posts')
      .update({
        image_prompt: generatedPrompt,
        image_prompt_style: style,
        image_status: 'prompt_ready',
        updated_at: new Date().toISOString(),
      })
      .eq('id', post_id)
      .eq('space_id', space_id)

    return new Response(
      JSON.stringify({
        success: true,
        prompt: generatedPrompt,
        style: style,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in generate-image-prompt:', error)
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
