import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
    ArrowLeft,
    Building2,
    Calendar,
    Clock,
    MapPin,
    ExternalLink,
    Briefcase,
    FileText,
    Mail,
    AlertCircle,
    Loader2,
    Timer,
    Users,
    ClipboardList,
    CalendarDays
} from 'lucide-react'
import { Button } from '@/components/ui'
import { useSpaceStore } from '@/stores/spaceStore'
import { supabase } from '@/lib/supabase'

interface Opportunity {
    id: string
    buyict_reference: string
    buyict_url: string
    title: string
    buyer_entity_raw: string | null
    category: string | null
    description: string | null
    publish_date: string | null
    closing_date: string | null
    opportunity_status: string | null
    contact_text_raw: string | null
    location: string | null
    working_arrangement: string | null
    module: string | null
    created_at: string
    // Extended fields
    rfq_type: string | null
    rfq_id: string | null
    deadline_for_questions: string | null
    buyer_contact: string | null
    estimated_start_date: string | null
    initial_contract_duration: string | null
    extension_term: string | null
    extension_term_details: string | null
    number_of_extensions: string | null
    industry_briefing: string | null
    requirements: string | null
    criteria: string[] | null
    engagement_type: string | null
}

export function OpportunityDetail() {
    const { id } = useParams<{ id: string }>()
    const { currentSpace } = useSpaceStore()
    const [opportunity, setOpportunity] = useState<Opportunity | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!currentSpace?.id || !id) return

        const fetchOpportunity = async () => {
            setIsLoading(true)
            try {
                const { data, error: fetchError } = await supabase
                    .from('buyict_opportunities')
                    .select('*')
                    .eq('id', id)
                    .eq('space_id', currentSpace.id)
                    .single()

                if (fetchError) throw fetchError
                setOpportunity(data)
            } catch (err) {
                console.error('Failed to fetch opportunity:', err)
                setError('Failed to load opportunity details')
            } finally {
                setIsLoading(false)
            }
        }

        fetchOpportunity()
    }, [id, currentSpace?.id])

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return 'Not specified'
        try {
            return new Date(dateStr).toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })
        } catch {
            return dateStr
        }
    }

    const getDaysRemaining = (dateStr: string | null) => {
        if (!dateStr) return null
        try {
            const closing = new Date(dateStr)
            const now = new Date()
            const diff = Math.ceil((closing.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
            return diff
        } catch {
            return null
        }
    }

    if (isLoading) {
        return (
            <div className="min-h-[400px] flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
            </div>
        )
    }

    if (error || !opportunity) {
        return (
            <div className="max-w-4xl mx-auto p-6">
                <Link to="/buyict/opportunities" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6">
                    <ArrowLeft className="w-4 h-4" />
                    Back to Opportunities
                </Link>
                <div className="bg-red-50 border border-red-200 rounded-lg p-6 flex items-center gap-3">
                    <AlertCircle className="w-6 h-6 text-red-600" />
                    <p className="text-red-800">{error || 'Opportunity not found'}</p>
                </div>
            </div>
        )
    }

    const daysRemaining = getDaysRemaining(opportunity.closing_date)

    return (
        <div className="max-w-4xl mx-auto p-6">
            {/* Header */}
            <div className="mb-6">
                <Link to="/buyict/opportunities" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4">
                    <ArrowLeft className="w-4 h-4" />
                    Back to Opportunities
                </Link>

                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-sm font-medium text-purple-600">{opportunity.buyict_reference}</span>
                            {opportunity.rfq_type && (
                                <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
                                    {opportunity.rfq_type}
                                </span>
                            )}
                            {opportunity.category && (
                                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                                    {opportunity.category}
                                </span>
                            )}
                        </div>
                        <h1 className="text-2xl font-bold text-gray-900">{opportunity.title}</h1>
                    </div>

                    {daysRemaining !== null && (
                        <div className={`px-3 py-1.5 rounded-lg text-sm font-medium ${daysRemaining <= 0 ? 'bg-red-100 text-red-700' :
                            daysRemaining <= 7 ? 'bg-amber-100 text-amber-700' :
                                'bg-green-100 text-green-700'
                            }`}>
                            {daysRemaining <= 0 ? 'Closed' : `${daysRemaining} days left`}
                        </div>
                    )}
                </div>
            </div>

            {/* Key Details Grid */}
            <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Key Details</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {opportunity.buyer_entity_raw && (
                        <div className="flex items-start gap-3">
                            <Building2 className="w-5 h-5 text-gray-400 mt-0.5" />
                            <div>
                                <p className="text-sm text-gray-500">Buyer / Agency</p>
                                <p className="font-medium text-gray-900">{opportunity.buyer_entity_raw}</p>
                            </div>
                        </div>
                    )}

                    {opportunity.buyer_contact && (
                        <div className="flex items-start gap-3">
                            <Mail className="w-5 h-5 text-gray-400 mt-0.5" />
                            <div>
                                <p className="text-sm text-gray-500">Buyer Contact</p>
                                <a href={`mailto:${opportunity.buyer_contact}`} className="font-medium text-purple-600 hover:underline">
                                    {opportunity.buyer_contact}
                                </a>
                            </div>
                        </div>
                    )}

                    {opportunity.rfq_id && (
                        <div className="flex items-start gap-3">
                            <FileText className="w-5 h-5 text-gray-400 mt-0.5" />
                            <div>
                                <p className="text-sm text-gray-500">RFQ ID</p>
                                <p className="font-medium text-gray-900">{opportunity.rfq_id}</p>
                            </div>
                        </div>
                    )}

                    {opportunity.publish_date && (
                        <div className="flex items-start gap-3">
                            <CalendarDays className="w-5 h-5 text-gray-400 mt-0.5" />
                            <div>
                                <p className="text-sm text-gray-500">Published Date</p>
                                <p className="font-medium text-gray-900">{opportunity.publish_date}</p>
                            </div>
                        </div>
                    )}

                    {opportunity.closing_date && (
                        <div className="flex items-start gap-3">
                            <Calendar className="w-5 h-5 text-gray-400 mt-0.5" />
                            <div>
                                <p className="text-sm text-gray-500">Closing Date</p>
                                <p className="font-medium text-gray-900">{opportunity.closing_date}</p>
                            </div>
                        </div>
                    )}

                    {opportunity.deadline_for_questions && (
                        <div className="flex items-start gap-3">
                            <Timer className="w-5 h-5 text-gray-400 mt-0.5" />
                            <div>
                                <p className="text-sm text-gray-500">Deadline for Questions</p>
                                <p className="font-medium text-gray-900">{opportunity.deadline_for_questions}</p>
                            </div>
                        </div>
                    )}

                    {opportunity.location && (
                        <div className="flex items-start gap-3">
                            <MapPin className="w-5 h-5 text-gray-400 mt-0.5" />
                            <div>
                                <p className="text-sm text-gray-500">Location</p>
                                <p className="font-medium text-gray-900">{opportunity.location}</p>
                            </div>
                        </div>
                    )}

                    {opportunity.working_arrangement && (
                        <div className="flex items-start gap-3">
                            <Briefcase className="w-5 h-5 text-gray-400 mt-0.5" />
                            <div>
                                <p className="text-sm text-gray-500">Working Arrangement</p>
                                <p className="font-medium text-gray-900">{opportunity.working_arrangement}</p>
                            </div>
                        </div>
                    )}

                    {opportunity.industry_briefing && (
                        <div className="flex items-start gap-3">
                            <Users className="w-5 h-5 text-gray-400 mt-0.5" />
                            <div>
                                <p className="text-sm text-gray-500">Industry Briefing</p>
                                <p className="font-medium text-gray-900">{opportunity.industry_briefing}</p>
                            </div>
                        </div>
                    )}

                    {opportunity.opportunity_status && (
                        <div className="flex items-start gap-3">
                            <Clock className="w-5 h-5 text-gray-400 mt-0.5" />
                            <div>
                                <p className="text-sm text-gray-500">Status</p>
                                <p className="font-medium text-gray-900">{opportunity.opportunity_status}</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Contract Details */}
            {(opportunity.estimated_start_date || opportunity.initial_contract_duration || opportunity.extension_term) && (
                <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Contract Details</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {opportunity.estimated_start_date && (
                            <div>
                                <p className="text-sm text-gray-500">Estimated Start Date</p>
                                <p className="font-medium text-gray-900">{opportunity.estimated_start_date}</p>
                            </div>
                        )}
                        {opportunity.initial_contract_duration && (
                            <div>
                                <p className="text-sm text-gray-500">Initial Contract Duration</p>
                                <p className="font-medium text-gray-900">{opportunity.initial_contract_duration}</p>
                            </div>
                        )}
                        {opportunity.extension_term && (
                            <div>
                                <p className="text-sm text-gray-500">Extension Term</p>
                                <p className="font-medium text-gray-900">{opportunity.extension_term}</p>
                            </div>
                        )}
                        {opportunity.extension_term_details && (
                            <div>
                                <p className="text-sm text-gray-500">Extension Details</p>
                                <p className="font-medium text-gray-900">{opportunity.extension_term_details}</p>
                            </div>
                        )}
                        {opportunity.number_of_extensions && (
                            <div>
                                <p className="text-sm text-gray-500">Number of Extensions</p>
                                <p className="font-medium text-gray-900">{opportunity.number_of_extensions}</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Requirements */}
            {(opportunity.requirements || opportunity.description) && (
                <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Requirements</h2>
                    <div className="prose prose-sm max-w-none text-gray-700 whitespace-pre-wrap">
                        {opportunity.requirements || opportunity.description}
                    </div>
                </div>
            )}

            {/* Criteria */}
            {opportunity.criteria && opportunity.criteria.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <ClipboardList className="w-5 h-5" />
                        Evaluation Criteria
                    </h2>
                    <ul className="space-y-2">
                        {opportunity.criteria.map((criterion, index) => (
                            <li key={index} className="flex items-start gap-2 text-gray-700">
                                <span className="w-5 h-5 flex items-center justify-center rounded-full bg-purple-100 text-purple-700 text-xs font-medium flex-shrink-0 mt-0.5">
                                    {index + 1}
                                </span>
                                <span>{criterion}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Contact Info (legacy) */}
            {opportunity.contact_text_raw && !opportunity.buyer_contact && (
                <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                        <Mail className="w-5 h-5" />
                        Contact Information
                    </h2>
                    <p className="text-gray-700">{opportunity.contact_text_raw}</p>
                </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3">
                {opportunity.buyict_url && (
                    <a
                        href={opportunity.buyict_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                    >
                        <ExternalLink className="w-4 h-4" />
                        View on BuyICT
                    </a>
                )}
            </div>

            {/* Metadata */}
            <div className="mt-8 pt-6 border-t border-gray-200 text-sm text-gray-500">
                <p>Synced: {formatDate(opportunity.created_at)}</p>
            </div>
        </div>
    )
}

export default OpportunityDetail
