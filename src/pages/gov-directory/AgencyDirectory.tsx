import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
    ArrowLeft,
    Search,
    Building2,
    Users,
    RefreshCw,
    Filter,
    ChevronDown,
    ExternalLink,
    Star,
    Loader2,
    Globe,
    Phone,
    Mail
} from 'lucide-react'
import { Button } from '@/components/ui'
import { useSpaceStore } from '@/stores/spaceStore'
import { supabase } from '@/lib/supabase'

interface GovAgency {
    id: string
    name: string
    short_name: string | null
    acronym: string | null
    website: string | null
    agency_type: string | null
    portfolio: string | null
    phone: string | null
    email: string | null
    org_chart_status: string
    is_priority: boolean
    people_count?: number
    last_synced_at: string | null
}

export function AgencyDirectory() {
    const navigate = useNavigate()
    const { currentSpace } = useSpaceStore()
    const [agencies, setAgencies] = useState<GovAgency[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [filterType, setFilterType] = useState<string>('all')
    const [filterPortfolio, setFilterPortfolio] = useState<string>('all')
    const [showFilters, setShowFilters] = useState(false)
    const [isSyncing, setIsSyncing] = useState(false)

    // Get unique portfolios and types for filters
    const portfolios = [...new Set(agencies.map(a => a.portfolio).filter((p): p is string => Boolean(p)))]
    const types = [...new Set(agencies.map(a => a.agency_type).filter((t): t is string => Boolean(t)))]

    useEffect(() => {
        if (currentSpace?.id) {
            fetchAgencies()
        }
    }, [currentSpace?.id])

    const fetchAgencies = async () => {
        if (!currentSpace?.id) return

        setIsLoading(true)
        try {
            // Get agencies with people count
            const { data, error } = await supabase
                .from('gov_agencies')
                .select(`
                    *,
                    gov_agency_people(count)
                `)
                .eq('space_id', currentSpace.id)
                .order('name')

            if (error) throw error

            const agenciesWithCount = (data || []).map(agency => ({
                ...agency,
                people_count: agency.gov_agency_people?.[0]?.count || 0
            }))

            setAgencies(agenciesWithCount)
        } catch (err) {
            console.error('Failed to fetch agencies:', err)
        } finally {
            setIsLoading(false)
        }
    }

    const handleSyncDirectory = async () => {
        if (!currentSpace?.id) return

        setIsSyncing(true)

        try {
            // Get Apify token from localStorage or prompt
            const apifyToken = localStorage.getItem('apify_token') || prompt('Enter your Apify API token:')
            if (!apifyToken) {
                alert('Apify token required to sync directory')
                setIsSyncing(false)
                return
            }
            localStorage.setItem('apify_token', apifyToken)

            // Trigger the Apify actor
            const response = await fetch(`https://api.apify.com/v2/acts/verifiable_hare~gov-directory-scraper/runs?token=${apifyToken}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    timeout: 1800, // 30 minutes
                    memoryMbytes: 2048,
                    webhookUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gov-directory-sync`,
                    spaceId: currentSpace.id,
                    maxAgencies: 500
                })
            })

            if (!response.ok) {
                throw new Error(`Apify error: ${await response.text()}`)
            }

            const result = await response.json()
            console.log('Gov directory scraper started:', result)

            alert(`Directory sync started! Run ID: ${result.data?.id}\nThis will take a few minutes. Refresh to see new agencies.`)

            // Poll for completion and refresh
            setTimeout(() => {
                fetchAgencies()
                setIsSyncing(false)
            }, 60000) // Check after 1 minute

        } catch (error) {
            console.error('Failed to start sync:', error)
            alert(`Failed to start sync: ${error}`)
            setIsSyncing(false)
        }
    }

    // Filter agencies
    const filteredAgencies = agencies.filter(agency => {
        const matchesSearch = !searchQuery ||
            agency.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            agency.acronym?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            agency.portfolio?.toLowerCase().includes(searchQuery.toLowerCase())

        const matchesType = filterType === 'all' || agency.agency_type === filterType
        const matchesPortfolio = filterPortfolio === 'all' || agency.portfolio === filterPortfolio

        return matchesSearch && matchesType && matchesPortfolio
    })

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'scraped':
                return <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">Synced</span>
            case 'found':
                return <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">Org Chart Found</span>
            case 'error':
                return <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">Error</span>
            case 'not_found':
                return <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">No Org Chart</span>
            default:
                return <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded-full">Pending</span>
        }
    }

    return (
        <div className="max-w-6xl mx-auto p-6">
            {/* Header */}
            <div className="mb-6">
                <Link to="/dashboard" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4">
                    <ArrowLeft className="w-4 h-4" />
                    Back to Dashboard
                </Link>

                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Government Agency Directory</h1>
                        <p className="text-gray-600 mt-1">
                            {agencies.length} federal agencies • {agencies.reduce((sum, a) => sum + (a.people_count || 0), 0)} key people identified
                        </p>
                    </div>

                    <Button
                        onClick={handleSyncDirectory}
                        disabled={isSyncing}
                    >
                        {isSyncing ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Syncing...
                            </>
                        ) : (
                            <>
                                <RefreshCw className="w-4 h-4" />
                                Sync Directory
                            </>
                        )}
                    </Button>
                </div>
            </div>

            {/* Search & Filters */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
                <div className="flex items-center gap-4">
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search agencies by name, acronym, or portfolio..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        />
                    </div>

                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`flex items-center gap-2 px-4 py-2 border rounded-lg transition-colors ${showFilters ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-gray-300 hover:bg-gray-50'
                            }`}
                    >
                        <Filter className="w-4 h-4" />
                        Filters
                        <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                    </button>
                </div>

                {/* Expanded Filters */}
                {showFilters && (
                    <div className="mt-4 pt-4 border-t border-gray-200 grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Agency Type</label>
                            <select
                                value={filterType}
                                onChange={(e) => setFilterType(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                            >
                                <option value="all">All Types</option>
                                {types.map(type => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Portfolio</label>
                            <select
                                value={filterPortfolio}
                                onChange={(e) => setFilterPortfolio(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                            >
                                <option value="all">All Portfolios</option>
                                {portfolios.map(portfolio => (
                                    <option key={portfolio} value={portfolio}>{portfolio}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                )}
            </div>

            {/* Loading State */}
            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
                </div>
            ) : filteredAgencies.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                    <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No agencies found</h3>
                    <p className="text-gray-600 mb-4">
                        {agencies.length === 0
                            ? 'Click "Sync Directory" to import agencies from directory.gov.au'
                            : 'Try adjusting your search or filters'}
                    </p>
                    {agencies.length === 0 && (
                        <Button onClick={handleSyncDirectory}>
                            <RefreshCw className="w-4 h-4" />
                            Sync Directory
                        </Button>
                    )}
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredAgencies.map(agency => (
                        <div
                            key={agency.id}
                            className="bg-white rounded-xl border border-gray-200 p-4 hover:border-purple-300 hover:shadow-sm transition-all cursor-pointer"
                            onClick={() => navigate(`/gov-directory/${agency.id}`)}
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        {agency.is_priority && (
                                            <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                                        )}
                                        <h3 className="font-semibold text-gray-900">
                                            {agency.name}
                                            {agency.acronym && (
                                                <span className="text-gray-500 font-normal ml-2">({agency.acronym})</span>
                                            )}
                                        </h3>
                                    </div>

                                    <div className="flex items-center gap-4 text-sm text-gray-600">
                                        {agency.portfolio && (
                                            <span>{agency.portfolio} Portfolio</span>
                                        )}
                                        {agency.agency_type && (
                                            <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{agency.agency_type}</span>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-4 mt-2 text-sm">
                                        {agency.website && (
                                            <a
                                                href={agency.website}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-1 text-purple-600 hover:underline"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <Globe className="w-3 h-3" />
                                                Website
                                            </a>
                                        )}
                                        {agency.phone && (
                                            <span className="flex items-center gap-1 text-gray-600">
                                                <Phone className="w-3 h-3" />
                                                {agency.phone}
                                            </span>
                                        )}
                                        {agency.email && (
                                            <a
                                                href={`mailto:${agency.email}`}
                                                className="flex items-center gap-1 text-purple-600 hover:underline"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <Mail className="w-3 h-3" />
                                                {agency.email}
                                            </a>
                                        )}
                                    </div>
                                </div>

                                <div className="flex flex-col items-end gap-2">
                                    {getStatusBadge(agency.org_chart_status)}
                                    <div className="flex items-center gap-1 text-sm text-gray-600">
                                        <Users className="w-4 h-4" />
                                        {agency.people_count || 0} people
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
