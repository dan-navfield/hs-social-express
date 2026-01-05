// SharePoint Browse - List available SharePoint sites, drives, and folders
// Used for folder selection in Brand Studio

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0'

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { space_id, action, site_id, drive_id, folder_id } = await req.json()

        if (!space_id) {
            return new Response(
                JSON.stringify({ error: 'space_id is required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabase = createClient(supabaseUrl, supabaseServiceKey)

        // Get access token
        const { data: connection } = await supabase
            .from('sharepoint_connections')
            .select('access_token, token_expires_at, status')
            .eq('space_id', space_id)
            .single()

        if (!connection || connection.status !== 'connected') {
            return new Response(
                JSON.stringify({ error: 'SharePoint not connected', need_auth: true }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Check if token expired
        if (new Date(connection.token_expires_at) < new Date()) {
            // Try to refresh token
            const refreshResult = await supabase.functions.invoke('sharepoint-oauth', {
                body: { action: 'refresh', space_id },
            })

            if (!refreshResult.data?.success) {
                return new Response(
                    JSON.stringify({ error: 'Token expired', need_auth: true }),
                    { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            // Refetch connection with new token
            const { data: refreshedConnection } = await supabase
                .from('sharepoint_connections')
                .select('access_token')
                .eq('space_id', space_id)
                .single()
            
            if (refreshedConnection) {
                connection.access_token = refreshedConnection.access_token
            }
        }

        const accessToken = connection.access_token

        // Helper function for Graph API calls
        const graphFetch = async (endpoint: string) => {
            const response = await fetch(`${GRAPH_BASE_URL}${endpoint}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`Graph API error: ${response.status} - ${errorText}`)
            }

            return response.json()
        }

        // ACTION: List SharePoint sites
        if (action === 'list_sites') {
            const result = await graphFetch('/sites?search=*')

            const sites = result.value.map((site: { id: string; displayName: string; name: string; webUrl: string }) => ({
                id: site.id,
                name: site.displayName || site.name,
                url: site.webUrl,
            }))

            return new Response(
                JSON.stringify({ sites }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // ACTION: List drives in a site
        if (action === 'list_drives') {
            if (!site_id) {
                return new Response(
                    JSON.stringify({ error: 'site_id required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            const result = await graphFetch(`/sites/${site_id}/drives`)

            const drives = result.value.map((drive: { id: string; name: string; driveType: string }) => ({
                id: drive.id,
                name: drive.name,
                type: drive.driveType,
            }))

            return new Response(
                JSON.stringify({ drives }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // ACTION: List folders/files in a drive or folder
        if (action === 'list_items') {
            if (!drive_id) {
                return new Response(
                    JSON.stringify({ error: 'drive_id required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            let endpoint = `/drives/${drive_id}/root/children`
            if (folder_id) {
                endpoint = `/drives/${drive_id}/items/${folder_id}/children`
            }

            const result = await graphFetch(endpoint)

            const items = result.value.map((item: {
                id: string
                name: string
                folder?: { childCount: number }
                file?: { mimeType: string }
                size: number
                lastModifiedDateTime: string
            }) => ({
                id: item.id,
                name: item.name,
                is_folder: !!item.folder,
                child_count: item.folder?.childCount,
                mime_type: item.file?.mimeType,
                size: item.size,
                modified_at: item.lastModifiedDateTime,
            }))

            return new Response(
                JSON.stringify({ items }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // ACTION: Add a folder as sync source
        if (action === 'add_source') {
            const { site_name, folder_path, folder_name } = await req.json() as { 
                site_name?: string
                folder_path?: string
                folder_name?: string
            } & { space_id: string; action: string; site_id?: string; drive_id?: string; folder_id?: string }

            if (!site_id || !drive_id) {
                return new Response(
                    JSON.stringify({ error: 'site_id and drive_id required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            // Get connection ID
            const { data: conn } = await supabase
                .from('sharepoint_connections')
                .select('id')
                .eq('space_id', space_id)
                .single()

            if (!conn) {
                return new Response(
                    JSON.stringify({ error: 'No connection found' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }

            // Create source
            const { data: source, error } = await supabase.from('sharepoint_sources').insert({
                space_id,
                connection_id: conn.id,
                site_id,
                site_name: site_name || null,
                drive_id,
                folder_path: folder_path || '/',
                folder_name: folder_name || 'Root',
            }).select().single()

            if (error) throw error

            return new Response(
                JSON.stringify({ success: true, source }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // ACTION: List configured sources
        if (action === 'list_sources') {
            const { data: sources } = await supabase
                .from('sharepoint_sources')
                .select('*')
                .eq('space_id', space_id)
                .order('created_at', { ascending: false })

            return new Response(
                JSON.stringify({ sources: sources || [] }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // ACTION: Remove a source
        if (action === 'remove_source') {
            const { source_id } = await req.json() as { source_id: string } & Record<string, unknown>

            await supabase.from('sharepoint_sources')
                .delete()
                .eq('id', source_id)
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
        console.error('Error in sharepoint-browse:', error)
        return new Response(
            JSON.stringify({ error: 'Failed to browse SharePoint', details: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
