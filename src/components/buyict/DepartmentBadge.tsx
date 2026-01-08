import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react'

interface DepartmentBadgeProps {
    department: string | null | undefined
    agency?: string | null
    confidence?: number | null
    isApproved?: boolean | null
    buyerEntityRaw?: string | null
    showConfidence?: boolean
    size?: 'sm' | 'md'
}

export function DepartmentBadge({
    department,
    agency,
    confidence,
    isApproved,
    buyerEntityRaw,
    showConfidence = true,
    size = 'md',
}: DepartmentBadgeProps) {
    const hasMappedDepartment = !!department

    // Determine confidence level for visual styling
    const getConfidenceStyle = () => {
        if (!hasMappedDepartment) {
            return {
                bg: 'bg-amber-50',
                border: 'border-amber-200',
                text: 'text-amber-700',
                icon: ShieldQuestion,
                label: 'Unmapped',
            }
        }
        if (isApproved) {
            return {
                bg: 'bg-emerald-50',
                border: 'border-emerald-200',
                text: 'text-emerald-700',
                icon: ShieldCheck,
                label: 'Verified',
            }
        }
        if (confidence && confidence >= 0.8) {
            return {
                bg: 'bg-blue-50',
                border: 'border-blue-200',
                text: 'text-blue-700',
                icon: ShieldCheck,
                label: 'High',
            }
        }
        if (confidence && confidence >= 0.5) {
            return {
                bg: 'bg-yellow-50',
                border: 'border-yellow-200',
                text: 'text-yellow-700',
                icon: ShieldAlert,
                label: 'Medium',
            }
        }
        return {
            bg: 'bg-orange-50',
            border: 'border-orange-200',
            text: 'text-orange-700',
            icon: ShieldAlert,
            label: 'Low',
        }
    }

    const style = getConfidenceStyle()
    const Icon = style.icon

    const sizeClasses = size === 'sm'
        ? 'text-xs px-2 py-0.5'
        : 'text-sm px-3 py-1'

    const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'

    return (
        <div className="flex flex-col gap-1">
            {/* Main department badge */}
            <div className={`inline-flex items-center gap-1.5 rounded-lg border ${style.bg} ${style.border} ${sizeClasses}`}>
                {showConfidence && (
                    <Icon className={`${iconSize} ${style.text}`} />
                )}
                <span className={`font-medium ${style.text}`}>
                    {department || buyerEntityRaw || 'Unknown'}
                </span>
                {showConfidence && confidence && !isApproved && (
                    <span className={`opacity-60 ${style.text}`}>
                        ({Math.round(confidence * 100)}%)
                    </span>
                )}
            </div>

            {/* Agency sub-label */}
            {agency && (
                <span className="text-xs text-gray-500 pl-1">
                    {agency}
                </span>
            )}

            {/* Show original if different from mapped */}
            {hasMappedDepartment && buyerEntityRaw && buyerEntityRaw !== department && (
                <span className="text-xs text-gray-400 pl-1 italic">
                    via "{buyerEntityRaw}"
                </span>
            )}
        </div>
    )
}
