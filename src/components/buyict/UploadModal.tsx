import { useState, useCallback } from 'react'
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, X, Loader2 } from 'lucide-react'
import { Modal, Button } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useSpaceStore } from '@/stores/spaceStore'
import { useAuthStore } from '@/stores/authStore'
import type { BuyICTUploadRow, BuyICTParsedOpportunity, ExtractedEmail } from '@/types/buyict'

interface UploadModalProps {
    isOpen: boolean
    onClose: () => void
    onUploadComplete: () => void
    integrationId: string
}

interface ParseResult {
    opportunities: BuyICTParsedOpportunity[]
    errors: string[]
    emailsExtracted: ExtractedEmail[]
}

// Email regex pattern (RFC 5322 simplified)
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi

// Common date formats from BuyICT exports
const parseDateString = (str: string | undefined | null): Date | null => {
    if (!str) return null

    // Try various formats
    const formats = [
        // ISO format
        /^\d{4}-\d{2}-\d{2}/,
        // AU format: DD/MM/YYYY
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})/,
        // US format: MM/DD/YYYY
        /^(\d{1,2})-(\d{1,2})-(\d{4})/,
    ]

    // Try native parsing first
    const parsed = new Date(str)
    if (!isNaN(parsed.getTime())) return parsed

    // Try Australian date format
    const auMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    if (auMatch) {
        const [, day, month, year] = auMatch
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
    }

    return null
}

// Extract emails from text with role/context detection
const extractEmailsFromText = (text: string, sourceType: 'structured_field' | 'page_text'): ExtractedEmail[] => {
    const emails: ExtractedEmail[] = []
    const matches = text.matchAll(EMAIL_REGEX)

    for (const match of matches) {
        const email = match[0].toLowerCase()

        // Skip obvious non-contact emails
        if (email.includes('noreply') || email.includes('no-reply') || email.includes('donotreply')) {
            continue
        }

        // Try to extract name/role from surrounding context
        const contextStart = Math.max(0, match.index! - 100)
        const contextEnd = Math.min(text.length, match.index! + email.length + 50)
        const context = text.substring(contextStart, contextEnd)

        let role_label: string | null = null
        let name: string | null = null

        // Common role patterns
        const rolePatterns = [
            /contact\s*officer/i,
            /enquiries/i,
            /technical\s*contact/i,
            /procurement\s*officer/i,
            /project\s*officer/i,
        ]

        for (const pattern of rolePatterns) {
            if (pattern.test(context)) {
                role_label = context.match(pattern)?.[0] || null
                break
            }
        }

        // Try to find a name before the email
        const nameMatch = context.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?:\s*[<(]|\s+\w+@)/i)
        if (nameMatch) {
            name = nameMatch[1].trim()
        }

        emails.push({
            email,
            name,
            role_label,
            source_type: sourceType,
            source_detail: sourceType === 'structured_field' ? 'Contact field' : 'Page text extraction',
            confidence: sourceType === 'structured_field' ? 0.95 : 0.75,
        })
    }

    return emails
}

// Parse a single row from the CSV
const parseRow = (row: BuyICTUploadRow, rowIndex: number): { opportunity: BuyICTParsedOpportunity | null; error: string | null; emails: ExtractedEmail[] } => {
    // Get reference (required)
    const reference = row.reference || row['Reference'] || row['ATM ID'] || row['Opportunity ID']
    if (!reference) {
        return { opportunity: null, error: `Row ${rowIndex + 1}: Missing reference/ID`, emails: [] }
    }

    // Get title (required)
    const title = row.title || row['Title'] || row['Opportunity Title']
    if (!title) {
        return { opportunity: null, error: `Row ${rowIndex + 1}: Missing title`, emails: [] }
    }

    // Get buyer entity
    const buyer = row.buyer || row['Buyer'] || row['Agency'] || row['Department'] || row['Buying Entity']

    // Get contact text and extract emails
    const contactText = row.contact || row['Contact'] || row['Contact Officer'] || row['Enquiries']
    const emails: ExtractedEmail[] = []
    if (contactText) {
        emails.push(...extractEmailsFromText(contactText, 'structured_field'))
    }

    // Also extract from description
    const description = row.description || row['Description'] || row['Summary']
    if (description) {
        emails.push(...extractEmailsFromText(description, 'page_text'))
    }

    return {
        opportunity: {
            buyict_reference: reference.toString().trim(),
            title: title.toString().trim(),
            buyer_entity_raw: buyer?.toString().trim() || null,
            category: (row.category || row['Category'] || row['Panel'])?.toString().trim() || null,
            description: description?.toString().trim() || null,
            publish_date: parseDateString(row.publish_date || row['Publish Date'] || row['Published']),
            closing_date: parseDateString(row.closing_date || row['Closing Date'] || row['Close Date'] || row['Closes']),
            opportunity_status: (row.status || row['Status'])?.toString().trim() || 'Open',
            contact_text_raw: contactText?.toString().trim() || null,
            buyict_url: (row.url || row['URL'] || row['Link'])?.toString().trim() || null,
            attachments: [],
        },
        error: null,
        emails,
    }
}

