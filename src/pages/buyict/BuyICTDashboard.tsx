import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
    FileText,
    Users,
    Building2,
    Clock,
    TrendingUp,
    AlertCircle,
    ArrowRight,
    Calendar
} from 'lucide-react'
import { Button } from '@/components/ui'
import { ConnectionStatus, SyncStatus } from '@/components/buyict'
import { useBuyICTStore } from '@/stores/buyictStore'
import { useSpaceStore } from '@/stores/spaceStore'

interface StatCardProps {
    label: string
    value: number | string
    icon: typeof FileText
    color: string
    to?: string
}

function StatCard({ label, value, icon: Icon, color, to }: StatCardProps) {
    const content = (
        <div className={`p-6 bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all ${to ? 'cursor-pointer' : ''}`}>
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-3xl font-bold text-gray-900">{value}</p>
                    <p className="text-sm text-gray-500 mt-1">{label}</p>
                </div>
                <div className={`p-3 rounded-xl ${color}`}>
                    <Icon className="w-6 h-6 text-white" />
                </div>
            </div>
            {to && (
                <div className="flex items-center gap-1 mt-4 text-sm text-purple-600 font-medium">
                    <span>View all</span>
                    <ArrowRight className="w-4 h-4" />
                </div>
            )}
        </div>
    )

    if (to) {
        return <Link to={to}>{content}</Link>
    }
    return content
}

export function BuyICTDashboard() {
    const { currentSpace } = useSpaceStore()
    const {
        integration,
        isLoadingIntegration,
        stats,
        latestSyncJob,
        syncJobs,
        fetchIntegration,
        fetchStats,
        fetchSyncJobs,
    } = useBuyICTStore()

    useEffect(() => {
        if (currentSpace?.id) {
            fetchIntegration(currentSpace.id)
            fetchStats(currentSpace.id)
            fetchSyncJobs(currentSpace.id)
        }
    }, [currentSpace?.id, fetchIntegration, fetchStats, fetchSyncJobs])

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
            <div className="flex items-start justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">BuyICT Snoop</h1>
                    <p className="text-gray-500 mt-1">
                        Procurement opportunity management and contact discovery
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Link to="/buyict/settings">
                        <Button variant="secondary">Settings</Button>
                    </Link>
                    <Link to="/buyict/opportunities">
                        <Button>View Opportunities</Button>
                    </Link>
                </div>
            </div>

            {/* Connection Status Banner */}
            <div className="mb-8 p-4 bg-white rounded-xl border border-gray-200">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-purple-100 rounded-xl">
                            <TrendingUp className="w-6 h-6 text-purple-600" />
                        </div>
                        <div>
                            <h2 className="font-semibold text-gray-900">Integration Status</h2>
                            {integration ? (
                                <ConnectionStatus
                                    status={integration.connection_status}
                                    method={integration.connection_method}
                                    lastSyncAt={integration.last_sync_at}
                                />
                            ) : (
                                <p className="text-sm text-gray-500">
                                    No integration configured yet.{' '}
                                    <Link to="/buyict/settings" className="text-purple-600 hover:text-purple-700">
                                        Set up now →
                                    </Link>
                                </p>
                            )}
                        </div>
                    </div>
                    {integration?.last_sync_error && (
                        <div className="flex items-center gap-2 text-red-600">
                            <AlertCircle className="w-5 h-5" />
                            <span className="text-sm">{integration.last_sync_error}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <StatCard
                    label="Total Opportunities"
                    value={stats.totalOpportunities}
                    icon={FileText}
                    color="bg-blue-500"
                    to="/buyict/opportunities"
                />
                <StatCard
                    label="Open Opportunities"
                    value={stats.openOpportunities}
                    icon={Clock}
                    color="bg-emerald-500"
                    to="/buyict/opportunities?status=open"
                />
                <StatCard
                    label="Closing This Week"
                    value={stats.closingThisWeek}
                    icon={Calendar}
                    color="bg-amber-500"
                    to="/buyict/opportunities?closing=week"
                />
                <StatCard
                    label="Contacts Found"
                    value={stats.totalContacts}
                    icon={Users}
                    color="bg-purple-500"
                    to="/buyict/contacts"
                />
            </div>

            {/* Secondary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <StatCard
                    label="Departments Mapped"
                    value={stats.uniqueDepartments}
                    icon={Building2}
                    color="bg-indigo-500"
                    to="/buyict/departments"
                />
                <StatCard
                    label="Departments Unmapped"
                    value={stats.unmappedDepartments}
                    icon={AlertCircle}
                    color={stats.unmappedDepartments > 0 ? "bg-orange-500" : "bg-gray-400"}
                    to="/buyict/departments"
                />
                <div className="p-6 bg-white rounded-xl border border-gray-200">
                    <h3 className="font-medium text-gray-700 mb-3">Latest Sync</h3>
                    <SyncStatus syncJob={latestSyncJob} />
                </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Recent Activity */}
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <h3 className="font-semibold text-gray-900 mb-4">Recent Sync History</h3>
                    <SyncStatus
                        syncJob={latestSyncJob}
                        showHistory={true}
                        historyJobs={syncJobs}
                    />
                </div>

                {/* Quick Links */}
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <h3 className="font-semibold text-gray-900 mb-4">Quick Actions</h3>
                    <div className="space-y-3">
                        <Link
                            to="/buyict/opportunities"
                            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                            <div className="flex items-center gap-3">
                                <FileText className="w-5 h-5 text-gray-500" />
                                <span className="font-medium text-gray-700">Browse Opportunities</span>
                            </div>
                            <ArrowRight className="w-4 h-4 text-gray-400" />
                        </Link>
                        <Link
                            to="/buyict/contacts"
                            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                            <div className="flex items-center gap-3">
                                <Users className="w-5 h-5 text-gray-500" />
                                <span className="font-medium text-gray-700">View Contacts</span>
                            </div>
                            <ArrowRight className="w-4 h-4 text-gray-400" />
                        </Link>
                        <Link
                            to="/buyict/departments"
                            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                            <div className="flex items-center gap-3">
                                <Building2 className="w-5 h-5 text-gray-500" />
                                <span className="font-medium text-gray-700">Manage Department Mappings</span>
                            </div>
                            <ArrowRight className="w-4 h-4 text-gray-400" />
                        </Link>
                        <Link
                            to="/buyict/settings"
                            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                            <div className="flex items-center gap-3">
                                <TrendingUp className="w-5 h-5 text-gray-500" />
                                <span className="font-medium text-gray-700">Integration Settings</span>
                            </div>
                            <ArrowRight className="w-4 h-4 text-gray-400" />
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    )
}
