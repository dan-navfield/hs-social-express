import { Circle, Loader2, CheckCircle2, AlertCircle, Upload, Globe, Monitor } from 'lucide-react'
import type { BuyICTConnectionStatus, BuyICTConnectionMethod } from '@/types/buyict'

interface ConnectionStatusProps {
    status: BuyICTConnectionStatus
    method?: BuyICTConnectionMethod
    lastSyncAt?: string | null
    showMethod?: boolean
    size?: 'sm' | 'md' | 'lg'
}

const statusConfig: Record<BuyICTConnectionStatus, {
    label: string
    color: string
    bgColor: string
    icon: typeof Circle
}> = {
    disconnected: {
        label: 'Not Connected',
        color: 'text-gray-500',
        bgColor: 'bg-gray-100',
        icon: Circle,
    },
    connected: {
        label: 'Connected',
        color: 'text-emerald-600',
        bgColor: 'bg-emerald-50',
        icon: CheckCircle2,
    },
    syncing: {
        label: 'Syncing',
        color: 'text-blue-600',
        bgColor: 'bg-blue-50',
        icon: Loader2,
    },
    error: {
        label: 'Error',
        color: 'text-red-600',
        bgColor: 'bg-red-50',
        icon: AlertCircle,
    },
}

const methodConfig: Record<BuyICTConnectionMethod, { label: string; icon: typeof Upload }> = {
    upload: { label: 'File Upload', icon: Upload },
    api: { label: 'API', icon: Globe },
    browser_sync: { label: 'Browser Sync', icon: Monitor },
}

const sizeClasses = {
    sm: 'text-xs px-2 py-1',
    md: 'text-sm px-3 py-1.5',
    lg: 'text-base px-4 py-2',
}

const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
}

export function ConnectionStatus({
    status,
    method,
    lastSyncAt,
    showMethod = true,
    size = 'md'
}: ConnectionStatusProps) {
    const config = statusConfig[status]
    const methodInfo = method ? methodConfig[method] : null
    const Icon = config.icon
    const MethodIcon = methodInfo?.icon

    const formatLastSync = (dateStr: string) => {
        const date = new Date(dateStr)
        const now = new Date()
        const diffMs = now.getTime() - date.getTime()
        const diffMins = Math.floor(diffMs / 60000)
        const diffHours = Math.floor(diffMins / 60)
        const diffDays = Math.floor(diffHours / 24)

        if (diffMins < 1) return 'Just now'
        if (diffMins < 60) return `${diffMins}m ago`
        if (diffHours < 24) return `${diffHours}h ago`
        return `${diffDays}d ago`
    }

    return (
        <div className="flex items-center gap-3">
            {/* Status badge */}
            <div className={`inline-flex items-center gap-1.5 rounded-full ${config.bgColor} ${config.color} ${sizeClasses[size]} font-medium`}>
                <Icon className={`${iconSizes[size]} ${status === 'syncing' ? 'animate-spin' : ''}`} />
                <span>{config.label}</span>
            </div>

            {/* Method badge */}
            {showMethod && methodInfo && MethodIcon && (
                <div className={`inline-flex items-center gap-1.5 rounded-full bg-gray-100 text-gray-600 ${sizeClasses[size]}`}>
                    <MethodIcon className={iconSizes[size]} />
                    <span>{methodInfo.label}</span>
                </div>
            )}

            {/* Last sync time */}
            {lastSyncAt && status !== 'disconnected' && (
                <span className="text-xs text-gray-400">
                    Last sync: {formatLastSync(lastSyncAt)}
                </span>
            )}
        </div>
    )
}
