import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
    Search,
    ArrowLeft,
    Users,
    Building2,
    Mail,
    Download
} from 'lucide-react'
import { Input } from '@/components/ui'
import { ContactCard, ExportButton } from '@/components/buyict'
import { useBuyICTStore } from '@/stores/buyictStore'
import { useSpaceStore } from '@/stores/spaceStore'

export function Contacts() {
    const { currentSpace } = useSpaceStore()
    const {
        contacts,
        contactsLoading,
        contactFilters,
        fetchContacts,
        setContactFilters,
    } = useBuyICTStore()

    const [searchTerm, setSearchTerm] = useState('')

    useEffect(() => {
        if (currentSpace?.id) {
            fetchContacts(currentSpace.id)
        }
    }, [currentSpace?.id, fetchContacts])

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(() => {
            setContactFilters({ searchTerm })
        }, 300)
        return () => clearTimeout(timer)
    }, [searchTerm, setContactFilters])

    // Re-fetch when filters change
    useEffect(() => {
        if (currentSpace?.id) {
            fetchContacts(currentSpace.id)
        }
    }, [currentSpace?.id, contactFilters, fetchContacts])

    // Group contacts by department for stats
    const departmentStats = useMemo(() => {
        const stats: Record<string, number> = {}
        contacts.forEach(contact => {
            const depts = contact.linked_departments || []
            depts.forEach(dept => {
                stats[dept] = (stats[dept] || 0) + 1
            })
        })
        return Object.entries(stats)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
    }, [contacts])

    return (
        <div className="p-8 bg-gray-50 min-h-screen">
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <Link to="/buyict" className="p-2 hover:bg-gray-200 rounded-lg transition-colors">
                    <ArrowLeft className="w-5 h-5 text-gray-500" />
                </Link>
                <div className="flex-1">
                    <h1 className="text-2xl font-bold text-gray-900">Procurement Contacts</h1>
                    <p className="text-gray-500">
                        {contacts.length} contact{contacts.length !== 1 ? 's' : ''} extracted from opportunities
                    </p>
                </div>
                <ExportButton contacts={contacts} />
            </div>

            {/* Stats bar */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-purple-100 rounded-lg">
                                <Users className="w-5 h-5 text-purple-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-gray-900">{contacts.length}</p>
                                <p className="text-xs text-gray-500">Total Contacts</p>
                            </div>
                        </div>

                        <div className="h-12 w-px bg-gray-200" />

                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-blue-100 rounded-lg">
                                <Mail className="w-5 h-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold text-gray-900">
                                    {contacts.reduce((acc, c) => acc + c.opportunity_count, 0)}
                                </p>
                                <p className="text-xs text-gray-500">Total Associations</p>
                            </div>
                        </div>
                    </div>

                    {/* Top departments */}
                    {departmentStats.length > 0 && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">Top departments:</span>
                            {departmentStats.map(([dept, count]) => (
                                <span
                                    key={dept}
                                    className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded"
                                >
                                    {dept} ({count})
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Search */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <Input
                        type="text"
                        placeholder="Search by email or name..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                    />
                </div>
            </div>

            {/* Results */}
            {contactsLoading ? (
                <div className="flex items-center justify-center py-16">
                    <div className="flex items-center gap-3 text-gray-500">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Loading contacts...</span>
                    </div>
                </div>
            ) : contacts.length === 0 ? (
                <div className="text-center py-16">
                    <Mail className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No contacts found</h3>
                    <p className="text-gray-500">
                        {searchTerm
                            ? 'Try adjusting your search terms'
                            : 'Import opportunities from BuyICT to extract contact emails'
                        }
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {contacts.map((contact) => (
                        <ContactCard
                            key={contact.id}
                            contact={contact}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
