// supabase/functions/hubspot-channels/index.ts
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
        const { space_id } = await req.json()

        if (!space_id) {
            return new Response(
                JSON.stringify({ error: 'space_id is required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseKey)

        // Get connection
        const { data: connection, error: connError } = await supabase
            .from('hubspot_connections')
            .select('*')
            .eq('space_id', space_id)
            .single()

        if (connError || !connection) {
            return new Response(
                JSON.stringify({ error: 'No HubSpot connection found', channels: [] }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const tokens = JSON.parse(connection.encrypted_tokens || '{}')
        const accessToken = tokens.access_token
        if (!accessToken) {
            return new Response(
                JSON.stringify({ error: 'No access token', channels: [] }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Fetch channels from HubSpot
        const response = await fetch('https://api.hubapi.com/broadcast/v1/channels/setting/publish/current', {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        })

        if (!response.ok) {
            const errorText = await response.text()
            return new Response(
                JSON.stringify({ error: `HubSpot error: ${errorText}`, channels: [] }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const channelsData = await response.json()

        // Map to simplified format
        const channels = (channelsData || []).map((ch: any) => ({
            channelGuid: ch.channelGuid,
            channelId: ch.channelId,
            name: ch.name,
            type: ch.channelType, // LINKEDIN, FACEBOOK, INSTAGRAM, TWITTER
            accountType: ch.accountType,
            username: ch.username,
        }))

        // Update account_meta with latest channels
        await supabase
            .from('hubspot_connections')
            .update({
                account_meta: {
                    ...(connection.account_meta as any || {}),
                    channels,
                    channels_updated_at: new Date().toISOString(),
                },
                updated_at: new Date().toISOString(),
            })
            .eq('id', connection.id)

        return new Response(
            JSON.stringify({ success: true, channels }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    } catch (error) {
        console.error('Error in hubspot-channels:', error)
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error', channels: [] }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
