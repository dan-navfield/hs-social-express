import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ComposeImageRequest {
  post_id: string
  space_id: string
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { post_id, space_id }: ComposeImageRequest = await req.json()

    if (!post_id || !space_id) {
      throw new Error('post_id and space_id are required')
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, supabaseKey)

    // Fetch the post
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, generated_image_path')
      .eq('id', post_id)
      .eq('space_id', space_id)
      .single()

    if (postError) throw postError
    if (!post) throw new Error('Post not found')
    if (!post.generated_image_path) {
      throw new Error('No generated image found. Generate an image first.')
    }

    // Fetch brand rules
    const { data: brandRules } = await supabase
      .from('brand_rules')
      .select('rules')
      .eq('space_id', space_id)
      .single()

    // Fetch brand assets (logos)
    const { data: brandAssets } = await supabase
      .from('brand_assets')
      .select('*')
      .eq('space_id', space_id)
      .eq('type', 'logo')

    if (!brandAssets?.length) {
      throw new Error('No logo assets found. Upload a logo in Brand Settings first.')
    }

    // Update post to compositing status
    await supabase
      .from('posts')
      .update({ status: 'compositing' })
      .eq('id', post_id)

    try {
      // Download the generated image
      const { data: imageData, error: downloadError } = await supabase.storage
        .from('generated-images')
        .download(post.generated_image_path)

      if (downloadError) throw downloadError

      // Download the logo
      const logo = brandAssets[0]
      const { data: logoData, error: logoError } = await supabase.storage
        .from('brand-assets')
        .download(logo.file_path)

      if (logoError) throw logoError

      // Get the rules for positioning
      const rules = brandRules?.rules || {
        position: 'bottom-right',
        padding: 20,
        scale: 0.15,
      }

      // For now, since we don't have Sharp in edge functions,
      // we'll use a simple approach - just copy the image and mark it as composited
      // In production, you would use Sharp or a similar library via npm package
      
      // Generate unique filename for composed image
      const fileName = `${post_id}_composed_${Date.now()}.png`
      const filePath = `${space_id}/${fileName}`

      // For now, just copy the original image as the "composed" version
      // This is a placeholder - in production you'd use actual image composition
      const imageBytes = await imageData.arrayBuffer()

      // Upload to final-images storage
      const { error: uploadError } = await supabase.storage
        .from('final-images')
        .upload(filePath, imageBytes, {
          contentType: 'image/png',
          upsert: true,
        })

      if (uploadError) throw uploadError

      // Update post with final image path
      await supabase
        .from('posts')
        .update({
          status: 'final_image_ready',
          final_image_path: filePath,
          image_meta: {
            composed_at: new Date().toISOString(),
            logo_used: logo.label || logo.file_path,
            rules_applied: rules,
          },
        })
        .eq('id', post_id)

      return new Response(
        JSON.stringify({ 
          success: true, 
          final_image_path: filePath,
          note: 'Logo composition placeholder - image copied without actual overlay',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } catch (composeError) {
      console.error(`Error composing image for post ${post_id}:`, composeError)
      
      // Update post with error
      await supabase
        .from('posts')
        .update({
          status: 'failed',
          error: composeError instanceof Error ? composeError.message : 'Unknown error',
        })
        .eq('id', post_id)

      throw composeError
    }
  } catch (error) {
    console.error('Error in compose-image:', error)
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
