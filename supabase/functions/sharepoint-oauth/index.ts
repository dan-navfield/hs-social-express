// SharePoint OAuth - Handle Microsoft OAuth flow for SharePoint access
// Supports both initiating auth and handling callback

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Microsoft OAuth endpoints
const MICROSOFT_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

// Required scopes for SharePoint/OneDrive access
const SCOPES = [
    'offline_access',
    'Sites.Read.All',
    'Files.Read.All',
    'User.Read',
].join(' ')

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const url = new URL(req.url)
        const action = url.searchParams.get('action') || 'authorize'

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const microsoftClientId = Deno.env.get('MICROSOFT_CLIENT_ID')
        const microsoftClientSecret = Deno.env.get('MICROSOFT_CLIENT_SECRET')
        const redirectUri = Deno.env.get('MICROSOFT_REDIRECT_URI') || `${supabaseUrl}/functions/v1/sharepoint-oauth?action=callback`

        if (!microsoftClientId || !microsoftClientSecret) {
            return new Response(
                JSON.stringify({ error: 'Microsoft OAuth not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.' }),
                { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        // ACTION: Start OAuth flow
        if (action === 'authorize') {
            const body = await req.json()
            const { space_id, frontend_redirect } = body

            if (!space_id) {
                return new Response(
                    JSON.stringify({ error: 'space_id is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            // Create state token with space_id and frontend redirect
            const state = btoa(JSON.stringify({ space_id, frontend_redirect: frontend_redirect || '/brand-studio' }))

            const authUrl = new URL(MICROSOFT_AUTH_URL)
            authUrl.searchParams.set('client_id', microsoftClientId)
            authUrl.searchParams.set('response_type', 'code')
            authUrl.searchParams.set('redirect_uri', redirectUri)
            authUrl.searchParams.set('scope', SCOPES)
            authUrl.searchParams.set('state', state)
            authUrl.searchParams.set('response_mode', 'query')

            return new Response(
                JSON.stringify({ auth_url: authUrl.toString() }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // ACTION: OAuth callback
        if (action === 'callback') {
            const code = url.searchParams.get('code')
            const state = url.searchParams.get('state')
            const error = url.searchParams.get('error')

            if (error) {
                return new Response(`OAuth Error: ${error}`, { status: 400 })
            }

            if (!code || !state) {
                return new Response('Missing code or state', { status: 400 })
            }

            // Decode state
            let stateData: { space_id: string; frontend_redirect: string }
            try {
                stateData = JSON.parse(atob(state))
            } catch {
                return new Response('Invalid state', { status: 400 })
            }

            // Exchange code for tokens
            const tokenResponse = await fetch(MICROSOFT_TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: microsoftClientId,
                    client_secret: microsoftClientSecret,
                    code,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code',
                    scope: SCOPES,
                }),
            })

            if (!tokenResponse.ok) {
                const errorText = await tokenResponse.text()
                console.error('Token exchange failed:', errorText)
                return new Response(`Token exchange failed: ${errorText}`, { status: 400 })
            }

            const tokens = await tokenResponse.json()

            // Get user info
            const userResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
                headers: { Authorization: `Bearer ${tokens.access_token}` },
            })

            let userEmail = null
            let tenantId = null
            if (userResponse.ok) {
                const userData = await userResponse.json()
                userEmail = userData.mail || userData.userPrincipalName
                // Extract tenant from token (simplified)
            }

            // Store connection
            const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)

            await supabase.from('sharepoint_connections').upsert({
                space_id: stateData.space_id,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                token_expires_at: expiresAt.toISOString(),
                user_email: userEmail,
                status: 'connected',
                connected_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }, { onConflict: 'space_id' })

            // Redirect back to frontend
            const frontendUrl = Deno.env.get('FRONTEND_URL') || 'http://localhost:5173'
            return Response.redirect(`${frontendUrl}${stateData.frontend_redirect}?sharepoint=connected`, 302)
        }

        // ACTION: Refresh token
        if (action === 'refresh') {
            const body = await req.json()
            const { space_id } = body

            const { data: connection } = await supabase
                .from('sharepoint_connections')
                .select('refresh_token')
                .eq('space_id', space_id)
                .single()

            if (!connection?.refresh_token) {
                return new Response(
                    JSON.stringify({ error: 'No refresh token found' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            const tokenResponse = await fetch(MICROSOFT_TOKEN_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: microsoftClientId,
                    client_secret: microsoftClientSecret,
                    refresh_token: connection.refresh_token,
                    grant_type: 'refresh_token',
                    scope: SCOPES,
                }),
            })

            if (!tokenResponse.ok) {
                await supabase.from('sharepoint_connections').update({
                    status: 'expired',
                    last_error: 'Token refresh failed',
                    updated_at: new Date().toISOString(),
                }).eq('space_id', space_id)

                return new Response(
                    JSON.stringify({ error: 'Token refresh failed' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            const tokens = await tokenResponse.json()
            const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)

            await supabase.from('sharepoint_connections').update({
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token || connection.refresh_token,
                token_expires_at: expiresAt.toISOString(),
                status: 'connected',
                updated_at: new Date().toISOString(),
            }).eq('space_id', space_id)

            return new Response(
                JSON.stringify({ success: true }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // ACTION: Get connection status
        if (action === 'status') {
            const body = await req.json()
            const { space_id } = body

            const { data: connection } = await supabase
                .from('sharepoint_connections')
                .select('status, user_email, connected_at, token_expires_at')
                .eq('space_id', space_id)
                .single()

            return new Response(
                JSON.stringify({
                    connected: connection?.status === 'connected',
                    user_email: connection?.user_email,
                    connected_at: connection?.connected_at,
                    expires_at: connection?.token_expires_at,
                }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // ACTION: Disconnect
        if (action === 'disconnect') {
            const body = await req.json()
            const { space_id } = body

            await supabase.from('sharepoint_connections')
                .delete()
                .eq('space_id', space_id)

            await supabase.from('sharepoint_sources')
                .delete()
                .eq('space_id', space_id)

            return new Response(
                JSON.stringify({ success: true }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        return new Response(
            JSON.stringify({ error: 'Unknown action' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Error in sharepoint-oauth:', error)
        return new Response(
            JSON.stringify({ error: 'Internal error', details: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
