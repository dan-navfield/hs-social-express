import { useState, useEffect, useMemo } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import {
    Search,
    Filter,
    Calendar,
    Building2,
    Users,
    ArrowLeft,
    X,
    SortAsc,
    SortDesc,
    Trash2,
    CheckSquare,
    Square,
    Loader2
} from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { OpportunityCard } from '@/components/buyict'
import { useBuyICTStore } from '@/stores/buyictStore'
import { useSpaceStore } from '@/stores/spaceStore'
import { supabase } from '@/lib/supabase'

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

    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const [searchTerm, setSearchTerm] = useState('')
    const [showFilters, setShowFilters] = useState(false)
    const [sortField, setSortField] = useState<SortField>('closing_date')
    const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

    // Selection state
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [isDeleting, setIsDeleting] = useState(false)
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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

    // Selection handlers
    const toggleSelect = (id: string, e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIds(prev => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }

    const toggleSelectAll = () => {
        if (selectedIds.size === sortedOpportunities.length) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(sortedOpportunities.map(o => o.id)))
        }
    }

    const handleDeleteSelected = () => {
        if (selectedIds.size === 0) return
        setShowDeleteConfirm(true)
    }

    const confirmDelete = async () => {
        setShowDeleteConfirm(false)
        setIsDeleting(true)
        try {
            console.log('Deleting opportunities:', Array.from(selectedIds))

            const { data, error } = await supabase
                .from('buyict_opportunities')
                .delete()
                .in('id', Array.from(selectedIds))
                .select()

            console.log('Delete result - data:', data, 'error:', error)

            if (error) {
                console.error('Supabase error:', error)
                throw error
            }

            // Success!
            console.log(`Successfully deleted ${selectedIds.size} opportunities`)
            setSelectedIds(new Set())
            // Refresh list
            if (currentSpace?.id) {
                fetchOpportunities(currentSpace.id)
            }
        } catch (err) {
            console.error('Failed to delete opportunities:', err)
            alert(`Failed to delete opportunities: ${err instanceof Error ? err.message : 'Unknown error'}`)
        } finally {
            setIsDeleting(false)
        }
    }

    const allSelected = sortedOpportunities.length > 0 && selectedIds.size === sortedOpportunities.length

    return (
        <div className="p-8 bg-gray-50 min-h-screen">
            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md mx-4">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                                <Trash2 className="w-6 h-6 text-red-600" />
                            </div>
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900">Delete Opportunities</h3>
                                <p className="text-sm text-gray-500">This action cannot be undone</p>
                            </div>
                        </div>
                        <p className="text-gray-700 mb-6">
                            Are you sure you want to delete <strong>{selectedIds.size}</strong> {selectedIds.size === 1 ? 'opportunity' : 'opportunities'}?
                        </p>
                        <div className="flex gap-3 justify-end">
                            <Button
                                variant="secondary"
                                onClick={() => setShowDeleteConfirm(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                onClick={confirmDelete}
                                className="bg-red-600 hover:bg-red-700"
                            >
                                <Trash2 className="w-4 h-4" />
                                Delete
                            </Button>
                        </div>
                    </div>
                </div>
            )}
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

            {/* Selection toolbar */}
            {sortedOpportunities.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 flex items-center gap-4">
                    <button
                        onClick={toggleSelectAll}
                        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
                    >
                        {allSelected ? (
                            <CheckSquare className="w-5 h-5 text-purple-600" />
                        ) : (
                            <Square className="w-5 h-5" />
                        )}
                        {allSelected ? 'Deselect All' : 'Select All'}
                    </button>

                    {selectedIds.size > 0 && (
                        <>
                            <span className="text-sm text-gray-500">
                                {selectedIds.size} selected
                            </span>
                            <Button
                                variant="ghost"
                                onClick={handleDeleteSelected}
                                disabled={isDeleting}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50 ml-auto"
                            >
                                {isDeleting ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Deleting...
                                    </>
                                ) : (
                                    <>
                                        <Trash2 className="w-4 h-4" />
                                        Delete Selected
                                    </>
                                )}
                            </Button>
                        </>
                    )}
                </div>
            )}

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
                        <div key={opportunity.id} className="relative flex items-stretch">
                            {/* Checkbox */}
                            <button
                                onClick={(e) => toggleSelect(opportunity.id, e)}
                                className="flex-shrink-0 w-12 flex items-center justify-center hover:bg-gray-100 rounded-l-lg z-10"
                            >
                                {selectedIds.has(opportunity.id) ? (
                                    <CheckSquare className="w-5 h-5 text-purple-600" />
                                ) : (
                                    <Square className="w-5 h-5 text-gray-400" />
                                )}
                            </button>
                            <div
                                className="flex-1 cursor-pointer"
                                onClick={() => navigate(`/buyict/opportunity/${opportunity.id}`)}
                            >
                                <OpportunityCard opportunity={opportunity} />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
