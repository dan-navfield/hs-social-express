import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
    ArrowLeft,
    Building2,
    Plus,
    Check,
    X,
    Edit2,
    Trash2,
    AlertCircle,
    ChevronRight
} from 'lucide-react'
import { Button, Input, Modal } from '@/components/ui'
import { useBuyICTStore } from '@/stores/buyictStore'
import { useSpaceStore } from '@/stores/spaceStore'
import type { BuyICTDepartmentMapping, BuyICTMatchType } from '@/types/buyict'

interface MappingFormData {
    source_pattern: string
    match_type: BuyICTMatchType
    canonical_department: string
    canonical_agency: string
}

export function DepartmentMappings() {
    const { currentSpace } = useSpaceStore()
    const {
        departmentMappings,
        mappingsLoading,
        unmappedBuyerEntities,
        fetchDepartmentMappings,
        createDepartmentMapping,
        updateDepartmentMapping,
        deleteDepartmentMapping,
    } = useBuyICTStore()

    const [showCreateModal, setShowCreateModal] = useState(false)
    const [editingMapping, setEditingMapping] = useState<BuyICTDepartmentMapping | null>(null)
    const [formData, setFormData] = useState<MappingFormData>({
        source_pattern: '',
        match_type: 'exact',
        canonical_department: '',
        canonical_agency: '',
    })
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (currentSpace?.id) {
            fetchDepartmentMappings(currentSpace.id)
        }
    }, [currentSpace?.id, fetchDepartmentMappings])

    const handleCreateFromUnmapped = (buyerEntity: string) => {
        setFormData({
            source_pattern: buyerEntity,
            match_type: 'exact',
            canonical_department: buyerEntity, // Pre-populate with same value
            canonical_agency: '',
        })
        setShowCreateModal(true)
    }

    const handleEdit = (mapping: BuyICTDepartmentMapping) => {
        setEditingMapping(mapping)
        setFormData({
            source_pattern: mapping.source_pattern,
            match_type: mapping.match_type,
            canonical_department: mapping.canonical_department,
            canonical_agency: mapping.canonical_agency || '',
        })
        setShowCreateModal(true)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!currentSpace?.id) return

        setIsSubmitting(true)
        setError(null)

        try {
            if (editingMapping) {
                await updateDepartmentMapping(editingMapping.id, {
                    source_pattern: formData.source_pattern,
                    match_type: formData.match_type,
                    canonical_department: formData.canonical_department,
                    canonical_agency: formData.canonical_agency || null,
                    is_approved: true,
                })
            } else {
                await createDepartmentMapping(currentSpace.id, {
                    source_pattern: formData.source_pattern,
                    match_type: formData.match_type,
                    canonical_department: formData.canonical_department,
                    canonical_agency: formData.canonical_agency || null,
                    is_approved: true,
                })
            }

            await fetchDepartmentMappings(currentSpace.id)
            setShowCreateModal(false)
            setEditingMapping(null)
            resetForm()
        } catch (err: any) {
            setError(err.message || 'Failed to save mapping')
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleDelete = async (id: string) => {
        if (!currentSpace?.id) return
        if (!confirm('Are you sure you want to delete this mapping?')) return

        try {
            await deleteDepartmentMapping(id)
            await fetchDepartmentMappings(currentSpace.id)
        } catch (err) {
            console.error('Failed to delete mapping:', err)
        }
    }

    const handleApprove = async (mapping: BuyICTDepartmentMapping) => {
        if (!currentSpace?.id) return

        try {
            await updateDepartmentMapping(mapping.id, { is_approved: true })
            await fetchDepartmentMappings(currentSpace.id)
        } catch (err) {
            console.error('Failed to approve mapping:', err)
        }
    }

    const resetForm = () => {
        setFormData({
            source_pattern: '',
            match_type: 'exact',
            canonical_department: '',
            canonical_agency: '',
        })
    }

    const closeModal = () => {
        setShowCreateModal(false)
        setEditingMapping(null)
        resetForm()
        setError(null)
    }

    // Group mappings by canonical department
    const groupedMappings = departmentMappings.reduce((acc, mapping) => {
        const dept = mapping.canonical_department
        if (!acc[dept]) acc[dept] = []
        acc[dept].push(mapping)
        return acc
    }, {} as Record<string, BuyICTDepartmentMapping[]>)

    return (
        <div className="p-8 bg-gray-50 min-h-screen">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <Link to="/buyict" className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
                    <ArrowLeft className="w-5 h-5 text-gray-500" />
                </Link>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold text-gray-900">Department Mappings</h1>
                    <p className="text-gray-500">
                        Map raw buyer entity names to canonical department names
                    </p>
                </div>
                <Button onClick={() => setShowCreateModal(true)}>
                    <Plus className="w-4 h-4" />
                    Add Mapping
                </Button>
            </div>

            {/* Unmapped entities alert */}
            {unmappedBuyerEntities.length > 0 && (
                <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <h3 className="font-medium text-amber-800 mb-2">
                                {unmappedBuyerEntities.length} unmapped buyer entit{unmappedBuyerEntities.length !== 1 ? 'ies' : 'y'}
                            </h3>
                            <p className="text-sm text-amber-700 mb-3">
                                These buyer entities from your opportunities don't have department mappings yet:
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {unmappedBuyerEntities.slice(0, 8).map((entity) => (
                                    <button
                                        key={entity}
                                        onClick={() => handleCreateFromUnmapped(entity)}
                                        className="inline-flex items-center gap-1 text-sm px-3 py-1.5 bg-white border border-amber-300 rounded-lg hover:bg-amber-100 transition-colors"
                                    >
                                        <span className="text-amber-800">{entity}</span>
                                        <Plus className="w-3 h-3 text-amber-600" />
                                    </button>
                                ))}
                                {unmappedBuyerEntities.length > 8 && (
                                    <span className="text-sm text-amber-600 py-1.5">
                                        +{unmappedBuyerEntities.length - 8} more
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Mappings list */}
            {mappingsLoading ? (
                <div className="flex items-center justify-center py-16">
                    <div className="flex items-center gap-3 text-gray-500">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Loading mappings...</span>
                    </div>
                </div>
            ) : Object.keys(groupedMappings).length === 0 ? (
                <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
                    <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No mappings yet</h3>
                    <p className="text-gray-500 mb-4">
                        Create department mappings to categorise your opportunities
                    </p>
                    <Button onClick={() => setShowCreateModal(true)}>
                        <Plus className="w-4 h-4" />
                        Create First Mapping
                    </Button>
                </div>
            ) : (
                <div className="space-y-4">
                    {Object.entries(groupedMappings).map(([department, mappings]) => (
                        <div key={department} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                            {/* Department header */}
                            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Building2 className="w-5 h-5 text-purple-600" />
                                    <span className="font-medium text-gray-900">{department}</span>
                                    <span className="text-sm text-gray-500">
                                        ({mappings.length} pattern{mappings.length !== 1 ? 's' : ''})
                                    </span>
                                </div>
                                {mappings[0]?.canonical_agency && (
                                    <span className="text-sm text-gray-500">
                                        Agency: {mappings[0].canonical_agency}
                                    </span>
                                )}
                            </div>

                            {/* Mapping rows */}
                            <div className="divide-y divide-gray-100">
                                {mappings.map((mapping) => (
                                    <div
                                        key={mapping.id}
                                        className="px-4 py-3 flex items-center justify-between hover:bg-gray-50"
                                    >
                                        <div className="flex items-center gap-4">
                                            {/* Match type badge */}
                                            <span className={`text-xs px-2 py-1 rounded ${mapping.match_type === 'exact'
                                                    ? 'bg-emerald-100 text-emerald-700'
                                                    : mapping.match_type === 'contains'
                                                        ? 'bg-blue-100 text-blue-700'
                                                        : 'bg-purple-100 text-purple-700'
                                                }`}>
                                                {mapping.match_type}
                                            </span>

                                            {/* Pattern */}
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-sm text-gray-700">
                                                    "{mapping.source_pattern}"
                                                </span>
                                                <ChevronRight className="w-4 h-4 text-gray-400" />
                                                <span className="text-sm text-gray-900">{mapping.canonical_department}</span>
                                            </div>

                                            {/* Approval status */}
                                            {!mapping.is_approved && (
                                                <span className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded">
                                                    Pending approval
                                                </span>
                                            )}
                                            {mapping.is_auto_generated && (
                                                <span className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded">
                                                    Auto-suggested
                                                </span>
                                            )}

                                            {/* Confidence */}
                                            {mapping.confidence < 1 && (
                                                <span className="text-xs text-gray-400">
                                                    {Math.round(mapping.confidence * 100)}% confidence
                                                </span>
                                            )}
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-2">
                                            {!mapping.is_approved && (
                                                <button
                                                    onClick={() => handleApprove(mapping)}
                                                    className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"
                                                    title="Approve mapping"
                                                >
                                                    <Check className="w-4 h-4" />
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleEdit(mapping)}
                                                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                                                title="Edit mapping"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(mapping.id)}
                                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                                                title="Delete mapping"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Create/Edit Modal */}
            <Modal
                isOpen={showCreateModal}
                onClose={closeModal}
                title={editingMapping ? 'Edit Mapping' : 'Create Department Mapping'}
            >
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {error && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                            {error}
                        </div>
                    )}

                    {/* Source pattern */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Source Pattern *
                        </label>
                        <Input
                            type="text"
                            value={formData.source_pattern}
                            onChange={(e) => setFormData({ ...formData, source_pattern: e.target.value })}
                            placeholder="e.g., Department of Health"
                            required
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            The raw buyer entity string to match from BuyICT
                        </p>
                    </div>

                    {/* Match type */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Match Type
                        </label>
                        <select
                            value={formData.match_type}
                            onChange={(e) => setFormData({ ...formData, match_type: e.target.value as BuyICTMatchType })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                            <option value="exact">Exact Match</option>
                            <option value="contains">Contains</option>
                            <option value="regex">Regular Expression</option>
                            <option value="fuzzy">Fuzzy Match</option>
                        </select>
                    </div>

                    {/* Canonical department */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Canonical Department *
                        </label>
                        <Input
                            type="text"
                            value={formData.canonical_department}
                            onChange={(e) => setFormData({ ...formData, canonical_department: e.target.value })}
                            placeholder="e.g., Health"
                            required
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            The standardised department name to use
                        </p>
                    </div>

                    {/* Canonical agency */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Agency (optional)
                        </label>
                        <Input
                            type="text"
                            value={formData.canonical_agency}
                            onChange={(e) => setFormData({ ...formData, canonical_agency: e.target.value })}
                            placeholder="e.g., Federal Government"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            Higher-level agency grouping if applicable
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-3 pt-4 border-t">
                        <Button type="button" variant="secondary" onClick={closeModal}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? 'Saving...' : editingMapping ? 'Update Mapping' : 'Create Mapping'}
                        </Button>
                    </div>
                </form>
            </Modal>
        </div>
    )
}
