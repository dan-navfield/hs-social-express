import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ImageSettings {
  style: 'photographic' | 'illustrative'
  include_people: boolean
  include_text: boolean
  include_logos: boolean
  aspect_ratio: '1:1' | '4:5' | '16:9' | '9:16'
}

interface GenerateImagesRequest {
  post_id: string
  space_id: string
  prompt: string
  settings: ImageSettings
  count: number
}

const ASPECT_RATIO_DIMENSIONS = {
  '1:1': { width: 1024, height: 1024 },
  '4:5': { width: 1024, height: 1280 },
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { post_id, space_id, prompt, settings, count = 2 }: GenerateImagesRequest = await req.json()

    if (!post_id || !space_id || !prompt) {
      throw new Error('post_id, space_id, and prompt are required')
    }

    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    if (!geminiKey) {
      throw new Error('GEMINI_API_KEY is not configured')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Update post status to generating
    await supabase
      .from('posts')
      .update({ image_status: 'generating' })
      .eq('id', post_id)

    // Build enhanced prompt with settings
    const dimensions = ASPECT_RATIO_DIMENSIONS[settings?.aspect_ratio || '1:1']
    let enhancedPrompt = prompt

    // Add style modifier
    if (settings?.style === 'photographic') {
      enhancedPrompt = `Professional photograph: ${enhancedPrompt}. High-resolution, natural lighting, realistic style.`
    } else if (settings?.style === 'illustrative') {
      enhancedPrompt = `Editorial illustration: ${enhancedPrompt}. Clean, modern, vector-style illustration.`
    }

    // Add exclusions
    const exclusions = []
    if (!settings?.include_people) {
      exclusions.push('no people or faces')
    }
    if (!settings?.include_text) {
      exclusions.push('no text or words')
    }
    if (!settings?.include_logos) {
      exclusions.push('no logos or brand marks')
    }
    if (exclusions.length > 0) {
      enhancedPrompt += ` Requirements: ${exclusions.join(', ')}.`
    }

    // Get existing image count to determine if first image should be primary
    const { count: existingCount } = await supabase
      .from('post_images')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', post_id)

    const isFirstBatch = existingCount === 0

    // Generate images (sequentially to avoid rate limits)
    const generatedImages = []
    const errors = []

    for (let i = 0; i < count; i++) {
      try {
        // Create placeholder record
        const { data: imageRecord, error: insertError } = await supabase
          .from('post_images')
          .insert({
            post_id,
            space_id,
            source_type: 'generated',
            storage_path: `pending_${post_id}_${Date.now()}_${i}`,
            prompt_used: prompt,
            settings_used: settings,
            generation_status: 'generating',
            is_primary: isFirstBatch && i === 0,
            width: dimensions.width,
            height: dimensions.height,
          })
          .select()
          .single()

        if (insertError) throw insertError

        // Call Gemini 2.5 Flash Image (Nano Banana) for image generation
        const geminiResponse = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
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
                      text: `Generate a professional image for LinkedIn/social media. ${enhancedPrompt}`,
                    },
                  ],
                },
              ],
              generationConfig: {
                responseModalities: ['TEXT', 'IMAGE'],
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
          throw new Error('No image data in response')
        }

        // Decode base64 image
        const imageData = imagePart.inlineData.data
        const mimeType = imagePart.inlineData.mimeType
        const imageBytes = Uint8Array.from(atob(imageData), c => c.charCodeAt(0))

        // Generate unique filename
        const fileName = `${post_id}_${Date.now()}_${i}.png`
        const filePath = `${space_id}/${fileName}`

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('generated-images')
          .upload(filePath, imageBytes, {
            contentType: mimeType,
            upsert: true,
          })

        if (uploadError) throw uploadError

        // Update record with actual path
        await supabase
          .from('post_images')
          .update({
            storage_path: filePath,
            generation_status: 'completed',
            file_size: imageBytes.length,
            mime_type: mimeType,
          })
          .eq('id', imageRecord.id)

        generatedImages.push({
          id: imageRecord.id,
          path: filePath,
        })
      } catch (genError) {
        console.error(`Error generating image ${i + 1}:`, genError)
        errors.push({
          index: i,
          error: genError instanceof Error ? genError.message : 'Unknown error',
        })
      }
    }

    // Update post status based on results
    const finalStatus = generatedImages.length > 0 ? 'images_available' : 'failed'
    await supabase
      .from('posts')
      .update({
        image_status: finalStatus,
        image_settings: settings,
        updated_at: new Date().toISOString(),
      })
      .eq('id', post_id)

    return new Response(
      JSON.stringify({
        success: generatedImages.length > 0,
        generated: generatedImages,
        errors: errors.length > 0 ? errors : undefined,
        total_requested: count,
        total_generated: generatedImages.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in generate-post-images:', error)
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
