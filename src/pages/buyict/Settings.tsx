import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
    ArrowLeft,
    Upload,
    Globe,
    Monitor,
    Settings2,
    CheckCircle2,
    AlertCircle,
    Trash2,
    RefreshCw,
    Key,
    Play,
    ExternalLink,
    Clock,
    Loader2
} from 'lucide-react'
import { Button } from '@/components/ui'
import { ConnectionStatus, SyncStatus, UploadModal } from '@/components/buyict'
import { useBuyICTStore } from '@/stores/buyictStore'
import { useSpaceStore } from '@/stores/spaceStore'
import type { BuyICTConnectionMethod } from '@/types/buyict'

const connectionMethods: {
    id: BuyICTConnectionMethod
    name: string
    description: string
    icon: typeof Upload
    available: boolean
    recommended?: boolean
}[] = [
        {
            id: 'upload',
            name: 'File Upload',
            description: 'Manually upload CSV exports from BuyICT. Best for occasional syncs with full control.',
            icon: Upload,
            available: true,
        },
        {
            id: 'api',
            name: 'Apify Scraper',
            description: 'Automated scraping via Apify. Requires your BuyICT credentials and Apify API token.',
            icon: Globe,
            available: true,
            recommended: true,
        },
        {
            id: 'browser_sync',
            name: 'Browser Sync',
            description: 'Automated browser-based sync from your BuyICT session. Use only with BuyICT permission.',
            icon: Monitor,
            available: false, // Not yet implemented
        },
    ]

