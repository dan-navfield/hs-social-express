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
            // Save token to database — the edge function will validate it when fetching channels
            const tokenData = JSON.stringify({ access_token: accessToken })

            // Check if connection already exists
            const { data: existing } = await supabase
                .from('hubspot_connections')
                .select('id')
                .eq('space_id', currentSpace.id)
                .single()

            let saveError
            if (existing) {
                const { error } = await supabase
                    .from('hubspot_connections')
                    .update({
                        encrypted_tokens: tokenData,
                        scopes: ['social'],
                        updated_at: new Date().toISOString(),
                    })
                    .eq('space_id', currentSpace.id)
                saveError = error
            } else {
                const { error } = await supabase
                    .from('hubspot_connections')
                    .insert({
                        space_id: currentSpace.id,
                        encrypted_tokens: tokenData,
                        scopes: ['social'],
                        account_meta: {},
                    })
                saveError = error
            }

            if (saveError) throw saveError

            setIsConnected(true)
            setSuccess('HubSpot token saved successfully')
            setAccessToken('••••••••••••••••')

            // Fetch channels via edge function (validates the token server-side)
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
