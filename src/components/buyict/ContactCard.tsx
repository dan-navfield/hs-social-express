import { Mail, Phone, Building2, FileText, Eye, ShieldCheck, ShieldAlert } from 'lucide-react'
import type { BuyICTContactWithProvenance, BuyICTContactSourceType } from '@/types/buyict'

interface ContactCardProps {
    contact: BuyICTContactWithProvenance
    onClick?: () => void
    showProvenance?: boolean
}

const sourceTypeConfig: Record<BuyICTContactSourceType, { label: string; icon: typeof FileText; color: string }> = {
    structured_field: { label: 'Field', icon: FileText, color: 'text-emerald-600 bg-emerald-50' },
    page_text: { label: 'Page', icon: Eye, color: 'text-blue-600 bg-blue-50' },
    attachment: { label: 'Attachment', icon: FileText, color: 'text-purple-600 bg-purple-50' },
}

export function ContactCard({ contact, onClick, showProvenance = true }: ContactCardProps) {
    // Get unique departments from linked opportunities
    const departments = [...new Set(contact.linked_departments || [])]

    // Get the highest confidence source
    const bestSource = contact.opportunities.reduce((best, curr) => {
        if (!best || curr.extraction_confidence > best.extraction_confidence) return curr
        return best
    }, contact.opportunities[0])

    const getConfidenceIndicator = (confidence: number) => {
        if (confidence >= 0.9) return { icon: ShieldCheck, color: 'text-emerald-500', label: 'High' }
        if (confidence >= 0.7) return { icon: ShieldCheck, color: 'text-blue-500', label: 'Good' }
        if (confidence >= 0.5) return { icon: ShieldAlert, color: 'text-amber-500', label: 'Medium' }
        return { icon: ShieldAlert, color: 'text-red-500', label: 'Low' }
    }

    return (
        <div
            onClick={onClick}
            className="p-5 bg-white border border-gray-200 rounded-xl hover:border-purple-300 hover:shadow-md transition-all cursor-pointer"
        >
            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-3">
                <div className="flex-1 min-w-0">
                    {/* Name & Email */}
                    <div className="flex items-center gap-2 mb-1">
                        <Mail className="w-4 h-4 text-gray-400 shrink-0" />
                        <a
                            href={`mailto:${contact.email}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-600 hover:text-blue-700 font-medium truncate"
                        >
                            {contact.email}
                        </a>
                    </div>
                    {contact.name && (
                        <p className="text-gray-900 font-medium ml-6">{contact.name}</p>
                    )}
                    {contact.phone && (
                        <div className="flex items-center gap-2 mt-1 ml-6">
                            <Phone className="w-3.5 h-3.5 text-gray-400" />
                            <span className="text-sm text-gray-600">{contact.phone}</span>
                        </div>
                    )}
                </div>

                {/* Opportunity count badge */}
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg">
                    <span className="text-lg font-bold">{contact.opportunity_count}</span>
                    <span className="text-xs">opp{contact.opportunity_count !== 1 ? 's' : ''}</span>
                </div>
            </div>

            {/* Departments */}
            {departments.length > 0 && (
                <div className="flex items-center gap-2 mb-3">
                    <Building2 className="w-4 h-4 text-gray-400" />
                    <div className="flex flex-wrap gap-1.5">
                        {departments.slice(0, 3).map((dept) => (
                            <span
                                key={dept}
                                className="text-xs px-2 py-0.5 bg-gray-100 text-gray-700 rounded"
                            >
                                {dept}
                            </span>
                        ))}
                        {departments.length > 3 && (
                            <span className="text-xs text-gray-400">+{departments.length - 3} more</span>
                        )}
                    </div>
                </div>
            )}

            {/* Provenance section */}
            {showProvenance && bestSource && (
                <div className="pt-3 mt-3 border-t border-gray-100">
                    <p className="text-xs text-gray-400 mb-2">Extraction source</p>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {/* Source type badge */}
                            {(() => {
                                const sourceConfig = sourceTypeConfig[bestSource.source_type]
                                const SourceIcon = sourceConfig.icon
                                return (
                                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${sourceConfig.color}`}>
                                        <SourceIcon className="w-3 h-3" />
                                        {sourceConfig.label}
                                    </span>
                                )
                            })()}

                            {/* Source detail */}
                            {bestSource.source_detail && (
                                <span className="text-xs text-gray-500">{bestSource.source_detail}</span>
                            )}

                            {/* Role label */}
                            {bestSource.role_label && (
                                <span className="text-xs text-gray-600 font-medium">
                                    "{bestSource.role_label}"
                                </span>
                            )}
                        </div>

                        {/* Confidence indicator */}
                        {(() => {
                            const conf = getConfidenceIndicator(bestSource.extraction_confidence)
                            const ConfIcon = conf.icon
                            return (
                                <div className="flex items-center gap-1">
                                    <ConfIcon className={`w-3.5 h-3.5 ${conf.color}`} />
                                    <span className={`text-xs ${conf.color}`}>
                                        {Math.round(bestSource.extraction_confidence * 100)}%
                                    </span>
                                </div>
                            )
                        })()}
                    </div>
                </div>
            )}

            {/* Linked opportunities preview */}
            {contact.opportunities.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-xs text-gray-400 mb-2">Recent opportunities</p>
                    <div className="space-y-1">
                        {contact.opportunities.slice(0, 2).map((opp) => (
                            <div key={opp.id} className="flex items-center gap-2 text-xs">
                                <span className="font-mono text-gray-400">{opp.buyict_reference}</span>
                                <span className="text-gray-600 truncate">{opp.title}</span>
                            </div>
                        ))}
                        {contact.opportunities.length > 2 && (
                            <span className="text-xs text-gray-400">
                                +{contact.opportunities.length - 2} more opportunities
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* Timestamps */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400">
                <span>First seen: {new Date(contact.first_seen_at).toLocaleDateString()}</span>
                <span>Last seen: {new Date(contact.last_seen_at).toLocaleDateString()}</span>
            </div>
        </div>
    )
}
