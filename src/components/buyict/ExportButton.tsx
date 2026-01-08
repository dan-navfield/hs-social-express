import { Download, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui'
import type { BuyICTContactWithProvenance, BuyICTContactExportRow } from '@/types/buyict'

interface ExportButtonProps {
    contacts: BuyICTContactWithProvenance[]
    filename?: string
    disabled?: boolean
}

export function ExportButton({ contacts, filename = 'buyict-contacts', disabled = false }: ExportButtonProps) {
    const [isExporting, setIsExporting] = useState(false)

    const handleExport = async () => {
        if (contacts.length === 0) return

        setIsExporting(true)

        try {
            // Transform contacts to export format
            const exportRows: BuyICTContactExportRow[] = contacts.map(contact => ({
                email: contact.email,
                name: contact.name || '',
                departments: (contact.linked_departments || []).join('; '),
                opportunity_count: contact.opportunity_count,
                linked_opportunities: contact.opportunities
                    .map(o => `${o.buyict_reference}: ${o.title}`)
                    .join(' | '),
                first_seen: new Date(contact.first_seen_at).toLocaleDateString('en-AU'),
                last_seen: new Date(contact.last_seen_at).toLocaleDateString('en-AU'),
            }))

            // Convert to CSV
            const headers = [
                'Email',
                'Name',
                'Departments',
                'Opportunity Count',
                'Linked Opportunities',
                'First Seen',
                'Last Seen',
            ]

            const csvContent = [
                headers.join(','),
                ...exportRows.map(row => [
                    `"${row.email}"`,
                    `"${row.name}"`,
                    `"${row.departments}"`,
                    row.opportunity_count,
                    `"${row.linked_opportunities.replace(/"/g, '""')}"`,
                    row.first_seen,
                    row.last_seen,
                ].join(',')),
            ].join('\n')

            // Create and download file
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = url
            link.download = `${filename}-${new Date().toISOString().split('T')[0]}.csv`
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            URL.revokeObjectURL(url)
        } catch (err) {
            console.error('Export error:', err)
        } finally {
            setIsExporting(false)
        }
    }

    return (
        <Button
            variant="secondary"
            onClick={handleExport}
            disabled={disabled || contacts.length === 0 || isExporting}
        >
            {isExporting ? (
                <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Exporting...
                </>
            ) : (
                <>
                    <Download className="w-4 h-4" />
                    Export {contacts.length} Contact{contacts.length !== 1 ? 's' : ''} to CSV
                </>
            )}
        </Button>
    )
}
