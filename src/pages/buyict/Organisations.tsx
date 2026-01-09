/**
 * BuyICT Organisations Page
 * 
 * Catalog of organisations extracted from BuyICT opportunities.
 * Shows org stats, contacts, and analysis.
 */

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Building2,
    Mail,
    FileText,
    TrendingUp,
    MapPin,
    Star,
    BarChart3,
    Users,
    ArrowUpDown,
    Search,
    Filter,
    ChevronRight,
    ExternalLink,
    Loader2,
    RefreshCw
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
    opportunity_count: number
    open_opportunity_count: number
    first_opportunity_date: string | null
    last_opportunity_date: string | null
    common_categories: string[]
    common_modules: string[]
    common_locations: string[]
    is_target: boolean
    priority: 'low' | 'normal' | 'high' | 'critical'
    ai_summary: string | null
    notes: string | null
}

type SortField = 'name' | 'opportunity_count' | 'last_opportunity_date' | 'open_opportunity_count'
type SortOrder = 'asc' | 'desc'

export default function Organisations() {
    const navigate = useNavigate()
    const { currentSpace } = useSpaceStore()
    const [organisations, setOrganisations] = useState<Organisation[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState('')
    const [sortField, setSortField] = useState<SortField>('opportunity_count')
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
    const [filterTargetsOnly, setFilterTargetsOnly] = useState(false)
    const [isRefreshing, setIsRefreshing] = useState(false)

    useEffect(() => {
        if (currentSpace?.id) {
            fetchOrganisations()
        }
    }, [currentSpace?.id])

    const fetchOrganisations = async () => {
        if (!currentSpace?.id) return

        try {
            const { data, error } = await supabase
                .from('buyict_organisations')
                .select('*')
                .eq('space_id', currentSpace.id)
                .order(sortField, { ascending: sortOrder === 'asc' })

            if (error) throw error
            setOrganisations(data || [])
        } catch (err) {
            console.error('Error fetching organisations:', err)
        } finally {
            setIsLoading(false)
        }
    }

    const refreshOrganisations = async () => {
        if (!currentSpace?.id) return
        setIsRefreshing(true)

        try {
            // Call a function to rebuild org data from opportunities
            const { error } = await supabase.rpc('rebuild_organisations_from_opportunities', {
                p_space_id: currentSpace.id
            })

            if (error) {
                console.error('Rebuild error:', error)
            }

            await fetchOrganisations()
        } catch (err) {
            console.error('Error refreshing:', err)
        } finally {
            setIsRefreshing(false)
        }
    }

    const toggleTarget = async (orgId: string, currentValue: boolean) => {
        try {
            const { error } = await supabase
                .from('buyict_organisations')
                .update({ is_target: !currentValue })
                .eq('id', orgId)

            if (!error) {
                setOrganisations(orgs =>
                    orgs.map(o => o.id === orgId ? { ...o, is_target: !currentValue } : o)
                )
            }
        } catch (err) {
            console.error('Error toggling target:', err)
        }
    }

    const handleSort = (field: SortField) => {
        if (field === sortField) {
            setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
        } else {
            setSortField(field)
            setSortOrder('desc')
        }
    }

    // Filter and sort organisations
    const filteredOrgs = organisations
        .filter(org => {
            const matchesSearch = org.name.toLowerCase().includes(searchTerm.toLowerCase())
            const matchesTarget = filterTargetsOnly ? org.is_target : true
            return matchesSearch && matchesTarget
        })
        .sort((a, b) => {
            let comparison = 0
            switch (sortField) {
                case 'name':
                    comparison = a.name.localeCompare(b.name)
                    break
                case 'opportunity_count':
                    comparison = a.opportunity_count - b.opportunity_count
                    break
                case 'open_opportunity_count':
                    comparison = a.open_opportunity_count - b.open_opportunity_count
                    break
                case 'last_opportunity_date':
                    comparison = new Date(a.last_opportunity_date || 0).getTime() -
                        new Date(b.last_opportunity_date || 0).getTime()
                    break
            }
            return sortOrder === 'asc' ? comparison : -comparison
        })

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'critical': return 'text-red-600 bg-red-50'
            case 'high': return 'text-orange-600 bg-orange-50'
            case 'low': return 'text-gray-500 bg-gray-50'
            default: return 'text-blue-600 bg-blue-50'
        }
    }

    if (isLoading) {
        return (
            <div className="p-8 flex items-center justify-center min-h-[400px]">
                <div className="flex items-center gap-3 text-gray-500">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Loading organisations...</span>
                </div>
            </div>
        )
    }

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Organisations</h1>
                    <p className="text-gray-500 mt-1">
                        {organisations.length} organisations from BuyICT opportunities
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Button
                        variant="secondary"
                        onClick={refreshOrganisations}
                        disabled={isRefreshing}
                        className="flex items-center gap-2"
                    >
                        <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                        Refresh from Opps
                    </Button>
                </div>
            </div>

            {/* Filters & Search */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
                <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex-1 min-w-[200px]">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <Input
                                type="text"
                                placeholder="Search organisations..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant={filterTargetsOnly ? 'primary' : 'secondary'}
                            onClick={() => setFilterTargetsOnly(!filterTargetsOnly)}
                            className="flex items-center gap-2"
                        >
                            <Star className="w-4 h-4" />
                            Targets Only
                        </Button>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500">Sort by:</span>
                        <select
                            value={sortField}
                            onChange={(e) => handleSort(e.target.value as SortField)}
                            className="text-sm border rounded-lg px-3 py-2"
                        >
                            <option value="opportunity_count">Total Opportunities</option>
                            <option value="open_opportunity_count">Open Opportunities</option>
                            <option value="last_opportunity_date">Last Activity</option>
                            <option value="name">Name</option>
                        </select>
                        <button
                            onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                            className="p-2 hover:bg-gray-100 rounded-lg"
                        >
                            <ArrowUpDown className="w-4 h-4 text-gray-500" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-100 rounded-lg">
                            <Building2 className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">{organisations.length}</p>
                            <p className="text-sm text-gray-500">Total Orgs</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-100 rounded-lg">
                            <Star className="w-5 h-5 text-amber-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">
                                {organisations.filter(o => o.is_target).length}
                            </p>
                            <p className="text-sm text-gray-500">Target Orgs</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-green-100 rounded-lg">
                            <FileText className="w-5 h-5 text-green-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">
                                {organisations.reduce((sum, o) => sum + o.open_opportunity_count, 0)}
                            </p>
                            <p className="text-sm text-gray-500">Open Opps</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 rounded-lg">
                            <Mail className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold">
                                {organisations.reduce((sum, o) => sum + (o.contact_emails?.length || 0), 0)}
                            </p>
                            <p className="text-sm text-gray-500">Contacts</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Organisations List */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Organisation
                            </th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Opportunities
                            </th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Open
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Last Activity
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Top Areas
                            </th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Contacts
                            </th>
                            <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Target
                            </th>
                            <th className="px-4 py-3"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {filteredOrgs.length === 0 ? (
                            <tr>
                                <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                                    {organisations.length === 0 ? (
                                        <div className="space-y-2">
                                            <Building2 className="w-12 h-12 mx-auto text-gray-300" />
                                            <p>No organisations found</p>
                                            <p className="text-sm">Sync opportunities to see organisations</p>
                                        </div>
                                    ) : (
                                        <p>No organisations match your filters</p>
                                    )}
                                </td>
                            </tr>
                        ) : (
                            filteredOrgs.map(org => (
                                <tr
                                    key={org.id}
                                    className="hover:bg-gray-50 cursor-pointer"
                                    onClick={() => navigate(`/buyict/organisation/${org.id}`)}
                                >
                                    <td className="px-4 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-gray-100 rounded-lg">
                                                <Building2 className="w-5 h-5 text-gray-600" />
                                            </div>
                                            <div>
                                                <p className="font-medium text-gray-900">{org.name}</p>
                                                {org.portfolio && (
                                                    <p className="text-sm text-gray-500">{org.portfolio}</p>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-4 text-center">
                                        <span className="text-lg font-semibold text-gray-900">
                                            {org.opportunity_count}
                                        </span>
                                    </td>
                                    <td className="px-4 py-4 text-center">
                                        {org.open_opportunity_count > 0 ? (
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                {org.open_opportunity_count} open
                                            </span>
                                        ) : (
                                            <span className="text-gray-400">-</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-4">
                                        {org.last_opportunity_date ? (
                                            <span className="text-sm text-gray-600">
                                                {new Date(org.last_opportunity_date).toLocaleDateString()}
                                            </span>
                                        ) : (
                                            <span className="text-gray-400">-</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-4">
                                        <div className="flex flex-wrap gap-1">
                                            {(org.common_categories || []).slice(0, 2).map((cat, i) => (
                                                <span
                                                    key={i}
                                                    className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600"
                                                >
                                                    {cat}
                                                </span>
                                            ))}
                                            {(org.common_categories || []).length > 2 && (
                                                <span className="text-xs text-gray-400">
                                                    +{org.common_categories.length - 2}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-4 text-center">
                                        {org.contact_emails?.length > 0 ? (
                                            <span className="inline-flex items-center gap-1 text-sm text-blue-600">
                                                <Mail className="w-3 h-3" />
                                                {org.contact_emails.length}
                                            </span>
                                        ) : (
                                            <span className="text-gray-400">-</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-4 text-center">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                toggleTarget(org.id, org.is_target)
                                            }}
                                            className={`p-1.5 rounded-lg transition-colors ${org.is_target
                                                ? 'bg-amber-100 text-amber-600'
                                                : 'hover:bg-gray-100 text-gray-300'
                                                }`}
                                        >
                                            <Star className={`w-4 h-4 ${org.is_target ? 'fill-current' : ''}`} />
                                        </button>
                                    </td>
                                    <td className="px-4 py-4">
                                        <ChevronRight className="w-4 h-4 text-gray-400" />
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
