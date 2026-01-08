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
    RefreshCw
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
            recommended: true,
        },
        {
            id: 'api',
            name: 'API Integration',
            description: 'Connect via official BuyICT API for automated syncing. Requires API credentials.',
            icon: Globe,
            available: false, // Not yet implemented
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

    useEffect(() => {
        if (currentSpace?.id) {
            fetchIntegration(currentSpace.id)
            fetchSyncJobs(currentSpace.id)
        }
    }, [currentSpace?.id, fetchIntegration, fetchSyncJobs])

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
                        </div>

                        {/* Error display */}
                        {integration.last_sync_error && (
                            <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                                <div>
                                    <p className="font-medium text-red-800">Last Sync Error</p>
                                    <p className="text-sm text-red-700 mt-1">{integration.last_sync_error}</p>
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
                            <div className="flex items-start gap-4">
                                <div className="p-3 bg-gray-100 rounded-xl">
                                    <Globe className="w-6 h-6 text-gray-600" />
                                </div>
                                <div>
                                    <h4 className="font-medium text-gray-900">API Integration</h4>
                                    <p className="text-sm text-gray-500 mt-1">
                                        Connected via official BuyICT API.
                                    </p>
                                    {/* API configuration would go here */}
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
                                            ⚠️ Use only with explicit BuyICT permission. Unauthorised automated access may violate terms of service.
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
