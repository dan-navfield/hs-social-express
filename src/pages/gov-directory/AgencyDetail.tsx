import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
    ArrowLeft,
    Building2,
    Users,
    Globe,
    Phone,
    Mail,
    MapPin,
    ExternalLink,
    Star,
    StarOff,
    RefreshCw,
    Loader2,
    Search,
    Linkedin,
    User,
    ChevronDown,
    ChevronRight,
    AlertCircle,
    FileText,
    Edit2,
    Trash2
} from 'lucide-react'
import { Button } from '@/components/ui'
import { useSpaceStore } from '@/stores/spaceStore'
import { supabase } from '@/lib/supabase'

interface GovAgency {
    id: string
    name: string
    slug: string | null
    short_name: string | null
    acronym: string | null
    website: string | null
    agency_type: string | null
    portfolio: string | null
    head_office_address: string | null
    phone: string | null
    email: string | null
    abn: string | null
    org_chart_url: string | null
    org_chart_status: string
    org_chart_last_scraped: string | null
    directory_gov_url: string | null
    notes: string | null
    is_priority: boolean
    last_synced_at: string | null
}

interface ExtractionProgress {
    runId: string
    status: string
    startedAt: string
    pagesProcessed: number
    peopleFound: number
    elapsedSeconds: number
}

interface GovPerson {
    id: string
    name: string
    title: string | null
    division: string | null
    bio: string | null
    photo_url: string | null
    email: string | null
    phone: string | null
    linkedin_url: string | null
    linkedin_status: string
    seniority_level: number | null
    is_key_contact: boolean
    source_url: string | null
}

