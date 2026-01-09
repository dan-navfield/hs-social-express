/**
 * BuyICT Organisation Detail Page
 * 
 * Shows detailed view of a single organisation with tabs:
 * - Overview (stats, summary)
 * - Opportunities (linked opps)
 * - Contacts (emails, people)
 * - Analysis (AI insights, patterns)
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
    Building2,
    Mail,
    FileText,
    BarChart3,
    MapPin,
    Star,
    ArrowLeft,
    ExternalLink,
    Loader2,
    Calendar,
    Clock,
    Users,
    Copy,
    Check,
    Briefcase,
    TrendingUp,
    Sparkles,
    Edit2,
    Save
} from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useSpaceStore } from '@/stores/spaceStore'

interface Organisation {
    id: string
    name: string
    raw_names: string[]
    org_type: string | null
    portfolio: string | null
    primary_email: string | null
    contact_emails: string[]
    contact_names: string[]
    opportunity_count: number
    open_opportunity_count: number
    first_opportunity_date: string | null
    last_opportunity_date: string | null
    common_categories: string[]
    common_modules: string[]
    common_working_arrangements: string[]
    common_locations: string[]
    is_target: boolean
    priority: string
    ai_summary: string | null
    ai_analysis: Record<string, any>
    notes: string | null
}

interface Opportunity {
    id: string
    buyict_reference: string
    title: string
    closing_date: string | null
    opportunity_status: string | null
    category: string | null
    buyer_contact: string | null
}

type TabId = 'overview' | 'opportunities' | 'contacts' | 'analysis'

export default function OrganisationDetail() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const { currentSpace } = useSpaceStore()

    const [organisation, setOrganisation] = useState<Organisation | null>(null)
    const [opportunities, setOpportunities] = useState<Opportunity[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [activeTab, setActiveTab] = useState<TabId>('overview')
    const [isEditingNotes, setIsEditingNotes] = useState(false)
    const [notes, setNotes] = useState('')
    const [copiedEmail, setCopiedEmail] = useState<string | null>(null)

    useEffect(() => {
        if (id && currentSpace?.id) {
            fetchOrganisation()
            fetchOpportunities()
        }
    }, [id, currentSpace?.id])

    const fetchOrganisation = async () => {
        if (!id) return

        try {
            const { data, error } = await supabase
                .from('buyict_organisations')
                .select('*')
                .eq('id', id)
                .single()

            if (error) throw error
            setOrganisation(data)
            setNotes(data?.notes || '')
        } catch (err) {
            console.error('Error fetching organisation:', err)
        } finally {
            setIsLoading(false)
        }
    }

    const fetchOpportunities = async () => {
        if (!id) return

        try {
            const { data, error } = await supabase
                .from('buyict_opportunities')
                .select('id, buyict_reference, title, closing_date, opportunity_status, category, buyer_contact')
                .eq('organisation_id', id)
                .order('closing_date', { ascending: false })

            if (error) throw error
            setOpportunities(data || [])
        } catch (err) {
            console.error('Error fetching opportunities:', err)
        }
    }

    const toggleTarget = async () => {
        if (!organisation) return

        try {
            const { error } = await supabase
                .from('buyict_organisations')
                .update({ is_target: !organisation.is_target })
                .eq('id', organisation.id)

            if (!error) {
                setOrganisation({ ...organisation, is_target: !organisation.is_target })
            }
        } catch (err) {
            console.error('Error toggling target:', err)
        }
    }

    const saveNotes = async () => {
        if (!organisation) return

        try {
            const { error } = await supabase
                .from('buyict_organisations')
                .update({ notes })
                .eq('id', organisation.id)

            if (!error) {
                setOrganisation({ ...organisation, notes })
                setIsEditingNotes(false)
            }
        } catch (err) {
            console.error('Error saving notes:', err)
        }
    }

    const copyEmail = (email: string) => {
        navigator.clipboard.writeText(email)
        setCopiedEmail(email)
        setTimeout(() => setCopiedEmail(null), 2000)
    }

    const copyAllEmails = () => {
        const allEmails = organisation?.contact_emails?.join(', ') || ''
        navigator.clipboard.writeText(allEmails)
        setCopiedEmail('all')
        setTimeout(() => setCopiedEmail(null), 2000)
    }

    if (isLoading) {
        return (
            <div className="p-8 flex items-center justify-center min-h-[400px]">
                <div className="flex items-center gap-3 text-gray-500">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Loading organisation...</span>
                </div>
            </div>
        )
    }

    if (!organisation) {
        return (
            <div className="p-8 text-center">
                <Building2 className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                <p className="text-gray-500">Organisation not found</p>
                <Button onClick={() => navigate('/buyict/organisations')} className="mt-4">
                    Back to Organisations
                </Button>
            </div>
        )
    }

    const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
        { id: 'overview', label: 'Overview', icon: <BarChart3 className="w-4 h-4" /> },
        { id: 'opportunities', label: `Opportunities (${opportunities.length})`, icon: <FileText className="w-4 h-4" /> },
        { id: 'contacts', label: `Contacts (${organisation.contact_emails?.length || 0})`, icon: <Mail className="w-4 h-4" /> },
        { id: 'analysis', label: 'Analysis', icon: <Sparkles className="w-4 h-4" /> },
    ]

    return (
        <div className="p-6 max-w-6xl mx-auto">
            {/* Header */}
            <div className="mb-6">
                <button
                    onClick={() => navigate('/buyict/organisations')}
                    className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-4"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Organisations
                </button>

                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-purple-100 rounded-xl">
                            <Building2 className="w-8 h-8 text-purple-600" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900">{organisation.name}</h1>
                            {organisation.portfolio && (
                                <p className="text-gray-500">{organisation.portfolio}</p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={toggleTarget}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${organisation.is_target
                                ? 'bg-amber-50 border-amber-200 text-amber-700'
                                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            <Star className={`w-4 h-4 ${organisation.is_target ? 'fill-current' : ''}`} />
                            {organisation.is_target ? 'Target Org' : 'Mark as Target'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 rounded-lg">
                            <FileText className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{organisation.opportunity_count}</p>
                            <p className="text-sm text-gray-500">Total Opportunities</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-100 rounded-lg">
                            <Clock className="w-5 h-5 text-green-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{organisation.open_opportunity_count}</p>
                            <p className="text-sm text-gray-500">Open Now</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-100 rounded-lg">
                            <Mail className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{organisation.contact_emails?.length || 0}</p>
                            <p className="text-sm text-gray-500">Contact Emails</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-100 rounded-lg">
                            <Calendar className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                            <p className="text-sm font-medium">
                                {organisation.last_opportunity_date
                                    ? new Date(organisation.last_opportunity_date).toLocaleDateString()
                                    : '-'
                                }
                            </p>
                            <p className="text-sm text-gray-500">Last Activity</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-200 mb-6">
                <nav className="flex gap-6">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 py-3 px-1 border-b-2 font-medium text-sm transition-colors ${activeTab === tab.id
                                ? 'border-purple-600 text-purple-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </nav>
            </div>

            {/* Tab Content */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
                {activeTab === 'overview' && (
                    <div className="space-y-6">
                        {/* Common Areas */}
                        <div>
                            <h3 className="font-semibold text-gray-900 mb-3">Common Procurement Areas</h3>
                            <div className="flex flex-wrap gap-2">
                                {(organisation.common_categories || []).map((cat, i) => (
                                    <span key={i} className="px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-sm">
                                        {cat}
                                    </span>
                                ))}
                                {(!organisation.common_categories || organisation.common_categories.length === 0) && (
                                    <span className="text-gray-400">No categories identified yet</span>
                                )}
                            </div>
                        </div>

                        {/* Locations */}
                        <div>
                            <h3 className="font-semibold text-gray-900 mb-3">Locations</h3>
                            <div className="flex flex-wrap gap-2">
                                {(organisation.common_locations || []).map((loc, i) => (
                                    <span key={i} className="flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm">
                                        <MapPin className="w-3 h-3" />
                                        {loc}
                                    </span>
                                ))}
                                {(!organisation.common_locations || organisation.common_locations.length === 0) && (
                                    <span className="text-gray-400">No locations identified yet</span>
                                )}
                            </div>
                        </div>

                        {/* Working Arrangements */}
                        <div>
                            <h3 className="font-semibold text-gray-900 mb-3">Working Arrangements</h3>
                            <div className="flex flex-wrap gap-2">
                                {(organisation.common_working_arrangements || []).map((arr, i) => (
                                    <span key={i} className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm">
                                        {arr}
                                    </span>
                                ))}
                                {(!organisation.common_working_arrangements || organisation.common_working_arrangements.length === 0) && (
                                    <span className="text-gray-400">No arrangements identified yet</span>
                                )}
                            </div>
                        </div>

                        {/* Notes */}
                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="font-semibold text-gray-900">Notes</h3>
                                {isEditingNotes ? (
                                    <Button size="sm" onClick={saveNotes}>
                                        <Save className="w-4 h-4 mr-1" />
                                        Save
                                    </Button>
                                ) : (
                                    <Button size="sm" variant="secondary" onClick={() => setIsEditingNotes(true)}>
                                        <Edit2 className="w-4 h-4 mr-1" />
                                        Edit
                                    </Button>
                                )}
                            </div>
                            {isEditingNotes ? (
                                <textarea
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    className="w-full p-3 border rounded-lg h-32 resize-none"
                                    placeholder="Add notes about this organisation..."
                                />
                            ) : (
                                <p className="text-gray-600">
                                    {notes || <span className="text-gray-400 italic">No notes yet</span>}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'opportunities' && (
                    <div>
                        {opportunities.length === 0 ? (
                            <div className="text-center py-8 text-gray-500">
                                <FileText className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                                <p>No opportunities linked to this organisation</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-100">
                                {opportunities.map(opp => (
                                    <Link
                                        key={opp.id}
                                        to={`/buyict/opportunity/${opp.id}`}
                                        className="flex items-center justify-between py-4 hover:bg-gray-50 -mx-6 px-6"
                                    >
                                        <div>
                                            <p className="text-sm text-purple-600 font-mono">{opp.buyict_reference}</p>
                                            <p className="font-medium text-gray-900">{opp.title}</p>
                                            {opp.category && (
                                                <p className="text-sm text-gray-500">{opp.category}</p>
                                            )}
                                        </div>
                                        <div className="text-right">
                                            {opp.closing_date && (
                                                <p className="text-sm text-gray-500">
                                                    Closes: {new Date(opp.closing_date).toLocaleDateString()}
                                                </p>
                                            )}
                                            <span className={`inline-flex px-2 py-0.5 rounded text-xs ${opp.opportunity_status === 'Open'
                                                ? 'bg-green-100 text-green-700'
                                                : 'bg-gray-100 text-gray-600'
                                                }`}>
                                                {opp.opportunity_status || 'Unknown'}
                                            </span>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'contacts' && (
                    <div>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-semibold text-gray-900">Email Contacts</h3>
                            {organisation.contact_emails?.length > 0 && (
                                <Button size="sm" variant="secondary" onClick={copyAllEmails}>
                                    {copiedEmail === 'all' ? (
                                        <>
                                            <Check className="w-4 h-4 mr-1 text-green-600" />
                                            Copied!
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="w-4 h-4 mr-1" />
                                            Copy All
                                        </>
                                    )}
                                </Button>
                            )}
                        </div>

                        {(!organisation.contact_emails || organisation.contact_emails.length === 0) ? (
                            <div className="text-center py-8 text-gray-500">
                                <Mail className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                                <p>No email contacts found</p>
                                <p className="text-sm">Emails are extracted from opportunity contact fields</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {organisation.contact_emails.map((email, i) => (
                                    <div
                                        key={i}
                                        className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                                    >
                                        <div className="flex items-center gap-3">
                                            <Mail className="w-4 h-4 text-gray-400" />
                                            <span className="font-mono text-sm">{email}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <a
                                                href={`mailto:${email}`}
                                                className="p-2 hover:bg-gray-200 rounded-lg text-gray-500"
                                            >
                                                <ExternalLink className="w-4 h-4" />
                                            </a>
                                            <button
                                                onClick={() => copyEmail(email)}
                                                className="p-2 hover:bg-gray-200 rounded-lg text-gray-500"
                                            >
                                                {copiedEmail === email ? (
                                                    <Check className="w-4 h-4 text-green-600" />
                                                ) : (
                                                    <Copy className="w-4 h-4" />
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'analysis' && (
                    <div>
                        {organisation.ai_summary ? (
                            <div className="space-y-6">
                                <div>
                                    <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                        <Sparkles className="w-4 h-4 text-purple-600" />
                                        AI Summary
                                    </h3>
                                    <p className="text-gray-600 bg-purple-50 p-4 rounded-lg">
                                        {organisation.ai_summary}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-12">
                                <Sparkles className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                                <p className="text-gray-500 mb-4">No AI analysis available yet</p>
                                <Button variant="secondary">
                                    <TrendingUp className="w-4 h-4 mr-2" />
                                    Generate Analysis
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