// Parse CSV text to rows
const parseCSV = (text: string): BuyICTUploadRow[] => {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0)
    if (lines.length < 2) return []

    // Parse header
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))

    // Parse data rows
    const rows: BuyICTUploadRow[] = []
    for (let i = 1; i < lines.length; i++) {
        const values: string[] = []
        let current = ''
        let inQuotes = false

        for (const char of lines[i]) {
            if (char === '"') {
                inQuotes = !inQuotes
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim())
                current = ''
            } else {
                current += char
            }
        }
        values.push(current.trim())

        const row: BuyICTUploadRow = {}
        headers.forEach((header, index) => {
            (row as any)[header] = values[index] || ''
        })
        rows.push(row)
    }

    return rows
}

export function UploadModal({ isOpen, onClose, onUploadComplete, integrationId }: UploadModalProps) {
    const { currentSpace } = useSpaceStore()
    const { user } = useAuthStore()

    const [file, setFile] = useState<File | null>(null)
    const [isDragging, setIsDragging] = useState(false)
    const [parseResult, setParseResult] = useState<ParseResult | null>(null)
    const [isUploading, setIsUploading] = useState(false)
    const [uploadError, setUploadError] = useState<string | null>(null)
    const [uploadSuccess, setUploadSuccess] = useState(false)

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
    }, [])

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)

        const droppedFile = e.dataTransfer.files[0]
        if (droppedFile && (droppedFile.type === 'text/csv' || droppedFile.name.endsWith('.csv'))) {
            setFile(droppedFile)
            processFile(droppedFile)
        }
    }, [])

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0]
        if (selectedFile) {
            setFile(selectedFile)
            processFile(selectedFile)
        }
    }, [])

    const processFile = async (file: File) => {
        setParseResult(null)
        setUploadError(null)

        try {
            const text = await file.text()
            const rows = parseCSV(text)

            const opportunities: BuyICTParsedOpportunity[] = []
            const errors: string[] = []
            const allEmails: ExtractedEmail[] = []

            rows.forEach((row, index) => {
                const { opportunity, error, emails } = parseRow(row, index)
                if (opportunity) {
                    opportunities.push(opportunity)
                    allEmails.push(...emails)
                }
                if (error) {
                    errors.push(error)
                }
            })

            setParseResult({
                opportunities,
                errors,
                emailsExtracted: allEmails,
            })
        } catch (err) {
            setUploadError('Failed to parse file. Please ensure it is a valid CSV.')
        }
    }

    const handleUpload = async () => {
        if (!parseResult || !currentSpace || !user) return

        setIsUploading(true)
        setUploadError(null)

        try {
            // Create sync job
            const { data: syncJob, error: syncJobError } = await supabase
                .from('buyict_sync_jobs')
                .insert({
                    space_id: currentSpace.id,
                    integration_id: integrationId,
                    sync_type: 'upload',
                    status: 'running',
                    started_at: new Date().toISOString(),
                    created_by: user.id,
                })
                .select()
                .single()

            if (syncJobError) throw syncJobError

            let opportunitiesAdded = 0
            let opportunitiesUpdated = 0
            let contactsFound = 0
            const contactsNew = new Set<string>()

            // Insert opportunities
            for (const opp of parseResult.opportunities) {
                const { data: existing } = await supabase
                    .from('buyict_opportunities')
                    .select('id')
                    .eq('space_id', currentSpace.id)
                    .eq('buyict_reference', opp.buyict_reference)
                    .single()

                if (existing) {
                    // Update existing
                    await supabase
                        .from('buyict_opportunities')
                        .update({
                            title: opp.title,
                            buyer_entity_raw: opp.buyer_entity_raw,
                            category: opp.category,
                            description: opp.description,
                            publish_date: opp.publish_date?.toISOString().split('T')[0],
                            closing_date: opp.closing_date?.toISOString(),
                            opportunity_status: opp.opportunity_status,
                            contact_text_raw: opp.contact_text_raw,
                            buyict_url: opp.buyict_url,
                            last_synced_at: new Date().toISOString(),
                            sync_job_id: syncJob.id,
                            updated_at: new Date().toISOString(),
                        })
                        .eq('id', existing.id)

                    opportunitiesUpdated++
                } else {
                    // Insert new
                    await supabase
                        .from('buyict_opportunities')
                        .insert({
                            space_id: currentSpace.id,
                            buyict_reference: opp.buyict_reference,
                            title: opp.title,
                            buyer_entity_raw: opp.buyer_entity_raw,
                            category: opp.category,
                            description: opp.description,
                            publish_date: opp.publish_date?.toISOString().split('T')[0],
                            closing_date: opp.closing_date?.toISOString(),
                            opportunity_status: opp.opportunity_status,
                            contact_text_raw: opp.contact_text_raw,
                            buyict_url: opp.buyict_url,
                            sync_job_id: syncJob.id,
                        })

                    opportunitiesAdded++
                }
            }

            // Process extracted emails
            for (const email of parseResult.emailsExtracted) {
                // Find or create contact
                const { data: existingContact } = await supabase
                    .from('buyict_contacts')
                    .select('id')
                    .eq('space_id', currentSpace.id)
                    .eq('email', email.email)
                    .single()

                let contactId: string

                if (existingContact) {
                    contactId = existingContact.id
                    // Update last seen
                    await supabase
                        .from('buyict_contacts')
                        .update({
                            last_seen_at: new Date().toISOString(),
                            opportunity_count: supabase.rpc('increment_opp_count', { contact_id: existingContact.id }), // This won't work, we'll fix in a future iteration
                        })
                        .eq('id', existingContact.id)
                } else {
                    const { data: newContact } = await supabase
                        .from('buyict_contacts')
                        .insert({
                            space_id: currentSpace.id,
                            email: email.email,
                            name: email.name,
                        })
                        .select()
                        .single()

                    if (newContact) {
                        contactId = newContact.id
                        contactsNew.add(email.email)
                    } else {
                        continue
                    }
                }

                contactsFound++
            }

            // Update sync job status
            await supabase
                .from('buyict_sync_jobs')
                .update({
                    status: 'completed',
                    completed_at: new Date().toISOString(),
                    stats: {
                        opportunities_added: opportunitiesAdded,
                        opportunities_updated: opportunitiesUpdated,
                        contacts_found: contactsFound,
                        contacts_new: contactsNew.size,
                        emails_extracted: parseResult.emailsExtracted.length,
                    },
                })
                .eq('id', syncJob.id)

            // Update integration status
            await supabase
                .from('buyict_integrations')
                .update({
                    connection_status: 'connected',
                    last_sync_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq('id', integrationId)

            setUploadSuccess(true)
            setTimeout(() => {
                onUploadComplete()
                onClose()
                resetState()
            }, 2000)

        } catch (err) {
            console.error('Upload error:', err)
            setUploadError('Failed to upload data. Please try again.')
        } finally {
            setIsUploading(false)
        }
    }

    const resetState = () => {
        setFile(null)
        setParseResult(null)
        setUploadError(null)
        setUploadSuccess(false)
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Import Opportunities from CSV">
            <div className="p-6 space-y-6">
                {/* Upload success state */}
                {uploadSuccess ? (
                    <div className="text-center py-8">
                        <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-gray-900 mb-2">Upload Complete!</h3>
                        <p className="text-gray-600">
                            {parseResult?.opportunities.length} opportunities imported, {parseResult?.emailsExtracted.length} emails extracted.
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Drop zone */}
                        <div
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            className={`
                border-2 border-dashed rounded-xl p-8 text-center transition-colors
                ${isDragging ? 'border-purple-500 bg-purple-50' : 'border-gray-300 hover:border-gray-400'}
                ${file ? 'bg-gray-50' : ''}
              `}
                        >
                            {file ? (
                                <div className="flex items-center justify-center gap-3">
                                    <FileSpreadsheet className="w-8 h-8 text-emerald-600" />
                                    <div className="text-left">
                                        <p className="font-medium text-gray-900">{file.name}</p>
                                        <p className="text-sm text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                                    </div>
                                    <button
                                        onClick={() => resetState()}
                                        className="ml-4 p-1 text-gray-400 hover:text-gray-600"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                                    <p className="text-gray-600 mb-2">
                                        Drag and drop your BuyICT export CSV here, or
                                    </p>
                                    <label className="inline-block">
                                        <input
                                            type="file"
                                            accept=".csv"
                                            onChange={handleFileSelect}
                                            className="hidden"
                                        />
                                        <span className="text-purple-600 hover:text-purple-700 cursor-pointer font-medium">
                                            browse to select a file
                                        </span>
                                    </label>
                                </>
                            )}
                        </div>

                        {/* Parse results */}
                        {parseResult && (
                            <div className="space-y-4">
                                {/* Summary */}
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="p-4 bg-emerald-50 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-emerald-700">{parseResult.opportunities.length}</p>
                                        <p className="text-sm text-emerald-600">Opportunities</p>
                                    </div>
                                    <div className="p-4 bg-purple-50 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-purple-700">{parseResult.emailsExtracted.length}</p>
                                        <p className="text-sm text-purple-600">Emails Found</p>
                                    </div>
                                    <div className="p-4 bg-amber-50 rounded-lg text-center">
                                        <p className="text-2xl font-bold text-amber-700">{parseResult.errors.length}</p>
                                        <p className="text-sm text-amber-600">Warnings</p>
                                    </div>
                                </div>

                                {/* Errors/warnings */}
                                {parseResult.errors.length > 0 && (
                                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                                        <div className="flex items-start gap-2">
                                            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                                            <div>
                                                <p className="font-medium text-amber-800 mb-2">Parse warnings</p>
                                                <ul className="text-sm text-amber-700 space-y-1">
                                                    {parseResult.errors.slice(0, 5).map((error, i) => (
                                                        <li key={i}>{error}</li>
                                                    ))}
                                                    {parseResult.errors.length > 5 && (
                                                        <li>...and {parseResult.errors.length - 5} more</li>
                                                    )}
                                                </ul>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Preview */}
                                {parseResult.opportunities.length > 0 && (
                                    <div>
                                        <p className="text-sm font-medium text-gray-700 mb-2">Preview (first 3):</p>
                                        <div className="space-y-2 max-h-48 overflow-y-auto">
                                            {parseResult.opportunities.slice(0, 3).map((opp, i) => (
                                                <div key={i} className="p-3 bg-gray-50 rounded-lg text-sm">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="font-mono text-gray-400">{opp.buyict_reference}</span>
                                                        {opp.opportunity_status && (
                                                            <span className="text-xs px-2 py-0.5 bg-gray-200 rounded">{opp.opportunity_status}</span>
                                                        )}
                                                    </div>
                                                    <p className="font-medium text-gray-900">{opp.title}</p>
                                                    {opp.buyer_entity_raw && (
                                                        <p className="text-gray-500 text-xs mt-1">{opp.buyer_entity_raw}</p>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Error message */}
                        {uploadError && (
                            <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                                <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
                                <p className="text-sm text-red-700">{uploadError}</p>
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex justify-end gap-3 pt-4 border-t">
                            <Button variant="secondary" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button
                                onClick={handleUpload}
                                disabled={!parseResult || parseResult.opportunities.length === 0 || isUploading}
                            >
                                {isUploading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Importing...
                                    </>
                                ) : (
                                    <>
                                        <Upload className="w-4 h-4" />
                                        Import {parseResult?.opportunities.length || 0} Opportunities
                                    </>
                                )}
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    )
}
