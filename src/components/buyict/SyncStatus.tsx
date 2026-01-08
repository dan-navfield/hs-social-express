import { CheckCircle2, XCircle, Loader2, Clock, FileText, Users, AlertTriangle } from 'lucide-react'
import type { BuyICTSyncJob } from '@/types/buyict'

interface SyncStatusProps {
    syncJob: BuyICTSyncJob | null
    showHistory?: boolean
    historyJobs?: BuyICTSyncJob[]
}

const statusConfig = {
    pending: {
        icon: Clock,
        color: 'text-gray-500',
        bgColor: 'bg-gray-100',
        label: 'Pending',
        animate: false,
    },
    running: {
        icon: Loader2,
        color: 'text-blue-600',
        bgColor: 'bg-blue-100',
        label: 'Running',
        animate: true,
    },
    completed: {
        icon: CheckCircle2,
        color: 'text-emerald-600',
        bgColor: 'bg-emerald-100',
        label: 'Completed',
        animate: false,
    },
    failed: {
        icon: XCircle,
        color: 'text-red-600',
        bgColor: 'bg-red-100',
        label: 'Failed',
        animate: false,
    },
}

export function SyncStatus({ syncJob, showHistory = false, historyJobs = [] }: SyncStatusProps) {
    if (!syncJob) {
        return (
            <div className="p-4 bg-gray-50 rounded-lg text-center">
                <p className="text-gray-500">No sync history yet</p>
                <p className="text-sm text-gray-400 mt-1">Upload a CSV file to import opportunities</p>
            </div>
        )
    }

    const config = statusConfig[syncJob.status]
    const Icon = config.icon

    const formatDuration = (start: string | null, end: string | null) => {
        if (!start) return 'N/A'
        const startDate = new Date(start)
        const endDate = end ? new Date(end) : new Date()
        const diffMs = endDate.getTime() - startDate.getTime()

        if (diffMs < 1000) return 'Less than 1s'
        if (diffMs < 60000) return `${Math.round(diffMs / 1000)}s`
        return `${Math.round(diffMs / 60000)}m ${Math.round((diffMs % 60000) / 1000)}s`
    }

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleString('en-AU', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        })
    }

    return (
        <div className="space-y-4">
            {/* Current/Latest sync job */}
            <div className={`p-4 rounded-lg border ${syncJob.status === 'failed' ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-full ${config.bgColor}`}>
                            <Icon className={`w-4 h-4 ${config.color} ${config.animate ? 'animate-spin' : ''}`} />
                        </div>
                        <div>
                            <p className="font-medium text-gray-900">{config.label}</p>
                            <p className="text-xs text-gray-500">
                                {syncJob.sync_type === 'upload' ? 'Manual Upload' : syncJob.sync_type === 'full' ? 'Full Sync' : 'Incremental Sync'}
                            </p>
                        </div>
                    </div>
                    <span className="text-xs text-gray-400">{formatDate(syncJob.created_at)}</span>
                </div>

                {/* Stats */}
                {syncJob.stats && Object.keys(syncJob.stats).length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                        {syncJob.stats.opportunities_added !== undefined && (
                            <div className="flex items-center gap-2 text-sm">
                                <FileText className="w-4 h-4 text-emerald-500" />
                                <span className="text-gray-600">
                                    <span className="font-medium">{syncJob.stats.opportunities_added}</span> added
                                </span>
                            </div>
                        )}
                        {syncJob.stats.opportunities_updated !== undefined && (
                            <div className="flex items-center gap-2 text-sm">
                                <FileText className="w-4 h-4 text-blue-500" />
                                <span className="text-gray-600">
                                    <span className="font-medium">{syncJob.stats.opportunities_updated}</span> updated
                                </span>
                            </div>
                        )}
                        {syncJob.stats.contacts_found !== undefined && (
                            <div className="flex items-center gap-2 text-sm">
                                <Users className="w-4 h-4 text-purple-500" />
                                <span className="text-gray-600">
                                    <span className="font-medium">{syncJob.stats.contacts_found}</span> contacts
                                </span>
                            </div>
                        )}
                        {syncJob.stats.emails_extracted !== undefined && (
                            <div className="flex items-center gap-2 text-sm">
                                <Users className="w-4 h-4 text-indigo-500" />
                                <span className="text-gray-600">
                                    <span className="font-medium">{syncJob.stats.emails_extracted}</span> emails
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {/* Duration */}
                {syncJob.status !== 'pending' && (
                    <p className="text-xs text-gray-400 mt-3">
                        Duration: {formatDuration(syncJob.started_at, syncJob.completed_at)}
                    </p>
                )}

                {/* Error message */}
                {syncJob.status === 'failed' && syncJob.error && (
                    <div className="mt-3 p-3 bg-red-100 rounded-lg flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                        <p className="text-sm text-red-700">{syncJob.error}</p>
                    </div>
                )}
            </div>

            {/* History */}
            {showHistory && historyJobs.length > 1 && (
                <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">Previous syncs</p>
                    <div className="space-y-2">
                        {historyJobs.slice(1).map((job) => {
                            const jobConfig = statusConfig[job.status]
                            const JobIcon = jobConfig.icon
                            return (
                                <div
                                    key={job.id}
                                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                                >
                                    <div className="flex items-center gap-2">
                                        <JobIcon className={`w-4 h-4 ${jobConfig.color} ${jobConfig.animate ? 'animate-spin' : ''}`} />
                                        <span className="text-sm text-gray-600">{jobConfig.label}</span>
                                        {job.stats?.opportunities_added !== undefined && (
                                            <span className="text-xs text-gray-400">
                                                +{job.stats.opportunities_added} opportunities
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-xs text-gray-400">{formatDate(job.created_at)}</span>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}