export function Settings() {
    const { currentSpace } = useSpaceStore()
    const {
        integration,
        isLoadingIntegration,
        latestSyncJob,
        syncJobs,
        fetchIntegration,
        createIntegration,
        fetchSyncJobs,
    } = useBuyICTStore()

    const [showUploadModal, setShowUploadModal] = useState(false)
    const [isCreating, setIsCreating] = useState(false)

    // Apify configuration state
    const [apifyToken, setApifyToken] = useState('')
    const [buyictEmail, setBuyictEmail] = useState('')
    const [buyictPassword, setBuyictPassword] = useState('')
    const [maxOpportunities, setMaxOpportunities] = useState(100)
    const [isSavingConfig, setIsSavingConfig] = useState(false)
    const [isTriggering, setIsTriggering] = useState(false)
    const [configSaved, setConfigSaved] = useState(false)
    const [triggerError, setTriggerError] = useState<string | null>(null)
    // Apify run progress
    const [apifyRunId, setApifyRunId] = useState<string | null>(null)
    const [apifyRunStatus, setApifyRunStatus] = useState<string | null>(null)
    const [syncStartedAt, setSyncStartedAt] = useState<Date | null>(null)
    const [syncProgress, setSyncProgress] = useState<{
        itemsFound?: number;
        itemsScraped?: number;
        currentPage?: number;
        phase?: string;
    } | null>(null)

    useEffect(() => {
        if (currentSpace?.id) {
            fetchIntegration(currentSpace.id)
            fetchSyncJobs(currentSpace.id)
        }
    }, [currentSpace?.id, fetchIntegration, fetchSyncJobs])

    // Load saved config from database (integration.config) or localStorage
    useEffect(() => {
        // First try to load from integration config (database)
        if (integration?.config) {
            const config = integration.config as { apifyToken?: string; buyictEmail?: string; maxOpportunities?: number }
            if (config.apifyToken) setApifyToken(config.apifyToken)
            if (config.buyictEmail) setBuyictEmail(config.buyictEmail)
            if (config.maxOpportunities) setMaxOpportunities(config.maxOpportunities)
            setConfigSaved(true)
            return
        }

        // Fall back to localStorage
        const savedConfig = localStorage.getItem('buyict_apify_config')
        if (savedConfig) {
            try {
                const config = JSON.parse(savedConfig)
                setApifyToken(config.apifyToken || '')
                setBuyictEmail(config.buyictEmail || '')
                setMaxOpportunities(config.maxOpportunities || 100)
                setConfigSaved(true)
            } catch (e) {
                console.error('Failed to parse saved config:', e)
            }
        }
    }, [integration?.config])

    const handleCreateIntegration = async (method: BuyICTConnectionMethod) => {
        if (!currentSpace?.id) return

        setIsCreating(true)
        try {
            await createIntegration(currentSpace.id, method)
        } catch (err) {
            console.error('Failed to create integration:', err)
        } finally {
            setIsCreating(false)
        }
    }

    const handleUploadComplete = () => {
        if (currentSpace?.id) {
            fetchIntegration(currentSpace.id)
            fetchSyncJobs(currentSpace.id)
        }
    }

    const handleSaveApifyConfig = async () => {
        if (!currentSpace?.id) return

        setIsSavingConfig(true)
        try {
            // Save to database via the integration's config field
            const { supabase } = await import('@/lib/supabase')

            const { error } = await supabase
                .from('buyict_integrations')
                .update({
                    config: {
                        apifyToken,
                        buyictEmail,
                        maxOpportunities
                    },
                    updated_at: new Date().toISOString()
                })
                .eq('space_id', currentSpace.id)

            if (error) throw error

            // Also save to localStorage as backup
            localStorage.setItem('buyict_apify_config', JSON.stringify({
                apifyToken,
                buyictEmail,
                maxOpportunities
            }))

            setConfigSaved(true)
            // Refresh integration to get updated config
            fetchIntegration(currentSpace.id)
        } catch (err) {
            console.error('Failed to save config:', err)
            setTriggerError('Failed to save configuration')
        } finally {
            setIsSavingConfig(false)
        }
    }

    const handleTriggerSync = async () => {
        if (!apifyToken || !currentSpace?.id) {
            setTriggerError('Please enter your Apify API token')
            return
        }

        setIsTriggering(true)
        setTriggerError(null)

        try {
            // Trigger the Apify actor via API
            // Using hs-social-express as the actor name from the GitHub-linked actor
            const response = await fetch(`https://api.apify.com/v2/acts/verifiable_hare~hs-social-express/runs?token=${apifyToken}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    // Credentials are optional - only needed to respond to opportunities, not view them
                    ...(buyictEmail && buyictPassword ? {
                        credentials: {
                            email: buyictEmail,
                            password: buyictPassword
                        }
                    } : {}),
                    webhookUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/buyict-sync-webhook`,
                    spaceId: currentSpace.id,
                    maxOpportunities,
                    filterStatus: 'open'
                })
            })

            if (!response.ok) {
                const error = await response.text()
                throw new Error(`Apify API error: ${error}`)
            }

            const result = await response.json()
            console.log('Apify run started:', result)

            // Store run info for progress tracking
            setApifyRunId(result.data?.id || null)
            setApifyRunStatus('RUNNING')
            setSyncStartedAt(new Date())

            // Poll for run status
            if (result.data?.id) {
                pollApifyRunStatus(result.data.id)
            }

        } catch (err) {
            console.error('Failed to trigger sync:', err)
            setTriggerError(err instanceof Error ? err.message : 'Failed to trigger sync')
        } finally {
            setIsTriggering(false)
        }
    }

    // Poll Apify run status
    const pollApifyRunStatus = async (runId: string) => {
        const poll = async () => {
            try {
                // Get run status
                const response = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`)
                if (response.ok) {
                    const data = await response.json()
                    const status = data.data?.status
                    const defaultDatasetId = data.data?.defaultDatasetId
                    setApifyRunStatus(status)

                    // Get dataset item count and log for progress
                    if (status === 'RUNNING' || status === 'READY') {
                        let itemCount = 0

                        // Get dataset count
                        if (defaultDatasetId) {
                            try {
                                const datasetRes = await fetch(
                                    `https://api.apify.com/v2/datasets/${defaultDatasetId}?token=${apifyToken}`
                                )
                                if (datasetRes.ok) {
                                    const datasetData = await datasetRes.json()
                                    itemCount = datasetData.data?.itemCount || 0
                                }
                            } catch (e) {
                                console.error('Failed to get dataset stats:', e)
                            }
                        }

                        // Get recent log to parse progress
                        try {
                            const logRes = await fetch(
                                `https://api.apify.com/v2/actor-runs/${runId}/log?token=${apifyToken}&stream=0`
                            )
                            if (logRes.ok) {
                                const logText = await logRes.text()
                                const lines = logText.split('\n')

                                // Parse total found from "Collecting from page X" or "Fetching details for Y opportunities"
                                let totalFound = 0
                                let currentItem = ''
                                let phase = 'Initializing...'

                                for (let i = lines.length - 1; i >= Math.max(0, lines.length - 50); i--) {
                                    const line = lines[i]

                                    // Check for total found
                                    const totalMatch = line.match(/Fetching details for (\d+) opportunities/i)
                                    if (totalMatch && !totalFound) {
                                        totalFound = parseInt(totalMatch[1])
                                    }

                                    // Check for current item being fetched
                                    const fetchMatch = line.match(/\[(\d+)\/(\d+)\] Fetching: ([A-Z]+-\d+) - (.+?)\.{3}/i)
                                    if (fetchMatch && !currentItem) {
                                        totalFound = parseInt(fetchMatch[2])
                                        currentItem = `[${fetchMatch[1]}/${fetchMatch[2]}] ${fetchMatch[3]}: ${fetchMatch[4]}`
                                        phase = 'Fetching opportunity details...'
                                    }

                                    // Check for page collection
                                    const pageMatch = line.match(/Page (\d+): Found (\d+)/i)
                                    if (pageMatch && !currentItem) {
                                        phase = `Collecting from page ${pageMatch[1]}...`
                                    }

                                    // Check for completion
                                    if (line.includes('Completed:') || line.includes('Scraping Complete')) {
                                        phase = 'Sending to database...'
                                    }
                                }

                                setSyncProgress({
                                    itemsScraped: itemCount,
                                    itemsFound: totalFound || itemCount,
                                    phase: phase,
                                    currentItem: currentItem
                                } as any)
                            }
                        } catch (e) {
                            // Fallback to basic progress
                            setSyncProgress({
                                itemsScraped: itemCount,
                                phase: itemCount > 0 ? 'Fetching details...' : 'Collecting opportunities...'
                            })
                        }
                    }

                    // Keep polling if running
                    if (status === 'RUNNING' || status === 'READY') {
                        setTimeout(poll, 3000) // Poll every 3 seconds
                    } else {
                        // Run finished - refresh sync jobs
                        setSyncProgress(null)
                        setTimeout(() => {
                            if (currentSpace?.id) {
                                fetchSyncJobs(currentSpace.id)
                                fetchIntegration(currentSpace.id)
                            }
                        }, 2000)
                    }
                }
            } catch (err) {
                console.error('Error polling run status:', err)
            }
        }
        poll()
    }

    if (isLoadingIntegration) {
        return (
            <div className="p-8 flex items-center justify-center min-h-[400px]">
                <div className="flex items-center gap-3 text-gray-500">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Loading...</span>
                </div>
            </div>
        )
    }

    return (
        <div className="p-8 bg-gray-50 min-h-screen">
            {/* Header */}
            <div className="flex items-center gap-4 mb-8">
                <Link to="/buyict" className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
                    <ArrowLeft className="w-5 h-5 text-gray-500" />
                </Link>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">BuyICT Integration Settings</h1>
                    <p className="text-gray-500">Configure how the app connects to BuyICT</p>
                </div>
            </div>

            {/* If no integration exists, show setup */}
            {!integration ? (
                <div className="space-y-6">
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <div className="flex items-start gap-4 mb-6">
                            <div className="p-3 bg-purple-100 rounded-xl">
                                <Settings2 className="w-6 h-6 text-purple-600" />
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">Set Up BuyICT Connection</h2>
                                <p className="text-gray-500 mt-1">
                                    Choose how you want to import opportunities from BuyICT
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {connectionMethods.map((method) => {
                                const Icon = method.icon
                                return (
                                    <div
                                        key={method.id}
                                        className={`
                      relative p-5 rounded-xl border-2 transition-all
                      ${method.available
                                                ? 'border-gray-200 hover:border-purple-300 cursor-pointer'
                                                : 'border-gray-100 opacity-60 cursor-not-allowed'}
                    `}
                                        onClick={() => method.available && handleCreateIntegration(method.id)}
                                    >
                                        {method.recommended && (
                                            <span className="absolute -top-2 -right-2 text-xs px-2 py-1 bg-purple-600 text-white rounded-full">
                                                Recommended
                                            </span>
                                        )}
                                        <Icon className={`w-8 h-8 mb-3 ${method.available ? 'text-purple-600' : 'text-gray-400'}`} />
                                        <h3 className="font-medium text-gray-900 mb-1">{method.name}</h3>
                                        <p className="text-sm text-gray-500">{method.description}</p>
                                        {!method.available && (
                                            <span className="text-xs text-gray-400 mt-2 block">Coming soon</span>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Current Integration Status */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <div className="flex items-start justify-between mb-6">
                            <div className="flex items-start gap-4">
                                <div className="p-3 bg-purple-100 rounded-xl">
                                    <Settings2 className="w-6 h-6 text-purple-600" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold text-gray-900">Integration Status</h2>
                                    <div className="mt-2">
                                        <ConnectionStatus
                                            status={integration.connection_status}
                                            method={integration.connection_method}
                                            lastSyncAt={integration.last_sync_at}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Actions based on method */}
                            {integration.connection_method === 'upload' && (
                                <Button onClick={() => setShowUploadModal(true)}>
                                    <Upload className="w-4 h-4" />
                                    Upload CSV
                                </Button>
                            )}

                            {integration.connection_method === 'api' && (
                                <Button
                                    onClick={handleTriggerSync}
                                    disabled={isTriggering || !apifyToken}
                                >
                                    {isTriggering ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Syncing...
                                        </>
                                    ) : (
                                        <>
                                            <Play className="w-4 h-4" />
                                            Sync Now
                                        </>
                                    )}
                                </Button>
                            )}
                        </div>

                        {/* Error display */}
                        {(integration.last_sync_error || triggerError) && (
                            <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-medium text-red-800">Error</p>
                                    <p className="text-sm text-red-700 mt-1">{triggerError || integration.last_sync_error}</p>
                                </div>
                            </div>
                        )}

                        {/* Live Sync Progress */}
                        {apifyRunStatus && (
                            <div className={`p-4 rounded-lg flex items-start gap-3 ${apifyRunStatus === 'SUCCEEDED' ? 'bg-green-50 border border-green-200' :
                                apifyRunStatus === 'FAILED' || apifyRunStatus === 'ABORTED' ? 'bg-red-50 border border-red-200' :
                                    'bg-blue-50 border border-blue-200'
                                }`}>
                                {(apifyRunStatus === 'RUNNING' || apifyRunStatus === 'READY') && (
                                    <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0 mt-0.5" />
                                )}
                                {apifyRunStatus === 'SUCCEEDED' && (
                                    <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
                                )}
                                {(apifyRunStatus === 'FAILED' || apifyRunStatus === 'ABORTED') && (
                                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                                )}
                                <div className="flex-1">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className={`font-medium ${apifyRunStatus === 'SUCCEEDED' ? 'text-green-800' :
                                                apifyRunStatus === 'FAILED' || apifyRunStatus === 'ABORTED' ? 'text-red-800' :
                                                    'text-blue-800'
                                                }`}>
                                                {apifyRunStatus === 'RUNNING' && (syncProgress?.phase || 'Scraping BuyICT opportunities...')}
                                                {apifyRunStatus === 'READY' && 'Starting scraper...'}
                                                {apifyRunStatus === 'SUCCEEDED' && 'Sync completed successfully!'}
                                                {apifyRunStatus === 'FAILED' && 'Sync failed'}
                                                {apifyRunStatus === 'ABORTED' && 'Sync was aborted'}
                                            </p>
                                            {(apifyRunStatus === 'RUNNING' || apifyRunStatus === 'READY') && syncProgress && (
                                                <div className="mt-1 space-y-1">
                                                    {/* Progress counts */}
                                                    <p className="text-sm text-blue-600">
                                                        {syncProgress.itemsScraped || 0}
                                                        {(syncProgress as any).itemsFound ? ` of ${(syncProgress as any).itemsFound}` : ''} opportunities scraped
                                                    </p>
                                                    {/* Current item */}
                                                    {(syncProgress as any).currentItem && (
                                                        <p className="text-xs text-blue-500 font-mono truncate max-w-md">
                                                            {(syncProgress as any).currentItem}
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        {syncStartedAt && (
                                            <span className="text-xs text-gray-500">
                                                Started {Math.round((Date.now() - syncStartedAt.getTime()) / 1000)}s ago
                                            </span>
                                        )}
                                    </div>
                                    {apifyRunId && (
                                        <div className="mt-2 flex items-center gap-2">
                                            <span className="text-xs text-gray-500">Run ID: {apifyRunId.slice(0, 8)}...</span>
                                            <a
                                                href={`https://console.apify.com/actors/runs/${apifyRunId}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-purple-600 hover:text-purple-700 flex items-center gap-1"
                                            >
                                                <ExternalLink className="w-3 h-3" />
                                                View in Apify Console
                                            </a>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Connection Method Details */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <h3 className="font-semibold text-gray-900 mb-4">Connection Method</h3>

                        {integration.connection_method === 'upload' && (
                            <div className="flex items-start gap-4">
                                <div className="p-3 bg-gray-100 rounded-xl">
                                    <Upload className="w-6 h-6 text-gray-600" />
                                </div>
                                <div className="flex-1">
                                    <h4 className="font-medium text-gray-900">File Upload</h4>
                                    <p className="text-sm text-gray-500 mt-1">
                                        Export opportunities from BuyICT as CSV and upload them here.
                                        Each upload will add new opportunities and update existing ones.
                                    </p>

                                    <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                                        <h5 className="font-medium text-blue-800 mb-2">Expected CSV Format</h5>
                                        <p className="text-sm text-blue-700 mb-2">
                                            Your CSV should include these columns (names are flexible):
                                        </p>
                                        <ul className="text-sm text-blue-700 list-disc list-inside space-y-1">
                                            <li>Reference / ATM ID / Opportunity ID</li>
                                            <li>Title / Opportunity Title</li>
                                            <li>Buyer / Agency / Department</li>
                                            <li>Closing Date / Close Date</li>
                                            <li>Status</li>
                                            <li>Contact / Contact Officer / Enquiries (for email extraction)</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        )}

                        {integration.connection_method === 'api' && (
                            <div className="space-y-6">
                                <div className="flex items-start gap-4">
                                    <div className="p-3 bg-gray-100 rounded-xl">
                                        <Globe className="w-6 h-6 text-gray-600" />
                                    </div>
                                    <div className="flex-1">
                                        <h4 className="font-medium text-gray-900">Apify Scraper Integration</h4>
                                        <p className="text-sm text-gray-500 mt-1">
                                            Automated scraping of BuyICT opportunities using Apify.
                                            Configure your credentials below to enable syncing.
                                        </p>

                                        <a
                                            href="https://console.apify.com/actors"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-sm text-purple-600 hover:text-purple-700 mt-2"
                                        >
                                            <ExternalLink className="w-3.5 h-3.5" />
                                            Open Apify Console
                                        </a>
                                    </div>
                                </div>

                                {/* Apify Configuration Form */}
                                <div className="border-t border-gray-200 pt-6 space-y-4">
                                    <h5 className="font-medium text-gray-900 flex items-center gap-2">
                                        <Key className="w-4 h-4" />
                                        API Credentials
                                    </h5>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Apify API Token
                                            </label>
                                            <input
                                                type="password"
                                                value={apifyToken}
                                                onChange={(e) => {
                                                    setApifyToken(e.target.value)
                                                    setConfigSaved(false)
                                                }}
                                                placeholder="apify_api_..."
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                            />
                                            <p className="text-xs text-gray-500 mt-1">
                                                Find this in your Apify account settings
                                            </p>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Max Opportunities
                                            </label>
                                            <input
                                                type="number"
                                                value={maxOpportunities}
                                                onChange={(e) => {
                                                    setMaxOpportunities(parseInt(e.target.value) || 100)
                                                    setConfigSaved(false)
                                                }}
                                                min={1}
                                                max={500}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <Button
                                            variant="secondary"
                                            onClick={handleSaveApifyConfig}
                                            disabled={!apifyToken || isSavingConfig}
                                        >
                                            {configSaved ? (
                                                <>
                                                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                                                    Saved
                                                </>
                                            ) : (
                                                'Save Config'
                                            )}
                                        </Button>

                                        <span className="text-sm text-gray-500">
                                            {configSaved && 'API token and email saved locally'}
                                        </span>
                                    </div>
                                </div>

                                {/* Deployment Instructions */}
                                <div className="border-t border-gray-200 pt-6">
                                    <h5 className="font-medium text-gray-900 mb-3">Deploy the Scraper to Apify</h5>
                                    <div className="p-4 bg-gray-50 rounded-lg">
                                        <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
                                            <li>Go to <a href="https://console.apify.com/actors" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">Apify Console → Actors</a></li>
                                            <li>Click "Create new" → "From scratch"</li>
                                            <li>Name it <code className="px-1.5 py-0.5 bg-gray-200 rounded text-xs">buyict-scraper</code></li>
                                            <li>Upload the files from <code className="px-1.5 py-0.5 bg-gray-200 rounded text-xs">apify/buyict-scraper/</code></li>
                                            <li>Click "Build" and wait for completion</li>
                                            <li>Come back here and click "Sync Now"!</li>
                                        </ol>
                                    </div>
                                </div>
                            </div>
                        )}

                        {integration.connection_method === 'browser_sync' && (
                            <div className="flex items-start gap-4">
                                <div className="p-3 bg-gray-100 rounded-xl">
                                    <Monitor className="w-6 h-6 text-gray-600" />
                                </div>
                                <div>
                                    <h4 className="font-medium text-gray-900">Browser Sync</h4>
                                    <p className="text-sm text-gray-500 mt-1">
                                        Automated browser-based synchronisation.
                                    </p>
                                    <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                        <p className="text-sm text-amber-700">
                                            ⚠️ Coming soon. Use Apify Scraper for automated syncing.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Sync History */}
                    <div className="bg-white rounded-xl border border-gray-200 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold text-gray-900">Sync History</h3>
                            <button
                                onClick={() => currentSpace?.id && fetchSyncJobs(currentSpace.id)}
                                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                                title="Refresh"
                            >
                                <RefreshCw className="w-4 h-4" />
                            </button>
                        </div>
                        <SyncStatus
                            syncJob={latestSyncJob}
                            showHistory={true}
                            historyJobs={syncJobs}
                        />
                    </div>

                    {/* Danger Zone */}
                    <div className="bg-white rounded-xl border border-red-200 p-6">
                        <h3 className="font-semibold text-red-900 mb-4">Danger Zone</h3>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="font-medium text-gray-900">Remove Integration</p>
                                <p className="text-sm text-gray-500">
                                    This will disconnect BuyICT but preserve your imported opportunities.
                                </p>
                            </div>
                            <Button
                                variant="secondary"
                                className="border-red-300 text-red-600 hover:bg-red-50"
                            >
                                <Trash2 className="w-4 h-4" />
                                Remove
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Upload Modal */}
            {integration && (
                <UploadModal
                    isOpen={showUploadModal}
                    onClose={() => setShowUploadModal(false)}
                    onUploadComplete={handleUploadComplete}
                    integrationId={integration.id}
                />
            )}
        </div>
    )
}
