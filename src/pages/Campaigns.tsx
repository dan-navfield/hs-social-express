import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Play, CheckCircle, XCircle, Clock, Eye, Trash2, ArrowRight, Settings, FileText, Sparkles, Target } from 'lucide-react'
import { Button, Input, Textarea, StatusBadge } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useSpaceStore } from '@/stores/spaceStore'
import { useAuthStore } from '@/stores/authStore'
import type { Database, CampaignStatus, GenerationSettings, LockedSourceSettings } from '@/types/database'

type Campaign = Database['public']['Tables']['campaigns']['Row']

export function Campaigns() {
    const navigate = useNavigate()
    const { currentSpace } = useSpaceStore()
    const { user } = useAuthStore()
    const [campaigns, setCampaigns] = useState<Campaign[]>([])
    const [isLoading, setIsLoading] = useState(true)

    // Create campaign form state
    const [campaignName, setCampaignName] = useState('')
    const [isCreating, setIsCreating] = useState(false)

    const fetchCampaigns = useCallback(async () => {
        if (!currentSpace) return

        setIsLoading(true)
        try {
            const { data, error } = await supabase
                .from('campaigns')
                .select('*')
                .eq('space_id', currentSpace.id)
                .order('created_at', { ascending: false })

            if (error) throw error
            setCampaigns(data || [])
        } catch (error) {
            console.error('Error fetching campaigns:', error)
        } finally {
            setIsLoading(false)
        }
    }, [currentSpace])

    useEffect(() => {
        fetchCampaigns()
    }, [fetchCampaigns])

    const handleQuickCreate = async () => {
        if (!currentSpace || !user || !campaignName.trim()) return

        setIsCreating(true)
        try {
            const { data, error } = await supabase
                .from('campaigns')
                .insert({
                    space_id: currentSpace.id,
                    name: campaignName.trim(),
                    target_count: 10,
                    template_ids: {},
                    locked_source_settings: {
                        use_website: true,
                        use_manual: true,
                        use_sharepoint: false,
                    },
                    generation_settings: {},
                    created_by: user.id,
                })
                .select()
                .single()

            if (error) throw error

            // Navigate to campaign settings page
            navigate(`/campaign/${data.id}`)
        } catch (error) {
            console.error('Error creating campaign:', error)
            alert('Failed to create campaign')
        } finally {
            setIsCreating(false)
        }
    }

    const handleRunCampaign = async (campaignId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        try {
            await supabase
                .from('campaigns')
                .update({ status: 'running', updated_at: new Date().toISOString() })
                .eq('id', campaignId)

            const { error } = await supabase.functions.invoke('generate-campaign-posts', {
                body: { campaign_id: campaignId },
            })

            if (error) throw error
            await fetchCampaigns()
        } catch (error) {
            console.error('Error running campaign:', error)
            alert('Failed to start campaign.')
        }
    }

    const handleDeleteCampaign = async (campaignId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        if (!confirm('Delete this campaign and all its posts?')) return

        try {
            await supabase.from('campaigns').delete().eq('id', campaignId)
            await fetchCampaigns()
        } catch (error) {
            console.error('Error deleting campaign:', error)
        }
    }

    const getStatusIcon = (status: CampaignStatus) => {
        switch (status) {
            case 'draft': return <Clock className="w-4 h-4 text-gray-500" />
            case 'running': return <Play className="w-4 h-4 text-blue-500" />
            case 'completed': return <CheckCircle className="w-4 h-4 text-green-500" />
            case 'failed': return <XCircle className="w-4 h-4 text-red-500" />
        }
    }

    return (
        <div className="p-8 max-w-4xl mx-auto">
            {/* Hero Section - Quick Create */}
            <div className="bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-secondary)] rounded-2xl p-8 mb-8 text-white">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                        <Sparkles className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">Create a Campaign</h1>
                        <p className="text-white/80">Generate AI-powered LinkedIn content</p>
                    </div>
                </div>

                <div className="flex gap-3">
                    <Input
                        value={campaignName}
                        onChange={(e) => setCampaignName(e.target.value)}
                        placeholder="Enter campaign name (e.g., Q1 2025 LinkedIn)"
                        className="flex-1 bg-white/10 border-white/30 text-white placeholder:text-white/50"
                        onKeyDown={(e) => e.key === 'Enter' && handleQuickCreate()}
                    />
                    <Button
                        variant="secondary"
                        onClick={handleQuickCreate}
                        disabled={!campaignName.trim() || isCreating}
                        className="bg-white text-[var(--color-primary)] hover:bg-white/90 font-semibold px-6"
                    >
                        {isCreating ? 'Creating...' : 'Create'}
                        <ArrowRight className="w-4 h-4" />
                    </Button>
                </div>
                <p className="text-sm text-white/60 mt-2">
                    You'll configure settings on the next screen
                </p>
            </div>

            {/* Existing Campaigns */}
            <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[var(--color-gray-900)]">Your Campaigns</h2>
                <span className="text-sm text-[var(--color-gray-500)]">{campaigns.length} total</span>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-[var(--color-gray-200)] overflow-hidden">
                {isLoading ? (
                    <div className="p-8 text-center text-[var(--color-gray-500)]">Loading campaigns...</div>
                ) : campaigns.length === 0 ? (
                    <div className="p-12 text-center">
                        <div className="w-16 h-16 bg-[var(--color-gray-100)] rounded-full flex items-center justify-center mx-auto mb-4">
                            <Target className="w-8 h-8 text-[var(--color-gray-400)]" />
                        </div>
                        <p className="text-[var(--color-gray-500)] mb-2">No campaigns yet</p>
                        <p className="text-sm text-[var(--color-gray-400)]">Create your first campaign above to start generating content</p>
                    </div>
                ) : (
                    <div className="divide-y divide-[var(--color-gray-100)]">
                        {campaigns.map((campaign) => (
                            <div
                                key={campaign.id}
                                className="p-4 flex items-center justify-between hover:bg-[var(--color-gray-50)] cursor-pointer transition-colors"
                                onClick={() => navigate(`/campaign/${campaign.id}`)}
                            >
                                <div className="flex items-center gap-4">
                                    {getStatusIcon(campaign.status)}
                                    <div>
                                        <p className="font-medium text-[var(--color-gray-900)]">{campaign.name}</p>
                                        <p className="text-sm text-[var(--color-gray-500)]">
                                            Target: {campaign.target_count} posts • Created {new Date(campaign.created_at).toLocaleDateString()}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <StatusBadge status={campaign.status} />
                                    {campaign.status === 'draft' && (
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            onClick={(e) => handleRunCampaign(campaign.id, e)}
                                        >
                                            <Play className="w-4 h-4" />
                                            Generate
                                        </Button>
                                    )}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            navigate(`/campaign/${campaign.id}`)
                                        }}
                                    >
                                        <Settings className="w-4 h-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => handleDeleteCampaign(campaign.id, e)}
                                    >
                                        <Trash2 className="w-4 h-4 text-red-500" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
