// Apply logo overlay - Using simple approach without complex image libraries
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ApplyLogoRequest {
  image_id: string
  post_id: string
  space_id: string
  logo_position: 'top-left' | 'bottom-right' | 'both' | 'main-top-left'
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  console.log('apply-logo: Starting function execution')

  try {
    const { image_id, post_id, space_id, logo_position }: ApplyLogoRequest = await req.json()
    console.log(`apply-logo: Received request - image_id: ${image_id}, post_id: ${post_id}, space_id: ${space_id}, position: ${logo_position}`)

    if (!image_id || !post_id || !space_id) {
      throw new Error('image_id, post_id, and space_id are required')
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)
    console.log('apply-logo: Supabase client initialized')

    // Get the source image
    console.log(`apply-logo: Fetching source image with id: ${image_id}`)
    const { data: sourceImage, error: imageError } = await supabase
      .from('post_images')
      .select('*')
      .eq('id', image_id)
      .single()

    if (imageError) {
      console.error('apply-logo: Error fetching source image:', imageError)
      throw new Error(`Source image not found: ${imageError.message}`)
    }
    if (!sourceImage) {
      console.error('apply-logo: No source image data returned')
      throw new Error('Source image not found')
    }
    console.log(`apply-logo: Found source image with storage_path: ${sourceImage.storage_path}`)

    // Get the brand profile with logos
    console.log(`apply-logo: Fetching brand profile for space_id: ${space_id}`)
    const { data: brandProfile, error: brandError } = await supabase
      .from('brand_profile')
      .select('logo_top_left_url, logo_bottom_right_url, logo_url')
      .eq('space_id', space_id)
      .single()

    if (brandError) {
      console.error('apply-logo: Error fetching brand profile:', brandError)
      throw new Error(`Brand profile not found: ${brandError.message}`)
    }
    if (!brandProfile) {
      console.error('apply-logo: No brand profile data returned')
      throw new Error('Brand profile not found')
    }
    console.log(`apply-logo: Found brand profile - logo_url: ${brandProfile.logo_url}, top_left: ${brandProfile.logo_top_left_url}, bottom_right: ${brandProfile.logo_bottom_right_url}`)

    // Build logo configuration for client-side rendering
    const logoConfig: {
      top_left?: string
      bottom_right?: string
    } = {}

    if (logo_position === 'top-left' || logo_position === 'both') {
      logoConfig.top_left = brandProfile.logo_top_left_url || brandProfile.logo_url
    }
    
    if (logo_position === 'main-top-left') {
      logoConfig.top_left = brandProfile.logo_url // Use main logo
    }

    if (logo_position === 'bottom-right' || logo_position === 'both') {
      logoConfig.bottom_right = brandProfile.logo_bottom_right_url || brandProfile.logo_url
    }

    console.log(`apply-logo: Built logo config:`, JSON.stringify(logoConfig))

    if (!logoConfig.top_left && !logoConfig.bottom_right) {
      throw new Error('No logos configured in brand profile')
    }

    // Download the source image to copy it
    console.log(`apply-logo: Downloading source image from storage: ${sourceImage.storage_path}`)
    const { data: imageData, error: downloadError } = await supabase.storage
      .from('generated-images')
      .download(sourceImage.storage_path)

    if (downloadError) {
      console.error('apply-logo: Error downloading image:', downloadError)
      throw new Error(`Failed to download source image: ${downloadError.message}`)
    }
    if (!imageData) {
      console.error('apply-logo: No image data returned from download')
      throw new Error('Failed to download source image')
    }
    console.log('apply-logo: Successfully downloaded source image')

    const sourceBytes = new Uint8Array(await imageData.arrayBuffer())
    console.log(`apply-logo: Source image size: ${sourceBytes.length} bytes`)

    // Generate unique filename for final image - store in generated-images bucket
    // so it appears in the same gallery
    const fileName = `${post_id}/${Date.now()}_logo.png`
    console.log(`apply-logo: Uploading to generated-images bucket at path: ${fileName}`)

    // Upload to generated-images bucket (same as source) so it works with existing UI
    const { error: uploadError } = await supabase.storage
      .from('generated-images')
      .upload(fileName, sourceBytes, {
        contentType: 'image/png',
        upsert: true,
      })

    if (uploadError) {
      console.error('apply-logo: Error uploading to storage:', uploadError)
      throw new Error(`Upload failed: ${uploadError.message}`)
    }
    console.log('apply-logo: Successfully uploaded to generated-images bucket')

    // Create a NEW post_images record for the composited image
    // This will show up in the gallery alongside other images
    console.log(`apply-logo: Creating new post_images record for composited image`)
    const { data: newImageRecord, error: insertError } = await supabase
      .from('post_images')
      .insert({
        post_id: post_id,
        space_id: space_id,
        source_type: 'generated', // Using 'generated' since 'composited' is not in the DB constraint
        storage_path: fileName,
        generation_status: 'completed',
        is_primary: true, // Make the composited image the primary by default
        width: sourceImage.width || 1024,
        height: sourceImage.height || 1024,
        file_size: sourceBytes.length,
        mime_type: 'image/png',
        prompt_used: `[LOGO OVERLAY] ${logo_position} (from image ${image_id})`, // Using prompt_used column, not generation_prompt
      })
      .select()
      .single()

    if (insertError) {
      console.error('apply-logo: Error creating post_images record:', insertError)
      throw new Error(`Failed to create image record: ${insertError.message}`)
    }
    console.log('apply-logo: Successfully created new post_images record:', newImageRecord?.id)

    // Mark the source image as no longer primary (if it was)
    await supabase
      .from('post_images')
      .update({ is_primary: false })
      .eq('id', image_id)

    // Update the post with the final image path and logo configuration
    console.log(`apply-logo: Updating post ${post_id} with overlay_status`)
    const { error: postUpdateError } = await supabase
      .from('posts')
      .update({
        final_image_path: fileName,
        overlay_status: 'ready',
        publish_snapshot: {
          logo_overlay: logoConfig,
          source_image: sourceImage.storage_path,
          composited_image: fileName,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', post_id)

    if (postUpdateError) {
      console.error('apply-logo: Error updating post:', postUpdateError)
      // Don't throw - the image was created successfully
    }
    console.log('apply-logo: Successfully completed all operations')

    return new Response(
      JSON.stringify({
        success: true,
        final_image_path: fileName,
        new_image_id: newImageRecord?.id,
        logo_config: logoConfig,
        message: 'Logo overlay image created and set as primary.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in apply-logo:', error)
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
