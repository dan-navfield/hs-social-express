import { FileText } from 'lucide-react'
import { Button } from '@/components/ui'
import { Link } from 'react-router-dom'

interface StatCardProps {
    label: string
    value: number | string
    subtitle?: string
}

function StatCard({ label, value, subtitle }: StatCardProps) {
    return (
        <div className="bg-white rounded-xl p-6 border border-[var(--color-gray-200)] flex flex-col items-center justify-center min-h-[140px]">
            <p className="text-3xl font-bold text-[var(--color-gray-900)] mb-1">{value}</p>
            <p className="text-sm text-[var(--color-gray-500)]">{label}</p>
            {subtitle && <p className="text-xs text-[var(--color-gray-400)] mt-1">{subtitle}</p>}
        </div>
    )
}

export function Dashboard() {
    // Mock data for now - will be replaced with real data
    const stats = {
        totalPosts: 2,
        activePosts: 2,
        mau: '100%',
        dailyActive: 2,
        inactive: 0,
        pending: 4,
    }

    return (
        <div className="p-8 bg-white min-h-screen">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-2xl font-semibold text-[var(--color-gray-900)]">Overview</h1>
            </div>

            {/* Stats Grid - Top Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <StatCard
                    label="Total members"
                    value={stats.totalPosts}
                />
                <StatCard
                    label="Active members (30 days)"
                    value={stats.activePosts}
                />
                <StatCard
                    label="MAU (30 days)"
                    value={stats.mau}
                />
            </div>

            {/* Stats Grid - Bottom Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <StatCard
                    label="Daily active members (30 days)"
                    value={stats.dailyActive}
                />
                <StatCard
                    label="Inactive members (30 days)"
                    value={stats.inactive}
                />
                <StatCard
                    label="Invitation pending"
                    value={stats.pending}
                />
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-[var(--color-gray-200)]">
                <h2 className="text-lg font-semibold text-[var(--color-gray-900)] mb-4">
                    Quick Actions
                </h2>
                <div className="flex flex-wrap gap-3">
                    <Link to="/posts">
                        <Button>
                            <FileText className="w-4 h-4" />
                            View Posts
                        </Button>
                    </Link>
                    <Link to="/prompts">
                        <Button variant="secondary">
                            Configure Prompts
                        </Button>
                    </Link>
                    <Link to="/brand">
                        <Button variant="secondary">
                            Brand Settings
                        </Button>
                    </Link>
                </div>
            </div>
        </div>
    )
}
