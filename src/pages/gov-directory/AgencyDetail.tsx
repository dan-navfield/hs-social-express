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
    Trash2,
    X,
    CheckCircle2,
    Sparkles
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
    logs: string[]
    showLogs: boolean
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

// Apollo.io API key for people enrichment
const apolloApiKey = 'VGUWDBzc5jkJc0xQmvK56A'

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
    const [showEnrichmentModal, setShowEnrichmentModal] = useState(false)
    const [isEnrichingPeople, setIsEnrichingPeople] = useState(false)
    const [enrichmentProgress, setEnrichmentProgress] = useState<{
        current: number
        total: number
        found: number
        currentName: string
        log: Array<{ name: string; status: 'pending' | 'found' | 'not_found'; email?: string; phone?: string }>
    } | null>(null)
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

    const handleDeletePerson = async (personId: string) => {
        if (!confirm('Delete this person?')) return

        const { error } = await supabase
            .from('gov_agency_people')
            .delete()
            .eq('id', personId)

        if (error) {
            alert('Failed to delete: ' + error.message)
        } else {
            setPeople(prev => prev.filter(p => p.id !== personId))
        }
    }

    const startEnrichment = () => {
        const peopleToEnrich = people.filter(p => !p.email)
        if (peopleToEnrich.length === 0) {
            alert('All people already have email addresses!')
            return
        }

        // Initialize the log with all people as pending
        setEnrichmentProgress({
            current: 0,
            total: peopleToEnrich.length,
            found: 0,
            currentName: '',
            log: peopleToEnrich.map(p => ({ name: p.name, status: 'pending' as const }))
        })
        setShowEnrichmentModal(true)
    }

    const handleEnrichWithApollo = async () => {
        if (!agency) return

        // Only enrich people without email
        const peopleToEnrich = people.filter(p => !p.email)

        setIsEnrichingPeople(true)

        // Get domain from agency website
        let domain = ''
        if (agency.website) {
            try {
                const url = new URL(agency.website.startsWith('http') ? agency.website : `https://${agency.website}`)
                domain = url.hostname.replace('www.', '')
            } catch { /* ignore */ }
        }

        let foundCount = 0

        for (let i = 0; i < peopleToEnrich.length; i++) {
            const person = peopleToEnrich[i]

            setEnrichmentProgress(prev => prev ? {
                ...prev,
                current: i + 1,
                currentName: person.name
            } : null)

            try {
                // Split name into first/last
                const nameParts = person.name.trim().split(' ')
                const firstName = nameParts[0]
                const lastName = nameParts.slice(1).join(' ') || nameParts[0]

                console.log(`Apollo: Searching for ${firstName} ${lastName} at ${agency.name}`)

                // Step 1: Search for the person to get their Apollo ID
                const searchResponse = await fetch('https://api.apollo.io/v1/mixed_people/search', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache',
                        'X-Api-Key': apolloApiKey
                    },
                    body: JSON.stringify({
                        q_organization_domains: domain || undefined,
                        q_organization_name: agency.name,
                        person_titles: [person.title || ''],
                        q_keywords: `${firstName} ${lastName}`,
                        page: 1,
                        per_page: 5
                    })
                })

                if (!searchResponse.ok) {
                    console.error('Apollo search failed:', await searchResponse.text())
                    throw new Error('Search failed')
                }

                const searchData = await searchResponse.json()
                console.log(`Apollo search results:`, searchData.people?.length || 0, 'matches')

                // Find best match from search results
                const matchedPerson = searchData.people?.find((p: { first_name?: string; last_name?: string }) =>
                    p.first_name?.toLowerCase() === firstName.toLowerCase() ||
                    p.last_name?.toLowerCase() === lastName.toLowerCase()
                ) || searchData.people?.[0]

                if (!matchedPerson?.id) {
                    console.log('No match found in Apollo search')
                    throw new Error('No match')
                }

                console.log(`Apollo: Found match with ID ${matchedPerson.id}`)

                // Step 2: Enrich by ID to get contact details
                const response = await fetch('https://api.apollo.io/v1/people/match', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache',
                        'X-Api-Key': apolloApiKey
                    },
                    body: JSON.stringify({
                        id: matchedPerson.id,
                        reveal_personal_emails: true,
                        reveal_phone_number: true
                    })
                })

                if (response.ok) {
                    const data = await response.json()
                    console.log('Apollo enrichment response:', data.person ? 'Found' : 'Not found')

                    if (data.person) {
                        const apolloPerson = data.person

                        // Update database with enriched data
                        const updates: Record<string, string | null> = {}
                        if (apolloPerson.email) updates.email = apolloPerson.email

                        // Get phone - prioritize mobile over other types
                        if (apolloPerson.phone_numbers?.length > 0) {
                            const mobilePhone = apolloPerson.phone_numbers.find(
                                (p: { type?: string }) => p.type === 'mobile'
                            )
                            const phone = mobilePhone || apolloPerson.phone_numbers[0]
                            if (phone?.sanitized_number) {
                                updates.phone = phone.sanitized_number
                            }
                        }

                        if (apolloPerson.linkedin_url) updates.linkedin_url = apolloPerson.linkedin_url
                        if (apolloPerson.photo_url) updates.photo_url = apolloPerson.photo_url

                        if (Object.keys(updates).length > 0) {
                            foundCount++

                            await supabase
                                .from('gov_agency_people')
                                .update(updates)
                                .eq('id', person.id)

                            // Update local state
                            setPeople(prev => prev.map(p =>
                                p.id === person.id ? { ...p, ...updates } : p
                            ))

                            // Update log with found status
                            setEnrichmentProgress(prev => prev ? {
                                ...prev,
                                found: foundCount,
                                log: prev.log.map(l =>
                                    l.name === person.name
                                        ? { ...l, status: 'found' as const, email: updates.email || undefined, phone: updates.phone || undefined }
                                        : l
                                )
                            } : null)
                        } else {
                            // No data found
                            setEnrichmentProgress(prev => prev ? {
                                ...prev,
                                log: prev.log.map(l =>
                                    l.name === person.name ? { ...l, status: 'not_found' as const } : l
                                )
                            } : null)
                        }
                    } else {
                        // No match in Apollo
                        setEnrichmentProgress(prev => prev ? {
                            ...prev,
                            log: prev.log.map(l =>
                                l.name === person.name ? { ...l, status: 'not_found' as const } : l
                            )
                        } : null)
                    }
                } else {
                    console.error('Apollo API error:', await response.text())
                    setEnrichmentProgress(prev => prev ? {
                        ...prev,
                        log: prev.log.map(l =>
                            l.name === person.name ? { ...l, status: 'not_found' as const } : l
                        )
                    } : null)
                }
            } catch (err) {
                console.error(`Failed to enrich ${person.name}:`, err)
                setEnrichmentProgress(prev => prev ? {
                    ...prev,
                    log: prev.log.map(l =>
                        l.name === person.name ? { ...l, status: 'not_found' as const } : l
                    )
                } : null)
            }

            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 500))
        }

        setIsEnrichingPeople(false)
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

        // Use stored Gemini API key
        const geminiKey = 'AIzaSyDr6HkapIzd48mUc6-kYUpS65ZN5D83fBw'

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
            const runId = data.data.id

            // Set initial progress
            setExtractionProgress({
                runId,
                status: 'RUNNING',
                startedAt: new Date().toISOString(),
                pagesProcessed: 0,
                peopleFound: 0,
                elapsedSeconds: 0,
                logs: ['Starting extraction...'],
                showLogs: false
            })

            // Poll for status and log updates
            const startTime = Date.now()
            const pollInterval = setInterval(async () => {
                try {
                    // Fetch run status
                    const statusResponse = await fetch(
                        `https://api.apify.com/v2/actor-runs/${runId}?token=${apifyToken}`
                    )

                    // Fetch logs using direct run endpoint
                    let logLines: string[] = []
                    let logError: string | null = null
                    try {
                        const logUrl = `https://api.apify.com/v2/actor-runs/${runId}/log?token=${apifyToken}`
                        const logResponse = await fetch(logUrl)

                        if (logResponse.ok) {
                            const logText = await logResponse.text()
                            // Just split into lines and take last 50 - show raw logs
                            logLines = logText.split('\n')
                                .filter(line => line.trim())
                                .slice(-50)
                        } else {
                            logError = `Log fetch failed: ${logResponse.status}`
                        }
                    } catch (logErr) {
                        logError = `Log fetch error: ${logErr}`
                    }

                    if (statusResponse.ok) {
                        const statusData = await statusResponse.json()
                        const run = statusData.data

                        setExtractionProgress(prev => ({
                            runId,
                            status: run.status,
                            startedAt: run.startedAt,
                            pagesProcessed: run.stats?.requestsFinished || 0,
                            peopleFound: people.length,
                            elapsedSeconds: Math.floor((Date.now() - startTime) / 1000),
                            logs: logLines.length > 0 ? logLines : (logError ? [logError] : (prev?.logs || ['Fetching logs...'])),
                            showLogs: prev?.showLogs ?? true // Default to open
                        }))

                        // Stop polling when run is complete
                        if (run.status === 'SUCCEEDED' || run.status === 'FAILED' || run.status === 'ABORTED') {
                            clearInterval(pollInterval)
                            setIsScrapingPeople(false)

                            // Refresh data
                            setTimeout(() => {
                                fetchAgencyDetails()
                            }, 2000)
                        }
                    }
                } catch (err) {
                    console.error('Failed to poll status:', err)
                }
            }, 2000) // Poll every 2 seconds

        } catch (err) {
            console.error('Failed to start extraction:', err)
            alert(`Failed to start extraction: ${err}`)
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
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={startEnrichment}
                            disabled={isEnrichingPeople || people.length === 0}
                            title="Enrich people with Apollo.io to find emails, phones, and LinkedIn"
                        >
                            <Sparkles className="w-4 h-4" />
                            Enrich (Apollo)
                        </Button>
                    </div>
                </div>

                {/* Extraction Progress Panel */}
                {extractionProgress && (
                    <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4 mb-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                {extractionProgress.status === 'RUNNING' ? (
                                    <Loader2 className="w-5 h-5 text-purple-600 animate-spin" />
                                ) : extractionProgress.status === 'SUCCEEDED' ? (
                                    <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                                        <span className="text-white text-xs">✓</span>
                                    </div>
                                ) : (
                                    <AlertCircle className="w-5 h-5 text-red-500" />
                                )}
                                <span className="font-medium text-gray-900">
                                    {extractionProgress.status === 'RUNNING' ? 'Extracting People...' :
                                        extractionProgress.status === 'SUCCEEDED' ? 'Extraction Complete!' :
                                            'Extraction ' + extractionProgress.status}
                                </span>
                            </div>
                            <a
                                href={`https://console.apify.com/view/runs/${extractionProgress.runId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-purple-600 hover:underline flex items-center gap-1"
                            >
                                View in Apify <ExternalLink className="w-3 h-3" />
                            </a>
                        </div>

                        <div className="grid grid-cols-3 gap-4 text-sm">
                            <div className="bg-white/50 rounded-lg p-3">
                                <div className="text-gray-500 mb-1">Status</div>
                                <div className="font-semibold text-gray-900">{extractionProgress.status}</div>
                            </div>
                            <div className="bg-white/50 rounded-lg p-3">
                                <div className="text-gray-500 mb-1">Elapsed Time</div>
                                <div className="font-semibold text-gray-900">
                                    {Math.floor(extractionProgress.elapsedSeconds / 60)}m {extractionProgress.elapsedSeconds % 60}s
                                </div>
                            </div>
                            <div className="bg-white/50 rounded-lg p-3">
                                <div className="text-gray-500 mb-1">Pages Processed</div>
                                <div className="font-semibold text-gray-900">{extractionProgress.pagesProcessed}</div>
                            </div>
                        </div>

                        {extractionProgress.status === 'SUCCEEDED' && (
                            <div className="mt-3 text-sm text-green-700 bg-green-100 rounded-lg p-2 text-center">
                                ✓ Extracted data saved. Refreshing...
                            </div>
                        )}

                        {/* Expandable Log Panel */}
                        <div className="mt-3">
                            <button
                                onClick={() => setExtractionProgress(prev => prev ? { ...prev, showLogs: !prev.showLogs } : null)}
                                className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                            >
                                <span className={`transform transition-transform ${extractionProgress.showLogs ? 'rotate-180' : ''}`}>
                                    ▼
                                </span>
                                <span>Live Crawl Log ({extractionProgress.logs.length} lines)</span>
                            </button>

                            {extractionProgress.showLogs && (
                                <div className="mt-2 bg-gray-900 rounded-lg p-3 max-h-80 overflow-y-auto font-mono text-xs leading-relaxed">
                                    {extractionProgress.logs.map((line, i) => (
                                        <div
                                            key={i}
                                            className={`py-0.5 whitespace-pre-wrap break-all ${line.includes('ERROR') ? 'text-red-400' :
                                                line.includes('WARN') ? 'text-yellow-400' :
                                                    line.includes('INFO') ? 'text-green-300' :
                                                        'text-gray-300'
                                                }`}
                                        >
                                            {line}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

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
                            <PersonCard key={person.id} person={person} onDelete={handleDeletePerson} />
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
                                                <PersonCard key={person.id} person={person} onDelete={handleDeletePerson} />
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

            {/* Apollo Enrichment Modal */}
            {showEnrichmentModal && enrichmentProgress && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
                        {/* Modal Header */}
                        <div className="flex items-center justify-between p-4 border-b">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-purple-600" />
                                <h3 className="font-semibold text-lg">Apollo.io Enrichment</h3>
                            </div>
                            {!isEnrichingPeople && (
                                <button
                                    onClick={() => {
                                        setShowEnrichmentModal(false)
                                        setEnrichmentProgress(null)
                                    }}
                                    className="p-1 hover:bg-gray-100 rounded"
                                >
                                    <X className="w-5 h-5 text-gray-500" />
                                </button>
                            )}
                        </div>

                        {/* Modal Body */}
                        <div className="p-4 flex-1 overflow-y-auto">
                            {/* Progress Stats */}
                            <div className="grid grid-cols-3 gap-4 mb-4">
                                <div className="bg-gray-50 rounded-lg p-3 text-center">
                                    <p className="text-2xl font-bold text-gray-900">
                                        {enrichmentProgress.current}/{enrichmentProgress.total}
                                    </p>
                                    <p className="text-xs text-gray-500">Processed</p>
                                </div>
                                <div className="bg-green-50 rounded-lg p-3 text-center">
                                    <p className="text-2xl font-bold text-green-600">{enrichmentProgress.found}</p>
                                    <p className="text-xs text-gray-500">Found</p>
                                </div>
                                <div className="bg-gray-50 rounded-lg p-3 text-center">
                                    <p className="text-2xl font-bold text-gray-400">
                                        {enrichmentProgress.current - enrichmentProgress.found}
                                    </p>
                                    <p className="text-xs text-gray-500">Not Found</p>
                                </div>
                            </div>

                            {/* Current processing */}
                            {isEnrichingPeople && enrichmentProgress.currentName && (
                                <div className="mb-4 p-3 bg-purple-50 rounded-lg flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 text-purple-600 animate-spin" />
                                    <span className="text-sm text-purple-700">
                                        Searching for <strong>{enrichmentProgress.currentName}</strong>...
                                    </span>
                                </div>
                            )}

                            {/* Log list */}
                            <div className="space-y-2">
                                {enrichmentProgress.log.map((entry, i) => (
                                    <div
                                        key={i}
                                        className={`flex items-center justify-between p-2 rounded-lg text-sm ${entry.status === 'found' ? 'bg-green-50' :
                                            entry.status === 'not_found' ? 'bg-gray-50' :
                                                'bg-white border border-gray-200'
                                            }`}
                                    >
                                        <div className="flex items-center gap-2">
                                            {entry.status === 'pending' && (
                                                <div className="w-4 h-4 rounded-full border-2 border-gray-300" />
                                            )}
                                            {entry.status === 'found' && (
                                                <CheckCircle2 className="w-4 h-4 text-green-600" />
                                            )}
                                            {entry.status === 'not_found' && (
                                                <X className="w-4 h-4 text-gray-400" />
                                            )}
                                            <span className={entry.status === 'not_found' ? 'text-gray-400' : ''}>
                                                {entry.name}
                                            </span>
                                        </div>
                                        {entry.status === 'found' && (
                                            <div className="flex items-center gap-3 text-xs text-gray-500">
                                                {entry.email && (
                                                    <span className="flex items-center gap-1">
                                                        <Mail className="w-3 h-3" />
                                                        {entry.email.split('@')[0]}@...
                                                    </span>
                                                )}
                                                {entry.phone && (
                                                    <span className="flex items-center gap-1">
                                                        <Phone className="w-3 h-3" />
                                                        ✓
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="p-4 border-t bg-gray-50">
                            {!isEnrichingPeople ? (
                                enrichmentProgress.current === 0 ? (
                                    <div className="flex gap-3">
                                        <Button
                                            variant="secondary"
                                            className="flex-1"
                                            onClick={() => {
                                                setShowEnrichmentModal(false)
                                                setEnrichmentProgress(null)
                                            }}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            className="flex-1"
                                            onClick={handleEnrichWithApollo}
                                        >
                                            <Sparkles className="w-4 h-4" />
                                            Start Enriching ({enrichmentProgress.total} people)
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="text-center">
                                        <p className="text-green-600 font-medium mb-2">
                                            ✓ Enrichment Complete
                                        </p>
                                        <p className="text-sm text-gray-500 mb-3">
                                            Found data for {enrichmentProgress.found} of {enrichmentProgress.total} people
                                        </p>
                                        <Button
                                            onClick={() => {
                                                setShowEnrichmentModal(false)
                                                setEnrichmentProgress(null)
                                            }}
                                        >
                                            Done
                                        </Button>
                                    </div>
                                )
                            ) : (
                                <div className="flex items-center justify-center gap-2 text-gray-500">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span>Enriching... {enrichmentProgress.current}/{enrichmentProgress.total}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// Person Card Component
function PersonCard({ person, onDelete }: { person: GovPerson; onDelete?: (id: string) => void }) {
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
                {onDelete && (
                    <button
                        onClick={() => onDelete(person.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete person"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                )}
            </div>
        </div>
    )
}
