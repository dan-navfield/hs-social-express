// supabase/functions/hubspot-send/index.ts
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
        const { post_id, space_id, channel_guid, scheduled_at } = await req.json()

        if (!post_id || !space_id) {
            return new Response(
                JSON.stringify({ error: 'post_id and space_id are required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseKey)

        // 1. Get HubSpot connection for this space
        const { data: connection, error: connError } = await supabase
            .from('hubspot_connections')
            .select('*')
            .eq('space_id', space_id)
            .single()

        if (connError || !connection) {
            return new Response(
                JSON.stringify({ error: 'No HubSpot connection found. Please connect HubSpot in Settings.' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Decrypt token (stored as JSON string with access_token, refresh_token)
        const tokens = JSON.parse(connection.encrypted_tokens || '{}')
        const accessToken = tokens.access_token
        if (!accessToken) {
            return new Response(
                JSON.stringify({ error: 'HubSpot access token not found. Please reconnect HubSpot.' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 2. Get the post
        const { data: post, error: postError } = await supabase
            .from('posts')
            .select('*')
            .eq('id', post_id)
            .eq('space_id', space_id)
            .single()

        if (postError || !post) {
            return new Response(
                JSON.stringify({ error: 'Post not found' }),
                { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        if (!post.body) {
            return new Response(
                JSON.stringify({ error: 'Post has no content body' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 3. Get image URL if available (prefer final_image_path with logo, fallback to generated)
        let photoUrl: string | null = null
        const imagePath = post.final_image_path || post.generated_image_path
        if (imagePath) {
            // Determine which bucket the image is in
            const bucket = post.final_image_path ? 'generated-images' : 'generated-images'
            const { data: signedUrlData } = await supabase.storage
                .from(bucket)
                .createSignedUrl(imagePath, 3600) // 1 hour expiry

            if (signedUrlData?.signedUrl) {
                photoUrl = signedUrlData.signedUrl
            }
        }

        // Also check post_images table for primary image
        if (!photoUrl) {
            const { data: postImage } = await supabase
                .from('post_images')
                .select('storage_path')
                .eq('post_id', post_id)
                .eq('is_primary', true)
                .single()

            if (postImage?.storage_path) {
                const { data: signedUrlData } = await supabase.storage
                    .from('generated-images')
                    .createSignedUrl(postImage.storage_path, 3600)

                if (signedUrlData?.signedUrl) {
                    photoUrl = signedUrlData.signedUrl
                }
            }
        }

        // 4. Resolve channel - use provided channel_guid or default from account_meta
        const targetChannel = channel_guid || (connection.account_meta as any)?.default_channel_guid
        if (!targetChannel) {
            return new Response(
                JSON.stringify({ error: 'No target channel specified. Please select a social channel.' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 5. Build HubSpot broadcast payload
        const broadcastPayload: Record<string, unknown> = {
            channelGuid: targetChannel,
            content: {
                body: post.body,
            },
            status: scheduled_at ? 'SCHEDULED' : 'DRAFT',
        }

        if (photoUrl) {
            (broadcastPayload.content as Record<string, unknown>).photoUrl = photoUrl
        }

        if (scheduled_at) {
            broadcastPayload.triggerAt = new Date(scheduled_at).getTime()
        }

        // 6. Send to HubSpot
        const hubspotResponse = await fetch('https://api.hubapi.com/broadcast/v1/broadcasts', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(broadcastPayload),
        })

        if (!hubspotResponse.ok) {
            const errorBody = await hubspotResponse.text()
            console.error('HubSpot API error:', errorBody)

            // Handle token expiry
            if (hubspotResponse.status === 401) {
                return new Response(
                    JSON.stringify({ error: 'HubSpot token expired. Please reconnect HubSpot in Settings.' }),
                    { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            return new Response(
                JSON.stringify({ error: `HubSpot API error: ${errorBody}` }),
                { status: hubspotResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const hubspotData = await hubspotResponse.json()

        // 7. Update post with HubSpot info
        const publishSnapshot = {
            body: post.body,
            title: post.title,
            image_path: imagePath,
            sent_at: new Date().toISOString(),
            channel_guid: targetChannel,
        }

        await supabase
            .from('posts')
            .update({
                status: 'sent_to_hubspot',
                hubspot_social_post_id: hubspotData.broadcastGuid || hubspotData.id,
                hubspot_status: hubspotData.status || 'SENT',
                hubspot_meta: hubspotData,
                publish_snapshot: publishSnapshot,
                updated_at: new Date().toISOString(),
            })
            .eq('id', post_id)

        return new Response(
            JSON.stringify({
                success: true,
                hubspot_id: hubspotData.broadcastGuid || hubspotData.id,
                hubspot_status: hubspotData.status,
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    } catch (error) {
        console.error('Error in hubspot-send:', error)
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
