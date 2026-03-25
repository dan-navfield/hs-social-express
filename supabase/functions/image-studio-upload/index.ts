import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const formData = await req.formData()
        const file = formData.get('file') as File | null
        const spaceId = formData.get('space_id') as string | null
        const tagsJson = formData.get('tags') as string | null

        if (!file || !spaceId) {
            return new Response(
                JSON.stringify({ error: 'file and space_id are required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (!file.type.startsWith('image/')) {
            return new Response(
                JSON.stringify({ error: 'Only image files are accepted' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (file.size > 10 * 1024 * 1024) {
            return new Response(
                JSON.stringify({ error: 'File too large (max 10MB)' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseKey)

        const bytes = new Uint8Array(await file.arrayBuffer())
        const timestamp = Date.now()
        const random = Math.random().toString(36).substring(2, 10)
        const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png'
        const storagePath = `image-studio/${spaceId}/uploads/${timestamp}-${random}.${ext}`
        const filename = `${timestamp}-${random}.${ext}`

        const { error: uploadError } = await supabase.storage
            .from('generated-images')
            .upload(storagePath, bytes, { contentType: file.type, upsert: true })

        if (uploadError) {
            return new Response(
                JSON.stringify({ error: 'Upload failed' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const { data: { publicUrl } } = supabase.storage
            .from('generated-images')
            .getPublicUrl(storagePath)

        const tags = tagsJson ? JSON.parse(tagsJson) : ['uploaded']

        const { data: asset, error: dbError } = await supabase
            .from('content_assets')
            .insert({
                space_id: spaceId,
                filename,
                storage_path: storagePath,
                public_url: publicUrl,
                mime_type: file.type,
                file_size: bytes.length,
                tags,
            })
            .select('id')
            .single()

        if (dbError) {
            return new Response(
                JSON.stringify({ error: 'Failed to save asset record' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        return new Response(
            JSON.stringify({ success: true, asset: { id: asset.id, publicUrl, storagePath } }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    } catch (error) {
        console.error('[image-studio-upload] Error:', error)
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Upload failed' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