export function AgencyDetail() {
    const { slug } = useParams<{ slug: string }>()
    const navigate = useNavigate()
    const { currentSpace } = useSpaceStore()

    const [agency, setAgency] = useState<GovAgency | null>(null)
    const [people, setPeople] = useState<GovPerson[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [isDiscoveringOrgChart, setIsDiscoveringOrgChart] = useState(false)
    const [isScrapingPeople, setIsScrapingPeople] = useState(false)
    const [extractionProgress, setExtractionProgress] = useState<ExtractionProgress | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([1, 2, 3]))

    useEffect(() => {
        if (slug && currentSpace?.id) {
            fetchAgencyDetails()
        }
    }, [slug, currentSpace?.id])

    const fetchAgencyDetails = async () => {
        if (!slug) return

        setIsLoading(true)
        try {
            // Fetch agency by slug (fallback to id for backwards compatibility)
            let query = supabase.from('gov_agencies').select('*')

            // Check if it looks like a UUID
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)
            if (isUuid) {
                query = query.eq('id', slug)
            } else {
                query = query.eq('slug', slug)
            }

            const { data: agencyData, error: agencyError } = await query.single()

            if (agencyError) throw agencyError
            setAgency(agencyData)

            // Fetch people
            const { data: peopleData, error: peopleError } = await supabase
                .from('gov_agency_people')
                .select('*')
                .eq('agency_id', agencyData.id)
                .order('seniority_level', { ascending: true })
                .order('name')

            if (peopleError) throw peopleError
            setPeople(peopleData || [])
        } catch (err) {
            console.error('Failed to fetch agency:', err)
            setError('Failed to load agency details')
        } finally {
            setIsLoading(false)
        }
    }

    const handleTogglePriority = async () => {
        if (!agency) return

        const { error } = await supabase
            .from('gov_agencies')
            .update({ is_priority: !agency.is_priority })
            .eq('id', agency.id)

        if (!error) {
            setAgency({ ...agency, is_priority: !agency.is_priority })
        }
    }

    const handleDiscoverOrgChart = async () => {
        setIsDiscoveringOrgChart(true)
        // TODO: Implement org chart discovery via Google Search API
        setTimeout(() => {
            setIsDiscoveringOrgChart(false)
            alert('Org chart discovery coming soon! Will search for executive/leadership pages.')
        }, 1000)
    }

    const handleScrapePeople = async () => {
        if (!agency) return

        // Get Apify token
        const apifyToken = localStorage.getItem('apify_token')
        if (!apifyToken) {
            alert('Please set your Apify API token first (go to Directory page and click Sync)')
            return
        }

        // Get Gemini key from prompt (or could be stored)
        const geminiKey = prompt('Enter your Gemini API key for AI extraction:')
        if (!geminiKey) {
            return
        }

        setIsScrapingPeople(true)

        try {
            const actorName = 'verifiable_hare~orgchart-scraper'
            const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gov-people-sync`

            const response = await fetch(`https://api.apify.com/v2/acts/${actorName}/runs?token=${apifyToken}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    webhookUrl,
                    geminiApiKey: geminiKey,
                    agencies: [{
                        id: agency.id,
                        name: agency.name,
                        website: agency.website
                    }],
                    maxAgencies: 1
                })
            })

            if (!response.ok) {
                throw new Error(`API error: ${await response.text()}`)
            }

            const data = await response.json()
            alert(`Extraction started! Run ID: ${data.data.id}\n\nCheck Apify console for progress. People will appear here once extracted.`)

            // Refresh after a delay
            setTimeout(() => {
                fetchAgencyDetails()
            }, 30000)

        } catch (err) {
            console.error('Failed to start extraction:', err)
            alert(`Failed to start extraction: ${err}`)
        } finally {
            setIsScrapingPeople(false)
        }
    }

    // Group people by seniority level
    const seniorityLabels: Record<number, string> = {
        1: 'Secretary / CEO',
        2: 'Deputy Secretary / COO',
        3: 'First Assistant Secretary / Group Manager',
        4: 'Assistant Secretary / Director',
        5: 'Other Key Roles'
    }

    const groupedPeople = people.reduce((acc, person) => {
        const level = person.seniority_level || 5
        if (!acc[level]) acc[level] = []
        acc[level].push(person)
        return acc
    }, {} as Record<number, GovPerson[]>)

    const filteredPeople = searchQuery
        ? people.filter(p =>
            p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.division?.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : null // null means show grouped view

    if (isLoading) {
        return (
            <div className="min-h-[400px] flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
            </div>
        )
    }

    if (error || !agency) {
        return (
            <div className="max-w-4xl mx-auto p-6">
                <Link to="/gov-directory" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6">
                    <ArrowLeft className="w-4 h-4" />
                    Back to Directory
                </Link>
                <div className="bg-red-50 border border-red-200 rounded-lg p-6 flex items-center gap-3">
                    <AlertCircle className="w-6 h-6 text-red-600" />
                    <p className="text-red-800">{error || 'Agency not found'}</p>
                </div>
            </div>
        )
    }

    return (
        <div className="max-w-5xl mx-auto p-6">
            {/* Header */}
            <div className="mb-6">
                <Link to="/gov-directory" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4">
                    <ArrowLeft className="w-4 h-4" />
                    Back to Directory
                </Link>

                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <h1 className="text-2xl font-bold text-gray-900">{agency.name}</h1>
                            <button
                                onClick={handleTogglePriority}
                                className={`p-1 rounded transition-colors ${agency.is_priority ? 'text-yellow-500' : 'text-gray-400 hover:text-yellow-500'}`}
                                title={agency.is_priority ? 'Remove from priorities' : 'Mark as priority'}
                            >
                                {agency.is_priority ? <Star className="w-5 h-5 fill-current" /> : <StarOff className="w-5 h-5" />}
                            </button>
                        </div>
                        <div className="flex items-center gap-3">
                            {agency.portfolio && (
                                <span className="text-gray-600">{agency.portfolio} Portfolio</span>
                            )}
                            {agency.agency_type && (
                                <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-sm rounded">{agency.agency_type}</span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {agency.website && (
                            <a
                                href={agency.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                            >
                                <Globe className="w-4 h-4" />
                                Website
                                <ExternalLink className="w-3 h-3" />
                            </a>
                        )}
                    </div>
                </div>
            </div>

            {/* Quick Info Cards */}
            <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
                        <Users className="w-4 h-4" />
                        Key People
                    </div>
                    <p className="text-2xl font-bold text-gray-900">{people.length}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
                        <Mail className="w-4 h-4" />
                        Emails Found
                    </div>
                    <p className="text-2xl font-bold text-gray-900">{people.filter(p => p.email).length}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
                        <Linkedin className="w-4 h-4" />
                        LinkedIn Found
                    </div>
                    <p className="text-2xl font-bold text-gray-900">{people.filter(p => p.linkedin_url).length}</p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
                        <Star className="w-4 h-4" />
                        Key Contacts
                    </div>
                    <p className="text-2xl font-bold text-gray-900">{people.filter(p => p.is_key_contact).length}</p>
                </div>
            </div>

            {/* Contact Info */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
                <h2 className="font-semibold text-gray-900 mb-4">Contact Information</h2>
                <div className="grid grid-cols-2 gap-4">
                    {agency.phone && (
                        <div className="flex items-center gap-3">
                            <Phone className="w-5 h-5 text-gray-400" />
                            <span className="text-gray-700">{agency.phone}</span>
                        </div>
                    )}
                    {agency.email && (
                        <div className="flex items-center gap-3">
                            <Mail className="w-5 h-5 text-gray-400" />
                            <a href={`mailto:${agency.email}`} className="text-purple-600 hover:underline">{agency.email}</a>
                        </div>
                    )}
                    {agency.head_office_address && (
                        <div className="flex items-start gap-3 col-span-2">
                            <MapPin className="w-5 h-5 text-gray-400 mt-0.5" />
                            <span className="text-gray-700">{agency.head_office_address}</span>
                        </div>
                    )}
                    {agency.abn && (
                        <div className="flex items-center gap-3">
                            <FileText className="w-5 h-5 text-gray-400" />
                            <span className="text-gray-600">ABN: {agency.abn}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Org Chart Section */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="font-semibold text-gray-900">Organisation Chart</h2>
                    <div className="flex items-center gap-2">
                        {agency.org_chart_url ? (
                            <a
                                href={agency.org_chart_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-purple-600 hover:underline flex items-center gap-1"
                            >
                                View Source <ExternalLink className="w-3 h-3" />
                            </a>
                        ) : (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={handleDiscoverOrgChart}
                                disabled={isDiscoveringOrgChart}
                            >
                                {isDiscoveringOrgChart ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Searching...
                                    </>
                                ) : (
                                    <>
                                        <Search className="w-4 h-4" />
                                        Find Org Chart
                                    </>
                                )}
                            </Button>
                        )}
                        <Button
                            size="sm"
                            onClick={handleScrapePeople}
                            disabled={isScrapingPeople || !agency.website}
                        >
                            {isScrapingPeople ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Extracting...
                                </>
                            ) : (
                                <>
                                    <RefreshCw className="w-4 h-4" />
                                    Extract People
                                </>
                            )}
                        </Button>
                    </div>
                </div>

                {/* Search people */}
                <div className="relative mb-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search people by name, title, or division..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    />
                </div>

                {/* People List */}
                {people.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                        <p>No key people extracted yet</p>
                        <p className="text-sm mt-1">
                            {agency.org_chart_url
                                ? 'Click "Extract People" to scan the org chart'
                                : 'First, find the org chart page, then extract people'}
                        </p>
                    </div>
                ) : filteredPeople ? (
                    // Flat list when searching
                    <div className="space-y-2">
                        {filteredPeople.map(person => (
                            <PersonCard key={person.id} person={person} />
                        ))}
                        {filteredPeople.length === 0 && (
                            <p className="text-gray-500 text-center py-4">No people match your search</p>
                        )}
                    </div>
                ) : (
                    // Grouped by seniority
                    <div className="space-y-4">
                        {Object.entries(groupedPeople)
                            .sort(([a], [b]) => Number(a) - Number(b))
                            .map(([level, levelPeople]) => (
                                <div key={level}>
                                    <button
                                        onClick={() => {
                                            const newExpanded = new Set(expandedSections)
                                            if (newExpanded.has(Number(level))) {
                                                newExpanded.delete(Number(level))
                                            } else {
                                                newExpanded.add(Number(level))
                                            }
                                            setExpandedSections(newExpanded)
                                        }}
                                        className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2 hover:text-gray-900"
                                    >
                                        {expandedSections.has(Number(level)) ? (
                                            <ChevronDown className="w-4 h-4" />
                                        ) : (
                                            <ChevronRight className="w-4 h-4" />
                                        )}
                                        {seniorityLabels[Number(level)] || `Level ${level}`}
                                        <span className="text-gray-400">({levelPeople.length})</span>
                                    </button>
                                    {expandedSections.has(Number(level)) && (
                                        <div className="space-y-2 ml-6">
                                            {levelPeople.map(person => (
                                                <PersonCard key={person.id} person={person} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                    </div>
                )}
            </div>

            {/* Notes */}
            {agency.notes && (
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <h2 className="font-semibold text-gray-900 mb-4">Notes</h2>
                    <p className="text-gray-700 whitespace-pre-wrap">{agency.notes}</p>
                </div>
            )}
        </div>
    )
}

// Person Card Component
function PersonCard({ person }: { person: GovPerson }) {
    return (
        <div className="flex items-start gap-4 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
            {/* Photo or placeholder */}
            <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                {person.photo_url ? (
                    <img src={person.photo_url} alt={person.name} className="w-full h-full object-cover" />
                ) : (
                    <User className="w-6 h-6 text-purple-600" />
                )}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <h4 className="font-medium text-gray-900">{person.name}</h4>
                    {person.is_key_contact && (
                        <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                    )}
                </div>
                {person.title && (
                    <p className="text-sm text-gray-600">{person.title}</p>
                )}
                {person.division && (
                    <p className="text-xs text-gray-500">{person.division}</p>
                )}
            </div>

            {/* Contact links */}
            <div className="flex items-center gap-2">
                {person.email && (
                    <a
                        href={`mailto:${person.email}`}
                        className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg"
                        title={person.email}
                    >
                        <Mail className="w-4 h-4" />
                    </a>
                )}
                {person.phone && (
                    <a
                        href={`tel:${person.phone}`}
                        className="p-2 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg"
                        title={person.phone}
                    >
                        <Phone className="w-4 h-4" />
                    </a>
                )}
                {person.linkedin_url && (
                    <a
                        href={person.linkedin_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="View LinkedIn"
                    >
                        <Linkedin className="w-4 h-4" />
                    </a>
                )}
            </div>
        </div>
    )
}
