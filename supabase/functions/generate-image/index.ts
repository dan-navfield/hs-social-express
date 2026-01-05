import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface GenerateImageRequest {
  post_id: string
  space_id: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { post_id, space_id }: GenerateImageRequest = await req.json()

    if (!post_id || !space_id) {
      throw new Error('post_id and space_id are required')
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const geminiKey = Deno.env.get('GEMINI_API_KEY')

    if (!geminiKey) {
      throw new Error('GEMINI_API_KEY is not configured')
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Fetch the post
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, title, topic, body')
      .eq('id', post_id)
      .eq('space_id', space_id)
      .single()

    if (postError) throw postError
    if (!post) throw new Error('Post not found')

    // Fetch active image prompt template
    const { data: template, error: templateError } = await supabase
      .from('prompt_templates')
      .select('template')
      .eq('space_id', space_id)
      .eq('type', 'image_prompt')
      .eq('is_active', true)
      .single()

    if (templateError || !template) {
      throw new Error('No active image prompt template found. Please set one in Prompt Studio.')
    }

    // Update post to generating_image status
    await supabase
      .from('posts')
      .update({ status: 'generating_image' })
      .eq('id', post_id)

    try {
      // Substitute variables in template
      let prompt = template.template
        .replace(/\{topic\}/g, post.topic || post.title)
        .replace(/\{post_body\}/g, post.body || '')

      // Call Gemini API for image generation
      // Note: Gemini 2.0 Flash with image generation requires specific format
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
                    text: `Generate a professional LinkedIn post image based on this description:\n\n${prompt}\n\nThe image should be suitable for a LinkedIn post, professional, and visually engaging.`,
                  },
                ],
              },
            ],
            generationConfig: {
              responseModalities: ['image', 'text'],
              responseMimeType: 'image/png',
            },
          }),
        }
      )

      if (!geminiResponse.ok) {
        const errorData = await geminiResponse.text()
        throw new Error(`Gemini API error: ${errorData}`)
      }

      const geminiData = await geminiResponse.json()
      
      // Extract image data from response
      const imagePart = geminiData.candidates?.[0]?.content?.parts?.find(
        (part: any) => part.inlineData?.mimeType?.startsWith('image/')
      )

      if (!imagePart?.inlineData?.data) {
        // Gemini might not support image generation in this model version
        // Fall back to updating status without image
        await supabase
          .from('posts')
          .update({
            status: 'draft',
            image_meta: {
              error: 'Image generation not available in current model',
              attempted_at: new Date().toISOString(),
            },
          })
          .eq('id', post_id)

        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Image generation not available. Model may not support image output.',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Decode base64 image
      const imageData = imagePart.inlineData.data
      const mimeType = imagePart.inlineData.mimeType
      const imageBytes = Uint8Array.from(atob(imageData), c => c.charCodeAt(0))

      // Generate unique filename
      const fileName = `${post_id}_${Date.now()}.png`
      const filePath = `${space_id}/${fileName}`

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('generated-images')
        .upload(filePath, imageBytes, {
          contentType: mimeType,
          upsert: true,
        })

      if (uploadError) throw uploadError

      // Update post with image path
      await supabase
        .from('posts')
        .update({
          status: 'image_ready',
          generated_image_path: filePath,
          image_meta: {
            generated_at: new Date().toISOString(),
            mime_type: mimeType,
          },
        })
        .eq('id', post_id)

      return new Response(
        JSON.stringify({ 
          success: true, 
          image_path: filePath,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } catch (genError) {
      console.error(`Error generating image for post ${post_id}:`, genError)
      
      // Update post with error
      await supabase
        .from('posts')
        .update({
          status: 'failed',
          error: genError instanceof Error ? genError.message : 'Unknown error',
        })
        .eq('id', post_id)

      throw genError
    }
  } catch (error) {
    console.error('Error in generate-image:', error)
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
