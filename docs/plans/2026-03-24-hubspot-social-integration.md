# HubSpot Social Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Send approved SocialExpress posts to HubSpot's Social Calendar via the Broadcast Messages API, with bulk send support.

**Architecture:** A new Supabase Edge Function `hubspot-send` receives a post ID, fetches the post + image, creates a signed public URL for the image, and calls HubSpot's Broadcast API to schedule it. The frontend already has `handleSendToHubSpot` wired up — we add the missing edge function, a HubSpot settings page for OAuth/channel config, and a bulk send action.

**Tech Stack:** Supabase Edge Functions (Deno), HubSpot Broadcast API v1, React + Tailwind frontend

---

## Existing Infrastructure (already in place)

- `posts` table has columns: `hubspot_social_post_id`, `hubspot_status`, `hubspot_meta`, `publish_snapshot`
- `hubspot_connections` table exists with: `id`, `space_id`, `encrypted_tokens`, `scopes`, `account_meta`
- `PostStatus` type includes `'sent_to_hubspot'`
- `StatusBadge` handles `sent_to_hubspot` (green badge, label "Sent")
- `Posts.tsx` has `handleSendToHubSpot()` calling `supabase.functions.invoke('hubspot-send', ...)`
- "Sent" tab in Posts page filters by `sent_to_hubspot` status

## What Needs Building

1. Edge function: `hubspot-send` (the backend that actually calls HubSpot)
2. Edge function: `hubspot-channels` (list available social channels)
3. HubSpot Settings UI (connect account, view channels)
4. Bulk "Send to HubSpot" action in Posts page
5. Channel selection before sending (pick LinkedIn vs Facebook etc.)

---

### Task 1: Create `hubspot-send` Edge Function

**Files:**
- Create: `supabase/functions/hubspot-send/index.ts`

**Step 1: Create the edge function**

```typescript
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
```

**Step 2: Deploy and set secret**

```bash
# Set HubSpot token as a Supabase secret (done once after Private App is created in HubSpot)
supabase secrets set HUBSPOT_ACCESS_TOKEN=pat-na1-xxxxxxxx --project-ref dbfrxagaccnitfpdtpen

# Deploy the function
supabase functions deploy hubspot-send --project-ref dbfrxagaccnitfpdtpen
```

**Step 3: Commit**

```bash
git add supabase/functions/hubspot-send/index.ts
git commit -m "feat: add hubspot-send edge function for social posting"
```

---

### Task 2: Create `hubspot-channels` Edge Function

**Files:**
- Create: `supabase/functions/hubspot-channels/index.ts`

**Step 1: Create the edge function**

```typescript
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
```

**Step 2: Deploy**

```bash
supabase functions deploy hubspot-channels --project-ref dbfrxagaccnitfpdtpen
```

**Step 3: Commit**

```bash
git add supabase/functions/hubspot-channels/index.ts
git commit -m "feat: add hubspot-channels edge function for listing social accounts"
```

---

### Task 3: Add HubSpot Settings Page

**Files:**
- Create: `src/pages/HubSpotSettings.tsx`
- Modify: `src/App.tsx` (add route)
- Modify: `src/components/layout/Layout.tsx` (add nav link)

**Step 1: Create the settings page**

This page lets users:
- Enter their HubSpot Private App access token
- Save it to `hubspot_connections`
- View connected social channels
- Set a default channel
- Test the connection

