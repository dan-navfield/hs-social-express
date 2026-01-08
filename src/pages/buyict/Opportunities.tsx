import { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
    Search,
    Filter,
    Calendar,
    Building2,
    Users,
    ArrowLeft,
    X,
    ChevronDown,
    SortAsc,
    SortDesc
} from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { OpportunityCard } from '@/components/buyict'
import { useBuyICTStore } from '@/stores/buyictStore'
import { useSpaceStore } from '@/stores/spaceStore'

type SortField = 'closing_date' | 'title' | 'created_at'
type SortOrder = 'asc' | 'desc'

export function Opportunities() {
    const { currentSpace } = useSpaceStore()
    const {
        opportunities,
        opportunitiesLoading,
        opportunityFilters,
        departmentMappings,
        fetchOpportunities,
        fetchDepartmentMappings,
        setOpportunityFilters,
    } = useBuyICTStore()

    const [searchParams] = useSearchParams()
    const [searchTerm, setSearchTerm] = useState('')
    const [showFilters, setShowFilters] = useState(false)
    const [sortField, setSortField] = useState<SortField>('closing_date')
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

    // Extract unique departments from mappings
    const uniqueDepartments = useMemo(() => {
        return [...new Set(departmentMappings.map(m => m.canonical_department))].sort()
    }, [departmentMappings])

    // Extract unique statuses from opportunities
    const uniqueStatuses = useMemo(() => {
        return [...new Set(opportunities.map(o => o.opportunity_status).filter(Boolean))].sort()
    }, [opportunities])

    useEffect(() => {
        if (currentSpace?.id) {
            fetchDepartmentMappings(currentSpace.id)
            fetchOpportunities(currentSpace.id)
        }
    }, [currentSpace?.id, fetchDepartmentMappings, fetchOpportunities])

    // Apply search params to filters
    useEffect(() => {
        const status = searchParams.get('status')
        const closing = searchParams.get('closing')

        if (status) {
            setOpportunityFilters({ status: status })
        }
        if (closing === 'week') {
            const now = new Date()
            const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
            setOpportunityFilters({
                closingDateFrom: now,
                closingDateTo: weekLater
            })
        }
    }, [searchParams, setOpportunityFilters])

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(() => {
            setOpportunityFilters({ searchTerm })
        }, 300)
        return () => clearTimeout(timer)
    }, [searchTerm, setOpportunityFilters])

    // Re-fetch when filters change
    useEffect(() => {
        if (currentSpace?.id) {
            fetchOpportunities(currentSpace.id)
        }
    }, [currentSpace?.id, opportunityFilters, fetchOpportunities])

    // Sort opportunities
    const sortedOpportunities = useMemo(() => {
        return [...opportunities].sort((a, b) => {
            let comparison = 0

            switch (sortField) {
                case 'closing_date':
                    const dateA = a.closing_date ? new Date(a.closing_date).getTime() : Infinity
                    const dateB = b.closing_date ? new Date(b.closing_date).getTime() : Infinity
                    comparison = dateA - dateB
                    break
                case 'title':
                    comparison = a.title.localeCompare(b.title)
                    break
                case 'created_at':
                    comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                    break
            }

            return sortOrder === 'asc' ? comparison : -comparison
        })
    }, [opportunities, sortField, sortOrder])

    const clearFilters = () => {
        setSearchTerm('')
        setOpportunityFilters({
            department: undefined,
            status: undefined,
            closingDateFrom: undefined,
            closingDateTo: undefined,
            hasContacts: undefined,
            searchTerm: undefined,
        })
    }

    const hasActiveFilters =
        opportunityFilters.department ||
        opportunityFilters.status ||
        opportunityFilters.closingDateFrom ||
        opportunityFilters.closingDateTo ||
        opportunityFilters.hasContacts !== undefined

    return (
        <div className="p-8 bg-gray-50 min-h-screen">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <Link to="/buyict" className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
                    <ArrowLeft className="w-5 h-5 text-gray-500" />
                </Link>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold text-gray-900">Opportunities</h1>
                    <p className="text-gray-500">
                        {opportunities.length} opportunit{opportunities.length !== 1 ? 'ies' : 'y'} found
                    </p>
                </div>
            </div>

            {/* Search and Filters */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
                <div className="flex items-center gap-4 mb-4">
                    {/* Search */}
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <Input
                            type="text"
                            placeholder="Search by title, reference, or buyer..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10"
                        />
                    </div>

                    {/* Filter toggle */}
                    <Button
                        variant={showFilters || hasActiveFilters ? 'primary' : 'secondary'}
                        onClick={() => setShowFilters(!showFilters)}
                    >
                        <Filter className="w-4 h-4" />
                        Filters
                        {hasActiveFilters && (
                            <span className="ml-1 bg-white/20 px-1.5 py-0.5 rounded text-xs">
                                Active
                            </span>
                        )}
                    </Button>

                    {/* Sort dropdown */}
                    <div className="flex items-center gap-2">
                        <select
                            value={sortField}
                            onChange={(e) => setSortField(e.target.value as SortField)}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                            <option value="closing_date">Sort by Close Date</option>
                            <option value="title">Sort by Title</option>
                            <option value="created_at">Sort by Added Date</option>
                        </select>
                        <button
                            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                            className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                            title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
                        >
                            {sortOrder === 'asc' ? (
                                <SortAsc className="w-4 h-4 text-gray-500" />
                            ) : (
                                <SortDesc className="w-4 h-4 text-gray-500" />
                            )}
                        </button>
                    </div>
                </div>

                {/* Expanded filters */}
                {showFilters && (
                    <div className="pt-4 border-t border-gray-200">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            {/* Department filter */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    <Building2 className="w-4 h-4 inline mr-1" />
                                    Department
                                </label>
                                <select
                                    value={opportunityFilters.department || ''}
                                    onChange={(e) => setOpportunityFilters({ department: e.target.value || undefined })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                >
                                    <option value="">All Departments</option>
                                    {uniqueDepartments.map((dept) => (
                                        <option key={dept} value={dept}>{dept}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Status filter */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Status
                                </label>
                                <select
                                    value={opportunityFilters.status || ''}
                                    onChange={(e) => setOpportunityFilters({ status: e.target.value || undefined })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                >
                                    <option value="">All Statuses</option>
                                    {uniqueStatuses.map((status) => (
                                        <option key={status ?? 'unknown'} value={status ?? ''}>{status}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Closing date range */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    <Calendar className="w-4 h-4 inline mr-1" />
                                    Closing Date
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="date"
                                        value={opportunityFilters.closingDateFrom?.toISOString().split('T')[0] || ''}
                                        onChange={(e) => setOpportunityFilters({
                                            closingDateFrom: e.target.value ? new Date(e.target.value) : undefined
                                        })}
                                        className="flex-1 px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                        placeholder="From"
                                    />
                                    <input
                                        type="date"
                                        value={opportunityFilters.closingDateTo?.toISOString().split('T')[0] || ''}
                                        onChange={(e) => setOpportunityFilters({
                                            closingDateTo: e.target.value ? new Date(e.target.value) : undefined
                                        })}
                                        className="flex-1 px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                        placeholder="To"
                                    />
                                </div>
                            </div>

                            {/* Has contacts filter */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    <Users className="w-4 h-4 inline mr-1" />
                                    Contacts
                                </label>
                                <select
                                    value={opportunityFilters.hasContacts === undefined ? '' : opportunityFilters.hasContacts.toString()}
                                    onChange={(e) => setOpportunityFilters({
                                        hasContacts: e.target.value === '' ? undefined : e.target.value === 'true'
                                    })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                                >
                                    <option value="">All</option>
                                    <option value="true">Has Contacts</option>
                                    <option value="false">No Contacts</option>
                                </select>
                            </div>
                        </div>

                        {/* Clear filters */}
                        {hasActiveFilters && (
                            <div className="mt-4 flex justify-end">
                                <button
                                    onClick={clearFilters}
                                    className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
                                >
                                    <X className="w-4 h-4" />
                                    Clear all filters
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Results */}
            {opportunitiesLoading ? (
                <div className="flex items-center justify-center py-16">
                    <div className="flex items-center gap-3 text-gray-500">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Loading opportunities...</span>
                    </div>
                </div>
            ) : sortedOpportunities.length === 0 ? (
                <div className="text-center py-16">
                    <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No opportunities found</h3>
                    <p className="text-gray-500 mb-4">
                        {hasActiveFilters
                            ? 'Try adjusting your filters or search terms'
                            : 'Import opportunities from BuyICT to get started'
                        }
                    </p>
                    {hasActiveFilters && (
                        <Button variant="secondary" onClick={clearFilters}>
                            Clear Filters
                        </Button>
                    )}
                </div>
            ) : (
                <div className="space-y-4">
                    {sortedOpportunities.map((opportunity) => (
                        <Link
                            key={opportunity.id}
                            to={`/buyict/opportunity/${opportunity.id}`}
                        >
                            <OpportunityCard opportunity={opportunity} />
                        </Link>
                    ))}
                </div>
            )}
        </div>
    )
}
