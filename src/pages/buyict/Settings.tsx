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

    useEffect(() => {
        if (currentSpace?.id) {
            fetchIntegration(currentSpace.id)
            fetchSyncJobs(currentSpace.id)
        }
    }, [currentSpace?.id, fetchIntegration, fetchSyncJobs])

    // Load saved config from localStorage
    useEffect(() => {
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
    }, [])

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

    const handleSaveApifyConfig = () => {
        const config = {
            apifyToken,
            buyictEmail,
            maxOpportunities
        }
        localStorage.setItem('buyict_apify_config', JSON.stringify(config))
        // Note: Password is NOT saved for security - user must enter each time
        setConfigSaved(true)
        setIsSavingConfig(false)
    }

    const handleTriggerSync = async () => {
        if (!apifyToken || !buyictEmail || !buyictPassword || !currentSpace?.id) {
            setTriggerError('Please fill in all required fields')
            return
        }

        setIsTriggering(true)
        setTriggerError(null)

        try {
            // Trigger the Apify actor via API
            const response = await fetch(`https://api.apify.com/v2/acts/~buyict-scraper/runs?token=${apifyToken}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    credentials: {
                        email: buyictEmail,
                        password: buyictPassword
                    },
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

            // Refresh sync jobs to show the new running job
            setTimeout(() => {
                if (currentSpace?.id) {
                    fetchSyncJobs(currentSpace.id)
                }
            }, 2000)

        } catch (err) {
            console.error('Failed to trigger sync:', err)
            setTriggerError(err instanceof Error ? err.message : 'Failed to trigger sync')
        } finally {
            setIsTriggering(false)
        }
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
                                    disabled={isTriggering || !apifyToken || !buyictEmail || !buyictPassword}
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

                                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                                        <h6 className="font-medium text-amber-800 mb-2">BuyICT Login Credentials</h6>
                                        <p className="text-sm text-amber-700 mb-3">
                                            The scraper needs to log into BuyICT to access opportunities.
                                            Password is NOT saved - you must enter it each time for security.
                                        </p>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                                    BuyICT Email
                                                </label>
                                                <input
                                                    type="email"
                                                    value={buyictEmail}
                                                    onChange={(e) => {
                                                        setBuyictEmail(e.target.value)
                                                        setConfigSaved(false)
                                                    }}
                                                    placeholder="your@email.gov.au"
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                                />
                                            </div>

                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                                    BuyICT Password
                                                </label>
                                                <input
                                                    type="password"
                                                    value={buyictPassword}
                                                    onChange={(e) => setBuyictPassword(e.target.value)}
                                                    placeholder="Enter password"
                                                    autoComplete="new-password"
                                                    data-lpignore="true"
                                                    data-1p-ignore="true"
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                                                />
                                                <p className="text-xs text-gray-500 mt-1">
                                                    Not saved - enter each sync
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        <Button
                                            variant="secondary"
                                            onClick={handleSaveApifyConfig}
                                            disabled={!apifyToken || !buyictEmail}
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
