import { Calendar, ExternalLink, Users, Building2, Clock } from 'lucide-react'
import { DepartmentBadge } from './DepartmentBadge'
import type { BuyICTOpportunityWithDepartment } from '@/types/buyict'

interface OpportunityCardProps {
    opportunity: BuyICTOpportunityWithDepartment
    onClick?: () => void
    compact?: boolean
}

export function OpportunityCard({ opportunity, onClick, compact = false }: OpportunityCardProps) {
    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return 'N/A'
        return new Date(dateStr).toLocaleDateString('en-AU', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        })
    }

    const formatTime = (dateStr: string | null) => {
        if (!dateStr) return ''
        const date = new Date(dateStr)
        return date.toLocaleTimeString('en-AU', {
            hour: '2-digit',
            minute: '2-digit',
        })
    }

    const getClosingStatus = () => {
        if (!opportunity.closing_date) return { status: 'unknown', label: 'No closing date' }

        const now = new Date()
        const closing = new Date(opportunity.closing_date)
        const diffDays = Math.ceil((closing.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

        if (diffDays < 0) return { status: 'closed', label: 'Closed' }
        if (diffDays === 0) return { status: 'today', label: 'Closes today!' }
        if (diffDays <= 3) return { status: 'urgent', label: `${diffDays} day${diffDays > 1 ? 's' : ''} left` }
        if (diffDays <= 7) return { status: 'soon', label: `${diffDays} days left` }
        return { status: 'open', label: `${diffDays} days left` }
    }

    const closingStatus = getClosingStatus()

    const statusColors: Record<string, string> = {
        closed: 'text-gray-500 bg-gray-100',
        today: 'text-red-600 bg-red-100',
        urgent: 'text-orange-600 bg-orange-100',
        soon: 'text-amber-600 bg-amber-100',
        open: 'text-emerald-600 bg-emerald-100',
        unknown: 'text-gray-400 bg-gray-50',
    }

    if (compact) {
        return (
            <div
                onClick={onClick}
                className={`p-4 bg-white border border-gray-200 rounded-lg hover:border-purple-300 hover:shadow-sm transition-all cursor-pointer`}
            >
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-gray-400">{opportunity.buyict_reference}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[closingStatus.status]}`}>
                                {closingStatus.label}
                            </span>
                        </div>
                        <h3 className="font-medium text-gray-900 truncate">{opportunity.title}</h3>
                        <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                            <DepartmentBadge
                                department={opportunity.canonical_department}
                                confidence={opportunity.mapping_confidence}
                                isApproved={opportunity.mapping_approved}
                                buyerEntityRaw={opportunity.buyer_entity_raw}
                                showConfidence={false}
                                size="sm"
                            />
                            {(opportunity.contacts_count ?? 0) > 0 && (
                                <span className="flex items-center gap-1">
                                    <Users className="w-3.5 h-3.5" />
                                    {opportunity.contacts_count}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div
            onClick={onClick}
            className={`p-6 bg-white border border-gray-200 rounded-xl hover:border-purple-300 hover:shadow-md transition-all cursor-pointer`}
        >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                        <span className="text-sm font-mono text-gray-400 bg-gray-50 px-2 py-0.5 rounded">
                            {opportunity.buyict_reference}
                        </span>
                        {opportunity.category && (
                            <span className="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded">
                                {opportunity.category}
                            </span>
                        )}
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 leading-tight">
                        {opportunity.title}
                    </h3>
                </div>

                {/* Status badge */}
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg ${statusColors[closingStatus.status]}`}>
                    <Clock className="w-4 h-4" />
                    <span className="text-sm font-medium">{closingStatus.label}</span>
                </div>
            </div>

            {/* Description preview */}
            {opportunity.description && (
                <p className="text-sm text-gray-600 line-clamp-2 mb-4">
                    {opportunity.description}
                </p>
            )}

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-4 text-sm">
                {/* Department */}
                <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-gray-400" />
                    <DepartmentBadge
                        department={opportunity.canonical_department}
                        agency={opportunity.canonical_agency}
                        confidence={opportunity.mapping_confidence}
                        isApproved={opportunity.mapping_approved}
                        buyerEntityRaw={opportunity.buyer_entity_raw}
                        size="sm"
                    />
                </div>

                {/* Closing date */}
                <div className="flex items-center gap-1.5 text-gray-500">
                    <Calendar className="w-4 h-4" />
                    <span>
                        {formatDate(opportunity.closing_date)}
                        {opportunity.closing_date && (
                            <span className="text-gray-400 ml-1">{formatTime(opportunity.closing_date)}</span>
                        )}
                    </span>
                </div>

                {/* Contacts count */}
                {(opportunity.contacts_count ?? 0) > 0 && (
                    <div className="flex items-center gap-1.5 text-purple-600">
                        <Users className="w-4 h-4" />
                        <span>{opportunity.contacts_count} contact{(opportunity.contacts_count ?? 0) > 1 ? 's' : ''}</span>
                    </div>
                )}

                {/* External link */}
                {opportunity.buyict_url && (
                    <a
                        href={opportunity.buyict_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 text-blue-600 hover:text-blue-700 ml-auto"
                    >
                        <span>View on BuyICT</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                )}
            </div>
        </div>
    )
}