```typescript
// src/pages/HubSpotSettings.tsx
import { useState, useEffect } from 'react'
import { Link2, RefreshCw, Check, AlertCircle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useSpaceStore } from '@/stores/spaceStore'

interface Channel {
    channelGuid: string
    name: string
    type: string
    username: string
}

export function HubSpotSettings() {
    const { currentSpace } = useSpaceStore()
    const [accessToken, setAccessToken] = useState('')
    const [isConnected, setIsConnected] = useState(false)
    const [channels, setChannels] = useState<Channel[]>([])
    const [defaultChannel, setDefaultChannel] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [isFetchingChannels, setIsFetchingChannels] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)

    useEffect(() => {
        if (currentSpace) loadConnection()
    }, [currentSpace])

    const loadConnection = async () => {
        if (!currentSpace) return
        setIsLoading(true)
        try {
            const { data } = await supabase
                .from('hubspot_connections')
                .select('*')
                .eq('space_id', currentSpace.id)
                .single()

            if (data) {
                setIsConnected(true)
                setAccessToken('••••••••••••••••') // mask existing token
                const meta = data.account_meta as any
                if (meta?.channels) setChannels(meta.channels)
                if (meta?.default_channel_guid) setDefaultChannel(meta.default_channel_guid)
            }
        } catch {
            // No connection yet
        }
        setIsLoading(false)
    }

    const handleSaveToken = async () => {
        if (!currentSpace || !accessToken || accessToken.startsWith('••')) return
        setIsSaving(true)
        setError(null)

        try {
            // Test the token first
            const testResponse = await fetch('https://api.hubapi.com/broadcast/v1/channels/setting/publish/current', {
                headers: { 'Authorization': `Bearer ${accessToken}` },
            })

            // Note: we can't call HubSpot directly from browser due to CORS
            // Save token and let the edge function test it
            const tokenData = JSON.stringify({ access_token: accessToken })

            const { error: upsertError } = await supabase
                .from('hubspot_connections')
                .upsert({
                    space_id: currentSpace.id,
                    encrypted_tokens: tokenData,
                    scopes: ['social'],
                    account_meta: {},
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'space_id' })

            if (upsertError) throw upsertError

            setIsConnected(true)
            setSuccess('HubSpot token saved successfully')
            setAccessToken('••••••••••••••••')

            // Fetch channels immediately
            await handleFetchChannels()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save token')
        }
        setIsSaving(false)
    }

    const handleFetchChannels = async () => {
        if (!currentSpace) return
        setIsFetchingChannels(true)
        setError(null)

        try {
            const { data, error: fnError } = await supabase.functions.invoke('hubspot-channels', {
                body: { space_id: currentSpace.id },
            })

            if (fnError) throw fnError
            if (data?.error) throw new Error(data.error)

            setChannels(data.channels || [])
            if (data.channels?.length > 0 && !defaultChannel) {
                setDefaultChannel(data.channels[0].channelGuid)
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch channels')
        }
        setIsFetchingChannels(false)
    }

    const handleSetDefaultChannel = async (channelGuid: string) => {
        if (!currentSpace) return
        setDefaultChannel(channelGuid)

        await supabase
            .from('hubspot_connections')
            .update({
                account_meta: {
                    channels,
                    default_channel_guid: channelGuid,
                    channels_updated_at: new Date().toISOString(),
                },
                updated_at: new Date().toISOString(),
            })
            .eq('space_id', currentSpace.id)
    }

    const handleDisconnect = async () => {
        if (!currentSpace) return
        if (!confirm('Disconnect HubSpot? This will remove the saved token.')) return

        await supabase
            .from('hubspot_connections')
            .delete()
            .eq('space_id', currentSpace.id)

        setIsConnected(false)
        setAccessToken('')
        setChannels([])
        setDefaultChannel(null)
    }

    const channelTypeIcons: Record<string, string> = {
        LINKEDIN: 'in',
        FACEBOOK: 'fb',
        INSTAGRAM: 'ig',
        TWITTER: 'X',
    }

    if (isLoading) {
        return <div className="p-8 text-center text-[var(--color-gray-400)]">Loading...</div>
    }

    return (
        <div className="max-w-2xl mx-auto p-8">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-[var(--color-gray-900)]">HubSpot Integration</h1>
                <p className="text-[var(--color-gray-500)] mt-1">
                    Connect your HubSpot account to send posts to your social media calendar.
                </p>
            </div>

            {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-700">{error}</p>
                </div>
            )}

            {success && (
                <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-green-700">{success}</p>
                </div>
            )}

            {/* Connection Card */}
            <div className="bg-white border border-[var(--color-gray-200)] rounded-xl p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
                            <Link2 className="w-5 h-5 text-orange-600" />
                        </div>
                        <div>
                            <h2 className="font-semibold text-[var(--color-gray-900)]">Private App Token</h2>
                            <p className="text-xs text-[var(--color-gray-500)]">
                                Create a Private App in HubSpot with the <code>social</code> scope
                            </p>
                        </div>
                    </div>
                    {isConnected && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                            Connected
                        </span>
                    )}
                </div>

                <div className="flex gap-3">
                    <input
                        type="password"
                        value={accessToken}
                        onChange={(e) => setAccessToken(e.target.value)}
                        placeholder="pat-na1-xxxxxxxx-xxxx-xxxx..."
                        className="flex-1 px-3 py-2 border border-[var(--color-gray-300)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                    />
                    <Button
                        onClick={handleSaveToken}
                        disabled={isSaving || !accessToken || accessToken.startsWith('••')}
                    >
                        {isSaving ? 'Saving...' : 'Save'}
                    </Button>
                </div>

                {isConnected && (
                    <button
                        onClick={handleDisconnect}
                        className="mt-3 text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                    >
                        <Trash2 className="w-3 h-3" />
                        Disconnect
                    </button>
                )}
            </div>

            {/* Channels Card */}
            {isConnected && (
                <div className="bg-white border border-[var(--color-gray-200)] rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="font-semibold text-[var(--color-gray-900)]">Social Channels</h2>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleFetchChannels}
                            disabled={isFetchingChannels}
                        >
                            <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetchingChannels ? 'animate-spin' : ''}`} />
                            Refresh
                        </Button>
                    </div>

                    {channels.length === 0 ? (
                        <p className="text-sm text-[var(--color-gray-500)]">
                            No channels found. Make sure social accounts are connected in HubSpot Settings &gt; Marketing &gt; Social.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {channels.map((ch) => (
                                <label
                                    key={ch.channelGuid}
                                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                                        defaultChannel === ch.channelGuid
                                            ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                                            : 'border-[var(--color-gray-200)] hover:border-[var(--color-gray-300)]'
                                    }`}
                                >
                                    <input
                                        type="radio"
                                        name="defaultChannel"
                                        checked={defaultChannel === ch.channelGuid}
                                        onChange={() => handleSetDefaultChannel(ch.channelGuid)}
                                        className="accent-[var(--color-primary)]"
                                    />
                                    <span className="w-8 h-8 rounded-md bg-[var(--color-gray-100)] flex items-center justify-center text-xs font-bold text-[var(--color-gray-600)]">
                                        {channelTypeIcons[ch.type] || ch.type?.charAt(0)}
                                    </span>
                                    <div className="flex-1">
                                        <p className="text-sm font-medium text-[var(--color-gray-900)]">{ch.name}</p>
                                        <p className="text-xs text-[var(--color-gray-500)]">{ch.type} {ch.username ? `@${ch.username}` : ''}</p>
                                    </div>
                                    {defaultChannel === ch.channelGuid && (
                                        <span className="text-xs text-[var(--color-primary)] font-medium">Default</span>
                                    )}
                                </label>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
```

**Step 2: Add route in App.tsx**

Add import and route for HubSpotSettings page. Find the routes section and add:
```typescript
import { HubSpotSettings } from './pages/HubSpotSettings'
// In routes:
<Route path="/hubspot" element={<HubSpotSettings />} />
```

**Step 3: Add nav link in Layout.tsx**

Add a "HubSpot" link in the sidebar nav, near other settings links.

**Step 4: Commit**

```bash
git add src/pages/HubSpotSettings.tsx src/App.tsx src/components/layout/Layout.tsx
git commit -m "feat: add HubSpot settings page for token and channel management"
```

---

### Task 4: Add Bulk "Send to HubSpot" Action in Posts Page

**Files:**
- Modify: `src/pages/Posts.tsx`

**Step 1: Add bulk send handler and button**

In the Posts component, add:

1. State: `const [isBulkSendingHubSpot, setIsBulkSendingHubSpot] = useState(false)`
2. State: `const [hubspotProgress, setHubspotProgress] = useState({ current: 0, total: 0 })`

3. Handler function:
```typescript
const handleBulkSendToHubSpot = async () => {
    if (selectedIds.size === 0) { alert('No posts selected'); return; }

    const postIds = Array.from(selectedIds)
    setIsBulkSendingHubSpot(true)
    setHubspotProgress({ current: 0, total: postIds.length })

    let successCount = 0
    let errorCount = 0

    for (let i = 0; i < postIds.length; i++) {
        setHubspotProgress({ current: i + 1, total: postIds.length })
        try {
            const { data, error } = await supabase.functions.invoke('hubspot-send', {
                body: { post_id: postIds[i], space_id: currentSpace!.id },
            })
            if (error) throw error
            if (data?.error) throw new Error(data.error)
            successCount++
        } catch (err) {
            console.error(`Failed to send post ${postIds[i]}:`, err)
            errorCount++
        }
    }

    setIsBulkSendingHubSpot(false)
    setSelectedIds(new Set())
    await fetchPosts()
    alert(`HubSpot send complete: ${successCount} sent, ${errorCount} failed`)
}
```

4. Button in bulk actions dropdown (after "Change Status" button, before divider):
```tsx
<div className="border-t border-[var(--color-gray-100)] my-1" />
<button
    className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--color-gray-50)] text-orange-700 flex items-center gap-2"
    onClick={() => { setShowBulkActions(false); handleBulkSendToHubSpot(); }}
    disabled={selectedIds.size === 0}
>
    <Send className="w-4 h-4" />
    Send to HubSpot ({selectedIds.size})
</button>
```

5. Add `Send` to lucide-react imports.

6. Progress modal (add at end of component JSX, matching existing progress modal pattern):
```tsx
{isBulkSendingHubSpot && (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl p-8 text-center">
            <div className="w-14 h-14 bg-gradient-to-br from-orange-400 to-orange-600 rounded-xl flex items-center justify-center mx-auto mb-4">
                <Send className="w-7 h-7 text-white" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--color-gray-900)] mb-2">
                Sending to HubSpot
            </h3>
            <div className="w-full h-4 bg-[var(--color-gray-200)] rounded-full overflow-hidden mb-3">
                <div
                    className="h-full bg-gradient-to-r from-orange-400 to-orange-600 rounded-full transition-all duration-500"
                    style={{ width: `${(hubspotProgress.current / hubspotProgress.total) * 100}%` }}
                />
            </div>
            <p className="text-sm text-[var(--color-gray-600)]">
                Sending {hubspotProgress.current} of {hubspotProgress.total} posts...
            </p>
        </div>
    </div>
)}
```

**Step 2: Commit**

```bash
git add src/pages/Posts.tsx
git commit -m "feat: add bulk Send to HubSpot action in Posts page"
```

---

### Task 5: Add `hubspot_connections` unique constraint migration

**Files:**
- Create: `supabase/migrations/20260324000000_hubspot_connections_unique.sql`

**Step 1: Create migration**

The `upsert` on `space_id` in the settings page requires a unique constraint:

```sql
-- Add unique constraint on space_id for hubspot_connections (needed for upsert)
ALTER TABLE hubspot_connections ADD CONSTRAINT hubspot_connections_space_id_key UNIQUE (space_id);
```

**Step 2: Push migration**

```bash
supabase db push --project-ref dbfrxagaccnitfpdtpen
```

**Step 3: Commit**

```bash
git add supabase/migrations/20260324000000_hubspot_connections_unique.sql
git commit -m "feat: add unique constraint on hubspot_connections.space_id"
```

---

### Task 6: Deploy Edge Functions

**Step 1: Deploy both functions**

```bash
supabase functions deploy hubspot-send --project-ref dbfrxagaccnitfpdtpen
supabase functions deploy hubspot-channels --project-ref dbfrxagaccnitfpdtpen
```

**Step 2: Verify deployment**

```bash
supabase functions list --project-ref dbfrxagaccnitfpdtpen
```

**Step 3: Build and deploy frontend**

```bash
npm run build
vercel --prod --yes
```

---

## Testing Flow

1. Go to Settings > HubSpot
2. Paste a HubSpot Private App token (created in HubSpot > Settings > Integrations > Private Apps with `social` scope)
3. Click Save — should show "Connected" badge
4. Click "Refresh" to load social channels
5. Select a default channel (e.g., LinkedIn company page)
6. Go to Posts page
7. Select a post with `ready_to_publish` status
8. Use Bulk Actions > "Send to HubSpot"
9. Verify post status changes to "Sent" (green badge)
10. Check HubSpot Social Calendar to confirm the post appears
