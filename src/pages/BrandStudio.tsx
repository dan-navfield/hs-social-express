import { useState, useEffect, useCallback, useRef } from 'react'
import { Globe, Check, ChevronRight, ExternalLink, Loader2, Building2, Sparkles, ArrowRight, RefreshCw, FolderOpen, ChevronDown, X, Upload, ImageIcon, Trash2 } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useSpaceStore } from '@/stores/spaceStore'

type SetupStatus = 'empty' | 'website_pending' | 'profile_draft' | 'ready'

interface DiscoveryResult {
    detected_name: string | null
    detected_linkedin: string | null
    linkedin_confidence: 'high' | 'medium' | 'low' | null
    canonical_domain: string
    pages_found: { url: string; title: string; type: string; selected: boolean }[]
}

interface BrandProfile {
    who_we_are: string | null
    what_we_do: string | null
    who_we_serve: string | null
    tone_notes: string | null
    themes: string[]
    services: string[]
    logo_url: string | null
    logo_position: string | null
    logo_top_left_url: string | null
    logo_top_left_position: string | null
    logo_bottom_right_url: string | null
    logo_bottom_right_position: string | null
    logo_corner_url: string | null  // backwards compat
    brand_colors: string[]
}

interface SharePointConnection {
    connected: boolean
    user_email: string | null
    connected_at: string | null
    token_expired?: boolean
}

interface SharePointSite {
    id: string
    name: string
    url: string
}

interface SharePointDrive {
    id: string
    name: string
    type: string
}

interface SharePointItem {
    id: string
    name: string
    is_folder: boolean
    child_count?: number
    size?: number
}

export function BrandStudio() {
    const { currentSpace } = useSpaceStore()
    const [setupStatus, setSetupStatus] = useState<SetupStatus>('empty')
    const [isLoading, setIsLoading] = useState(true)

    // Step 1: URL Input
    const [websiteUrl, setWebsiteUrl] = useState('')
    const [isDiscovering, setIsDiscovering] = useState(false)
    const [discovery, setDiscovery] = useState<DiscoveryResult | null>(null)
    const [editableName, setEditableName] = useState('')
    const [selectedPages, setSelectedPages] = useState<Set<string>>(new Set())

    // Step 2: Profile Review
    const [isGeneratingProfile, setIsGeneratingProfile] = useState(false)
    const [profile, setProfile] = useState<BrandProfile | null>(null)
    const [editedProfile, setEditedProfile] = useState<BrandProfile | null>(null)

    // SharePoint state
    const [sharePointConnection, setSharePointConnection] = useState<SharePointConnection | null>(null)
    const [showSharePointPanel, setShowSharePointPanel] = useState(false)
    const [sharePointSites, setSharePointSites] = useState<SharePointSite[]>([])
    const [sharePointDrives, setSharePointDrives] = useState<SharePointDrive[]>([])
    const [sharePointItems, setSharePointItems] = useState<SharePointItem[]>([])
    const [selectedSite, setSelectedSite] = useState<SharePointSite | null>(null)
    const [selectedDrive, setSelectedDrive] = useState<SharePointDrive | null>(null)
    const [isLoadingSharePoint, setIsLoadingSharePoint] = useState(false)
    const [sharePointBreadcrumb, setSharePointBreadcrumb] = useState<{ id: string; name: string }[]>([])

    // Sync state
    const [showSyncModal, setShowSyncModal] = useState(false)
    const [syncScanResult, setSyncScanResult] = useState<{
        total_files: number
        supported_files: number
        skipped_files: number
        estimated_tokens: number
        estimated_cost: number
        estimated_time_minutes: number
    } | null>(null)
    const [isSyncing, setIsSyncing] = useState(false)
    const [syncProgress, setSyncProgress] = useState<{
        processed: number
        total: number
        status: string
    } | null>(null)

    // Logo upload state
    const [uploadingLogo, setUploadingLogo] = useState<'main' | 'top-left' | 'bottom-right' | null>(null)
    const [brokenImages, setBrokenImages] = useState<Set<string>>(new Set())
    const mainLogoInputRef = useRef<HTMLInputElement>(null)
    const topLeftLogoInputRef = useRef<HTMLInputElement>(null)
    const bottomRightLogoInputRef = useRef<HTMLInputElement>(null)

    // Fetch current status
    const fetchStatus = useCallback(async () => {
        if (!currentSpace) return

        setIsLoading(true)
        try {
            const { data: cache } = await supabase
                .from('brand_context_cache')
                .select('setup_status, detected_name, detected_linkedin')
                .eq('space_id', currentSpace.id)
                .single()

            if (cache?.setup_status) {
                setSetupStatus(cache.setup_status as SetupStatus)
                if (cache.detected_name) setEditableName(cache.detected_name)
            }

            // Fetch profile if exists
            const { data: profileData } = await supabase
                .from('brand_profile')
                .select('*')
                .eq('space_id', currentSpace.id)
                .single()

            if (profileData) {
                setProfile(profileData)
                setEditedProfile(profileData)
            }

            // Fetch discovered pages
            const { data: docs } = await supabase
                .from('source_documents')
                .select('url, title, metadata, is_confirmed')
                .eq('space_id', currentSpace.id)
                .eq('source_type', 'website')

            if (docs && docs.length > 0) {
                setDiscovery({
                    detected_name: cache?.detected_name || null,
                    detected_linkedin: cache?.detected_linkedin || null,
                    linkedin_confidence: null,
                    canonical_domain: '',
                    pages_found: docs.map(d => ({
                        url: d.url || '',
                        title: d.title || '',
                        type: (d.metadata as { page_type?: string })?.page_type || 'page',
                        selected: d.is_confirmed || false,
                    })),
                })
                // Set all pages as selected if none are confirmed
                const confirmedDocs = docs.filter(d => d.is_confirmed)
                if (confirmedDocs.length > 0) {
                    setSelectedPages(new Set(confirmedDocs.map(d => d.url!)))
                } else {
                    setSelectedPages(new Set(docs.map(d => d.url!)))
                }
            }

            // Check for SharePoint connected param
            const urlParams = new URLSearchParams(window.location.search)
            if (urlParams.get('sharepoint') === 'connected') {
                // Clean up URL and show SharePoint panel
                window.history.replaceState({}, '', '/brand-studio')
                setShowSharePointPanel(true)
            }

            // Check SharePoint connection status
            const { data: spConnection } = await supabase
                .from('sharepoint_connections')
                .select('status, user_email, connected_at, token_expires_at')
                .eq('space_id', currentSpace.id)
                .single()

            if (spConnection) {
                const tokenExpired = spConnection.token_expires_at
                    ? new Date(spConnection.token_expires_at) < new Date()
                    : false
                setSharePointConnection({
                    connected: spConnection.status === 'connected' && !tokenExpired,
                    user_email: spConnection.user_email,
                    connected_at: spConnection.connected_at,
                    token_expired: tokenExpired,
                })
            }
        } catch (error) {
            console.error('Error fetching status:', error)
        } finally {
            setIsLoading(false)
        }
    }, [currentSpace])

    useEffect(() => {
        fetchStatus()
    }, [fetchStatus])

    // SharePoint helpers
    const fetchSharePointSites = async () => {
        if (!currentSpace) return
        setIsLoadingSharePoint(true)
        try {
            const { data, error } = await supabase.functions.invoke('sharepoint-browse', {
                body: { space_id: currentSpace.id, action: 'list_sites' },
            })
            if (error) throw error
            setSharePointSites(data.sites || [])
        } catch (error) {
            console.error('Error fetching SharePoint sites:', error)
        } finally {
            setIsLoadingSharePoint(false)
        }
    }

    const fetchSharePointDrives = async (site: SharePointSite) => {
        if (!currentSpace) return
        setSelectedSite(site)
        setSelectedDrive(null)
        setSharePointItems([])
        setSharePointBreadcrumb([])
        setIsLoadingSharePoint(true)
        try {
            const { data, error } = await supabase.functions.invoke('sharepoint-browse', {
                body: { space_id: currentSpace.id, action: 'list_drives', site_id: site.id },
            })
            if (error) throw error
            setSharePointDrives(data.drives || [])
        } catch (error) {
            console.error('Error fetching SharePoint drives:', error)
        } finally {
            setIsLoadingSharePoint(false)
        }
    }

    const fetchSharePointItems = async (drive: SharePointDrive, folderId?: string, folderName?: string) => {
        if (!currentSpace) return
        if (!folderId) {
            setSelectedDrive(drive)
            setSharePointBreadcrumb([{ id: 'root', name: drive.name }])
        } else if (folderName) {
            setSharePointBreadcrumb(prev => [...prev, { id: folderId, name: folderName }])
        }
        setIsLoadingSharePoint(true)
        try {
            const { data, error } = await supabase.functions.invoke('sharepoint-browse', {
                body: {
                    space_id: currentSpace.id,
                    action: 'list_items',
                    drive_id: drive.id,
                    folder_id: folderId === 'root' ? undefined : folderId,
                },
            })
            if (error) throw error
            setSharePointItems(data.items || [])
        } catch (error) {
            console.error('Error fetching SharePoint items:', error)
        } finally {
            setIsLoadingSharePoint(false)
        }
    }

    const handleStartSharePointSync = async () => {
        if (!currentSpace || !selectedSite || !selectedDrive) return

        // First, scan the folder to get estimates
        setIsLoadingSharePoint(true)
        try {
            const folderId = sharePointBreadcrumb.length > 1
                ? sharePointBreadcrumb[sharePointBreadcrumb.length - 1].id
                : undefined

            const { data, error } = await supabase.functions.invoke('sharepoint-sync', {
                body: {
                    action: 'scan',
                    space_id: currentSpace.id,
                    site_id: selectedSite.id,
                    drive_id: selectedDrive.id,
                    folder_id: folderId,
                },
            })

            if (error) throw error

            setSyncScanResult(data)
            setShowSyncModal(true)
        } catch (error) {
            console.error('Error scanning folder:', error)
            alert('Failed to scan folder. Please try again.')
        } finally {
            setIsLoadingSharePoint(false)
        }
    }

    const handleConfirmSync = async () => {
        if (!currentSpace || !selectedSite || !selectedDrive) return

        setIsSyncing(true)
        setSyncProgress({ processed: 0, total: syncScanResult?.supported_files || 0, status: 'starting' })

        try {
            const folderId = sharePointBreadcrumb.length > 1
                ? sharePointBreadcrumb[sharePointBreadcrumb.length - 1].id
                : undefined

            const { data, error } = await supabase.functions.invoke('sharepoint-sync', {
                body: {
                    action: 'start_sync',
                    space_id: currentSpace.id,
                    site_id: selectedSite.id,
                    drive_id: selectedDrive.id,
                    folder_id: folderId,
                },
            })

            if (error) throw error

            // Poll for progress
            const syncId = data.sync_id
            const pollProgress = async () => {
                const { data: progress } = await supabase
                    .from('sync_progress')
                    .select('*')
                    .eq('id', syncId)
                    .single()

                if (progress) {
                    setSyncProgress({
                        processed: progress.processed_documents,
                        total: progress.total_documents,
                        status: progress.status,
                    })

                    if (progress.status !== 'completed' && progress.status !== 'failed') {
                        setTimeout(pollProgress, 2000)
                    } else {
                        setIsSyncing(false)
                        if (progress.status === 'completed') {
                            alert(`Sync complete! Processed ${progress.processed_documents} documents and generated training examples.`)
                        }
                    }
                }
            }

            pollProgress()
        } catch (error) {
            console.error('Error starting sync:', error)
            setIsSyncing(false)
            alert('Failed to start sync. Please try again.')
        }
    }

    // Step 1: Discover website
    const handleDiscoverWebsite = async () => {
        if (!currentSpace || !websiteUrl.trim()) return

        setIsDiscovering(true)
        try {
            const { data, error } = await supabase.functions.invoke('crawl-website', {
                body: { url: websiteUrl.trim(), space_id: currentSpace.id },
            })

            if (error) throw error

            if (data.success && data.discovery) {
                setDiscovery(data.discovery)
                setEditableName(data.discovery.detected_name || '')
                // Select ALL pages by default
                setSelectedPages(new Set(
                    data.discovery.pages_found.map((p: { url: string }) => p.url)
                ))
                setSetupStatus('website_pending')
            }
        } catch (error) {
            console.error('Error discovering website:', error)
            alert('Failed to discover website. Please check the URL and try again.')
        } finally {
            setIsDiscovering(false)
        }
    }

    // Step 1b: Confirm website sources
    const handleConfirmSources = async () => {
        if (!currentSpace || selectedPages.size === 0) return

        setIsGeneratingProfile(true)
        try {
            // Call edge function with selected URLs - it handles confirmation and generation
            const { data, error } = await supabase.functions.invoke('generate-brand-profile', {
                body: {
                    space_id: currentSpace.id,
                    selected_urls: Array.from(selectedPages),
                    detected_name: editableName,
                },
            })

            if (error) throw error

            if (data.success && data.profile) {
                setProfile(data.profile)
                setEditedProfile(data.profile)
                setSetupStatus('profile_draft')
            } else if (data.error) {
                throw new Error(data.error)
            }
        } catch (error) {
            console.error('Error confirming sources:', error)
            alert('Failed to generate profile. Please try again.')
        } finally {
            setIsGeneratingProfile(false)
        }
    }

    // Step 2: Save profile
    const handleSaveProfile = async () => {
        if (!currentSpace || !editedProfile) return

        try {
            await supabase.from('brand_profile').upsert({
                space_id: currentSpace.id,
                ...editedProfile,
                is_system_generated: false,
                last_edited_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }, { onConflict: 'space_id' })

            await supabase.from('brand_context_cache').update({
                setup_status: 'ready',
                updated_at: new Date().toISOString(),
            }).eq('space_id', currentSpace.id)

            // Rename workspace to brand name if we have a detected name
            if (editableName && currentSpace.name !== editableName) {
                const { error: renameError } = await supabase.from('spaces').update({
                    name: editableName,
                    updated_at: new Date().toISOString(),
                }).eq('id', currentSpace.id)

                if (!renameError) {
                    // Update the space store with the new name
                    const { setCurrentSpace, setSpaces, spaces } = useSpaceStore.getState()
                    const updatedSpace = { ...currentSpace, name: editableName }
                    setCurrentSpace(updatedSpace)
                    setSpaces(spaces.map(s => s.id === currentSpace.id ? updatedSpace : s))
                }
            }

            setSetupStatus('ready')
        } catch (error) {
            console.error('Error saving profile:', error)
            alert('Failed to save profile.')
        }
    }

    // Logo upload handler
    const handleLogoUpload = async (file: File, type: 'main' | 'top-left' | 'bottom-right') => {
        if (!currentSpace) {
            console.error('No currentSpace available')
            return
        }

        console.log('Starting logo upload:', { type, fileName: file.name, fileSize: file.size, spaceId: currentSpace.id })
        setUploadingLogo(type)

        try {
            // Generate unique filename
            const ext = file.name.split('.').pop()
            const filename = `${currentSpace.id}/${type}-logo-${Date.now()}.${ext}`
            console.log('Upload filename:', filename)

            // Upload to storage
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('brand-assets')
                .upload(filename, file, { upsert: true })

            console.log('Storage upload result:', { uploadData, uploadError })
            if (uploadError) throw uploadError

            // Get public URL
            const { data: { publicUrl } } = supabase.storage
                .from('brand-assets')
                .getPublicUrl(filename)
            console.log('Public URL:', publicUrl)

            // Update profile - map type to field
            const fieldMap = {
                'main': 'logo_url',
                'top-left': 'logo_top_left_url',
                'bottom-right': 'logo_bottom_right_url',
            }
            const updateField = fieldMap[type]

            const { data: updateData, error: updateError } = await supabase.from('brand_profile').update({
                [updateField]: publicUrl,
                updated_at: new Date().toISOString(),
            }).eq('space_id', currentSpace.id).select()

            console.log('Database update result:', { updateData, updateError })
            if (updateError) throw updateError

            // Update local state
            if (editedProfile) {
                setEditedProfile({
                    ...editedProfile,
                    [updateField]: publicUrl,
                })
            }
            if (profile) {
                setProfile({
                    ...profile,
                    [updateField]: publicUrl,
                })
            }
            console.log('Logo upload complete:', publicUrl)
        } catch (error) {
            console.error('Error uploading logo:', error)
            alert(`Failed to upload logo: ${error instanceof Error ? error.message : 'Unknown error'}`)
        } finally {
            setUploadingLogo(null)
        }
    }

    // Delete logo handler
    const handleDeleteLogo = async (type: 'main' | 'top-left' | 'bottom-right') => {
        if (!currentSpace) return

        try {
            const fieldMap = {
                'main': 'logo_url',
                'top-left': 'logo_top_left_url',
                'bottom-right': 'logo_bottom_right_url',
            }
            const updateField = fieldMap[type]

            await supabase.from('brand_profile').update({
                [updateField]: null,
                updated_at: new Date().toISOString(),
            }).eq('space_id', currentSpace.id)

            // Update local state
            if (editedProfile) {
                setEditedProfile({
                    ...editedProfile,
                    [updateField]: null,
                })
            }
            if (profile) {
                setProfile({
                    ...profile,
                    [updateField]: null,
                })
            }
        } catch (error) {
            console.error('Error deleting logo:', error)
        }
    }

    // Update logo position
    const handleUpdateLogoPosition = async (type: 'main' | 'top-left' | 'bottom-right', position: string) => {
        if (!currentSpace) return

        try {
            const fieldMap = {
                'main': 'logo_position',
                'top-left': 'logo_top_left_position',
                'bottom-right': 'logo_bottom_right_position',
            }
            const updateField = fieldMap[type]

            await supabase.from('brand_profile').update({
                [updateField]: position,
                updated_at: new Date().toISOString(),
            }).eq('space_id', currentSpace.id)

            // Update local state
            if (editedProfile) {
                setEditedProfile({
                    ...editedProfile,
                    [updateField]: position,
                })
            }
            if (profile) {
                setProfile({
                    ...profile,
                    [updateField]: position,
                })
            }
        } catch (error) {
            console.error('Error updating logo position:', error)
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-[var(--color-gray-400)]" />
            </div>
        )
    }

    // Empty State - Show setup CTA
    if (setupStatus === 'empty') {
        return (
            <div className="p-8 flex items-center justify-center min-h-[600px]">
                <div className="text-center max-w-md">
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                        <Sparkles className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-2xl font-bold text-[var(--color-gray-900)] mb-3">
                        Set up Brand Studio
                    </h1>
                    <p className="text-[var(--color-gray-500)] mb-8">
                        We'll analyze your website to understand your brand, then generate a profile you can review and refine.
                    </p>

                    <div className="space-y-4">
                        <Input
                            placeholder="https://yourcompany.com"
                            value={websiteUrl}
                            onChange={(e) => setWebsiteUrl(e.target.value)}
                            className="text-center"
                        />
                        <Button
                            variant="pill"
                            onClick={handleDiscoverWebsite}
                            isLoading={isDiscovering}
                            disabled={!websiteUrl.trim()}
                            className="w-full"
                        >
                            <Globe className="w-4 h-4" />
                            Discover Website
                        </Button>
                    </div>
                </div>
            </div>
        )
    }

    // Step 1: Website Discovery Review
    if (setupStatus === 'website_pending' && discovery) {
        return (
            <div className="p-8 max-w-3xl mx-auto">
                <h1 className="text-2xl font-bold text-[var(--color-gray-900)] mb-2">Website Discovery</h1>
                <p className="text-[var(--color-gray-500)] mb-8">
                    Review what we found and confirm the sources to use for your brand profile.
                </p>

                {/* Detected Details */}
                <div className="bg-white rounded-xl border border-[var(--color-gray-200)] p-6 mb-6">
                    <h2 className="font-semibold text-[var(--color-gray-900)] mb-4">Detected Details</h2>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-[var(--color-gray-600)] mb-1">
                                Business Name
                            </label>
                            <Input
                                value={editableName}
                                onChange={(e) => setEditableName(e.target.value)}
                                placeholder="Your business name"
                            />
                        </div>

                        {discovery.detected_linkedin && (
                            <div className="flex items-center justify-between p-3 bg-[var(--color-gray-50)] rounded-lg">
                                <div className="flex items-center gap-2">
                                    <Building2 className="w-4 h-4 text-blue-600" />
                                    <span className="text-sm">LinkedIn detected</span>
                                    <span className={`text-xs px-2 py-0.5 rounded ${discovery.linkedin_confidence === 'high'
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-yellow-100 text-yellow-700'
                                        }`}>
                                        {discovery.linkedin_confidence} confidence
                                    </span>
                                </div>
                                <a
                                    href={discovery.detected_linkedin}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline text-sm flex items-center gap-1"
                                >
                                    View <ExternalLink className="w-3 h-3" />
                                </a>
                            </div>
                        )}
                    </div>
                </div>

                {/* Pages Found - Simplified */}
                <div className="bg-white rounded-xl border border-[var(--color-gray-200)] p-6 mb-6">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h2 className="font-semibold text-[var(--color-gray-900)]">
                                Found {discovery.pages_found.length} pages
                            </h2>
                            <p className="text-sm text-[var(--color-gray-500)]">
                                {selectedPages.size} pages will be used for your brand profile
                            </p>
                        </div>
                        <Check className="w-5 h-5 text-green-500" />
                    </div>

                    {/* Collapsible exclude section */}
                    <details className="text-sm">
                        <summary className="cursor-pointer text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)]">
                            Exclude specific pages (optional)
                        </summary>
                        <div className="mt-3 space-y-1 max-h-48 overflow-y-auto">
                            {discovery.pages_found.map((page) => (
                                <label
                                    key={page.url}
                                    className="flex items-center gap-2 p-2 rounded hover:bg-[var(--color-gray-50)] cursor-pointer"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedPages.has(page.url)}
                                        onChange={(e) => {
                                            const next = new Set(selectedPages)
                                            if (e.target.checked) {
                                                next.add(page.url)
                                            } else {
                                                next.delete(page.url)
                                            }
                                            setSelectedPages(next)
                                        }}
                                        className="w-4 h-4 rounded border-[var(--color-gray-300)]"
                                    />
                                    <span className="truncate text-[var(--color-gray-700)]">
                                        {page.title}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </details>
                </div>

                <div className="flex justify-end">
                    <Button
                        variant="pill"
                        onClick={handleConfirmSources}
                        isLoading={isGeneratingProfile}
                        disabled={selectedPages.size === 0}
                    >
                        Confirm Website Sources
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                </div>
            </div>
        )
    }

    // Step 2: Profile Review
    if (setupStatus === 'profile_draft' && editedProfile) {
        return (
            <div className="p-8 max-w-3xl mx-auto">
                <h1 className="text-2xl font-bold text-[var(--color-gray-900)] mb-2">Brand Profile (Draft)</h1>
                <p className="text-[var(--color-gray-500)] mb-8">
                    This is a starting point based on your website. Edit anything that needs refinement.
                </p>

                <div className="space-y-6">
                    {[
                        { key: 'who_we_are', label: 'Who We Are' },
                        { key: 'what_we_do', label: 'What We Do' },
                        { key: 'who_we_serve', label: 'Who We Serve' },
                        { key: 'tone_notes', label: 'How We Talk (Tone)' },
                    ].map(({ key, label }) => (
                        <div key={key} className="bg-white rounded-xl border border-[var(--color-gray-200)] p-6">
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="font-semibold text-[var(--color-gray-900)]">{label}</h2>
                                <span className="text-xs text-[var(--color-gray-400)]">AI-generated</span>
                            </div>
                            <textarea
                                value={editedProfile[key as keyof BrandProfile] as string || ''}
                                onChange={(e) => setEditedProfile({
                                    ...editedProfile,
                                    [key]: e.target.value,
                                })}
                                className="w-full px-3 py-2 border border-[var(--color-gray-200)] rounded-lg focus:ring-2 focus:ring-[var(--color-primary)] min-h-[100px] resize-none"
                                placeholder={`Describe ${label.toLowerCase()}...`}
                            />
                        </div>
                    ))}
                </div>

                <div className="flex justify-end mt-8">
                    <Button variant="pill" onClick={handleSaveProfile}>
                        Save Brand Profile
                        <Check className="w-4 h-4" />
                    </Button>
                </div>
            </div>
        )
    }

    // Ready State - Dashboard
    return (
        <div className="p-8 max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--color-gray-900)]">Brand Studio</h1>
                    <p className="text-[var(--color-gray-500)]">
                        Your brand is set up and ready for content generation
                    </p>
                </div>
                <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                    <Check className="w-4 h-4" />
                    Ready
                </span>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-6 mb-8">
                <div className="bg-white rounded-xl border border-[var(--color-gray-200)] p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                            <Globe className="w-5 h-5 text-blue-600" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-[var(--color-gray-900)]">Website Sources</h3>
                            <p className="text-sm text-[var(--color-gray-500)]">
                                {selectedPages.size} pages connected
                            </p>
                        </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setSetupStatus('website_pending')}>
                        <RefreshCw className="w-4 h-4" />
                        Rescan
                    </Button>
                </div>

                <div className="bg-white rounded-xl border border-[var(--color-gray-200)] p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                            <Sparkles className="w-5 h-5 text-purple-600" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-[var(--color-gray-900)]">Brand Profile</h3>
                            <p className="text-sm text-[var(--color-gray-500)]">
                                {profile?.who_we_are ? 'Complete' : 'Needs attention'}
                            </p>
                        </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setSetupStatus('profile_draft')}>
                        Edit Profile
                    </Button>
                </div>

                {/* SharePoint Card */}
                <div className={`bg-white rounded-xl border p-6 ${sharePointConnection?.token_expired
                    ? 'border-orange-300 bg-orange-50/50'
                    : sharePointConnection?.connected
                        ? 'border-green-200 bg-green-50/50'
                        : 'border-[var(--color-gray-200)]'
                    }`}>
                    <div className="flex items-center gap-3 mb-4">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${sharePointConnection?.token_expired
                            ? 'bg-orange-100'
                            : sharePointConnection?.connected
                                ? 'bg-green-100'
                                : 'bg-orange-100'
                            }`}>
                            <Building2 className={`w-5 h-5 ${sharePointConnection?.token_expired
                                ? 'text-orange-600'
                                : sharePointConnection?.connected
                                    ? 'text-green-600'
                                    : 'text-orange-600'
                                }`} />
                        </div>
                        <div>
                            <h3 className="font-semibold text-[var(--color-gray-900)]">SharePoint</h3>
                            <p className="text-sm text-[var(--color-gray-500)]">
                                {sharePointConnection?.token_expired
                                    ? `⚠️ Token expired - Reconnect required`
                                    : sharePointConnection?.connected
                                        ? `Connected as ${sharePointConnection.user_email}`
                                        : 'Not connected'}
                            </p>
                        </div>
                    </div>
                    {sharePointConnection?.connected && !sharePointConnection?.token_expired ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setShowSharePointPanel(!showSharePointPanel)
                                if (!showSharePointPanel && sharePointSites.length === 0) {
                                    fetchSharePointSites()
                                }
                            }}
                        >
                            <FolderOpen className="w-4 h-4" />
                            Browse & Sync
                            <ChevronDown className={`w-4 h-4 transition-transform ${showSharePointPanel ? 'rotate-180' : ''}`} />
                        </Button>
                    ) : (
                        <Button
                            variant={sharePointConnection?.token_expired ? 'pill' : 'ghost'}
                            size="sm"
                            onClick={async () => {
                                if (!currentSpace) return
                                const { data, error } = await supabase.functions.invoke('sharepoint-oauth', {
                                    body: { action: 'authorize', space_id: currentSpace.id, frontend_redirect: '/brand-studio' },
                                })
                                if (data?.auth_url) {
                                    window.location.href = data.auth_url
                                } else {
                                    console.error('SharePoint auth error:', error)
                                    alert('SharePoint not configured. Contact support.')
                                }
                            }}
                        >
                            <ExternalLink className="w-4 h-4" />
                            {sharePointConnection?.token_expired ? 'Reconnect' : 'Connect'}
                        </Button>
                    )}
                </div>
            </div>

            {/* Brand Assets Section */}
            <div className="bg-white rounded-xl border border-[var(--color-gray-200)] p-6 mb-8">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center">
                        <ImageIcon className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-[var(--color-gray-900)]">Brand Assets</h3>
                        <p className="text-sm text-[var(--color-gray-500)]">Logos for post overlays and branding</p>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                    {/* Main Logo Card */}
                    <div className="border border-[var(--color-gray-200)] rounded-xl p-4 bg-[var(--color-gray-50)]">
                        <h4 className="font-medium text-[var(--color-gray-900)] text-sm mb-1">Main Logo</h4>
                        <p className="text-xs text-[var(--color-gray-500)] mb-3">Primary brand logo</p>

                        <input
                            type="file"
                            ref={mainLogoInputRef}
                            accept="image/png,image/jpeg,image/svg+xml"
                            className="hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) handleLogoUpload(file, 'main')
                            }}
                        />

                        <div
                            onClick={() => mainLogoInputRef.current?.click()}
                            className="w-full h-24 border-2 border-dashed border-[var(--color-gray-300)] rounded-lg flex items-center justify-center cursor-pointer hover:border-[var(--color-primary)] hover:bg-white transition-colors mb-3"
                        >
                            {uploadingLogo === 'main' ? (
                                <Loader2 className="w-6 h-6 animate-spin text-[var(--color-primary)]" />
                            ) : profile?.logo_url && profile.logo_url.startsWith('http') && !brokenImages.has('main') ? (
                                <img
                                    src={profile.logo_url}
                                    alt="Main logo"
                                    className="max-h-20 max-w-full object-contain"
                                    onError={() => {
                                        console.error('Failed to load main logo:', profile?.logo_url)
                                        setBrokenImages(prev => new Set(prev).add('main'))
                                    }}
                                />
                            ) : (
                                <div className="text-center">
                                    <Upload className="w-6 h-6 text-[var(--color-gray-400)] mx-auto mb-1" />
                                    <span className="text-xs text-[var(--color-gray-500)]">Click to upload</span>
                                </div>
                            )}
                        </div>

                        <select
                            value={profile?.logo_position || 'bottom-right'}
                            onChange={(e) => handleUpdateLogoPosition('main', e.target.value)}
                            className="w-full px-2 py-1.5 text-xs border border-[var(--color-gray-200)] rounded-lg bg-white"
                        >
                            <option value="top-left">Top Left</option>
                            <option value="top-right">Top Right</option>
                            <option value="bottom-left">Bottom Left</option>
                            <option value="bottom-right">Bottom Right</option>
                            <option value="center">Center</option>
                        </select>
                    </div>

                    {/* Top-Left Logo Card */}
                    <div className="border border-[var(--color-gray-200)] rounded-xl p-4 bg-[var(--color-gray-50)]">
                        <h4 className="font-medium text-[var(--color-gray-900)] text-sm mb-1">Top-Left Logo</h4>
                        <p className="text-xs text-[var(--color-gray-500)] mb-3">Corner overlay</p>

                        <input
                            type="file"
                            ref={topLeftLogoInputRef}
                            accept="image/png,image/jpeg,image/svg+xml"
                            className="hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) handleLogoUpload(file, 'top-left')
                            }}
                        />

                        <div
                            onClick={() => topLeftLogoInputRef.current?.click()}
                            className="w-full h-24 border-2 border-dashed border-[var(--color-gray-300)] rounded-lg flex items-center justify-center cursor-pointer hover:border-[var(--color-primary)] hover:bg-white transition-colors mb-3"
                        >
                            {uploadingLogo === 'top-left' ? (
                                <Loader2 className="w-6 h-6 animate-spin text-[var(--color-primary)]" />
                            ) : profile?.logo_top_left_url && profile.logo_top_left_url.startsWith('http') && !brokenImages.has('top-left') ? (
                                <img
                                    src={profile.logo_top_left_url}
                                    alt="Top-left logo"
                                    className="max-h-20 max-w-full object-contain"
                                    onError={() => {
                                        console.error('Failed to load top-left logo:', profile?.logo_top_left_url)
                                        setBrokenImages(prev => new Set(prev).add('top-left'))
                                    }}
                                />
                            ) : (
                                <div className="text-center">
                                    <Upload className="w-6 h-6 text-[var(--color-gray-400)] mx-auto mb-1" />
                                    <span className="text-xs text-[var(--color-gray-500)]">Click to upload</span>
                                </div>
                            )}
                        </div>

                        <select
                            value={profile?.logo_top_left_position || 'top-left'}
                            onChange={(e) => handleUpdateLogoPosition('top-left', e.target.value)}
                            className="w-full px-2 py-1.5 text-xs border border-[var(--color-gray-200)] rounded-lg bg-white"
                        >
                            <option value="top-left">Top Left</option>
                            <option value="top-center">Top Center</option>
                            <option value="top-right">Top Right</option>
                        </select>
                    </div>

                    {/* Bottom-Right Logo Card */}
                    <div className="border border-[var(--color-gray-200)] rounded-xl p-4 bg-[var(--color-gray-50)]">
                        <h4 className="font-medium text-[var(--color-gray-900)] text-sm mb-1">Bottom-Right Logo</h4>
                        <p className="text-xs text-[var(--color-gray-500)] mb-3">Corner overlay</p>

                        <input
                            type="file"
                            ref={bottomRightLogoInputRef}
                            accept="image/png,image/jpeg,image/svg+xml"
                            className="hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) handleLogoUpload(file, 'bottom-right')
                            }}
                        />

                        <div
                            onClick={() => bottomRightLogoInputRef.current?.click()}
                            className="w-full h-24 border-2 border-dashed border-[var(--color-gray-300)] rounded-lg flex items-center justify-center cursor-pointer hover:border-[var(--color-primary)] hover:bg-white transition-colors mb-3"
                        >
                            {uploadingLogo === 'bottom-right' ? (
                                <Loader2 className="w-6 h-6 animate-spin text-[var(--color-primary)]" />
                            ) : profile?.logo_bottom_right_url && profile.logo_bottom_right_url.startsWith('http') && !brokenImages.has('bottom-right') ? (
                                <img
                                    src={profile.logo_bottom_right_url}
                                    alt="Bottom-right logo"
                                    className="max-h-20 max-w-full object-contain"
                                    onError={() => {
                                        console.error('Failed to load bottom-right logo:', profile?.logo_bottom_right_url)
                                        setBrokenImages(prev => new Set(prev).add('bottom-right'))
                                    }}
                                />
                            ) : (
                                <div className="text-center">
                                    <Upload className="w-6 h-6 text-[var(--color-gray-400)] mx-auto mb-1" />
                                    <span className="text-xs text-[var(--color-gray-500)]">Click to upload</span>
                                </div>
                            )}
                        </div>

                        <select
                            value={profile?.logo_bottom_right_position || 'bottom-right'}
                            onChange={(e) => handleUpdateLogoPosition('bottom-right', e.target.value)}
                            className="w-full px-2 py-1.5 text-xs border border-[var(--color-gray-200)] rounded-lg bg-white"
                        >
                            <option value="bottom-left">Bottom Left</option>
                            <option value="bottom-center">Bottom Center</option>
                            <option value="bottom-right">Bottom Right</option>
                        </select>
                    </div>
                </div>
            </div>


            {/* SharePoint Configuration Panel */}
            {showSharePointPanel && sharePointConnection?.connected && (
                <div className="bg-white rounded-xl border border-[var(--color-gray-200)] p-6 mb-8">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-[var(--color-gray-900)]">Browse SharePoint</h3>
                        <Button variant="ghost" size="sm" onClick={() => setShowSharePointPanel(false)}>
                            <X className="w-4 h-4" />
                        </Button>
                    </div>

                    {/* Breadcrumb */}
                    {sharePointBreadcrumb.length > 0 && (
                        <div className="flex items-center gap-2 text-sm text-[var(--color-gray-500)] mb-4">
                            <button
                                onClick={() => {
                                    setSelectedSite(null)
                                    setSelectedDrive(null)
                                    setSharePointItems([])
                                    setSharePointBreadcrumb([])
                                }}
                                className="hover:text-[var(--color-primary)]"
                            >
                                Sites
                            </button>
                            {selectedSite && (
                                <>
                                    <ChevronRight className="w-4 h-4" />
                                    <button
                                        onClick={() => {
                                            setSelectedDrive(null)
                                            setSharePointItems([])
                                            setSharePointBreadcrumb([])
                                        }}
                                        className="hover:text-[var(--color-primary)]"
                                    >
                                        {selectedSite.name}
                                    </button>
                                </>
                            )}
                            {sharePointBreadcrumb.map((crumb, i) => (
                                <div key={crumb.id} className="flex items-center gap-2">
                                    <ChevronRight className="w-4 h-4" />
                                    <span className={i === sharePointBreadcrumb.length - 1 ? 'text-[var(--color-gray-900)]' : ''}>
                                        {crumb.name}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}

                    {isLoadingSharePoint ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-6 h-6 animate-spin text-[var(--color-gray-400)]" />
                        </div>
                    ) : !selectedSite ? (
                        // Show sites
                        <div className="grid grid-cols-2 gap-3">
                            {sharePointSites.length === 0 ? (
                                <p className="text-sm text-[var(--color-gray-500)] col-span-2">No SharePoint sites found.</p>
                            ) : (
                                sharePointSites.map(site => (
                                    <button
                                        key={site.id}
                                        onClick={() => fetchSharePointDrives(site)}
                                        className="flex items-center gap-3 p-3 rounded-lg border border-[var(--color-gray-200)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 transition-colors text-left"
                                    >
                                        <Building2 className="w-5 h-5 text-[var(--color-gray-400)]" />
                                        <div>
                                            <p className="font-medium text-sm text-[var(--color-gray-900)]">{site.name}</p>
                                            <p className="text-xs text-[var(--color-gray-500)] truncate">{site.url}</p>
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    ) : !selectedDrive ? (
                        // Show drives
                        <div className="grid grid-cols-2 gap-3">
                            {sharePointDrives.length === 0 ? (
                                <p className="text-sm text-[var(--color-gray-500)] col-span-2">No document libraries found.</p>
                            ) : (
                                sharePointDrives.map(drive => (
                                    <button
                                        key={drive.id}
                                        onClick={() => fetchSharePointItems(drive)}
                                        className="flex items-center gap-3 p-3 rounded-lg border border-[var(--color-gray-200)] hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 transition-colors text-left"
                                    >
                                        <FolderOpen className="w-5 h-5 text-[var(--color-gray-400)]" />
                                        <div>
                                            <p className="font-medium text-sm text-[var(--color-gray-900)]">{drive.name}</p>
                                            <p className="text-xs text-[var(--color-gray-500)]">{drive.type}</p>
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    ) : (
                        // Show items
                        <div>
                            <div className="grid grid-cols-2 gap-3 max-h-[300px] overflow-y-auto mb-4">
                                {sharePointItems.length === 0 ? (
                                    <p className="text-sm text-[var(--color-gray-500)] col-span-2">This folder is empty.</p>
                                ) : (
                                    sharePointItems.map(item => (
                                        <button
                                            key={item.id}
                                            onClick={() => {
                                                if (item.is_folder && selectedDrive) {
                                                    fetchSharePointItems(selectedDrive, item.id, item.name)
                                                }
                                            }}
                                            className={`flex items-center gap-3 p-3 rounded-lg border border-[var(--color-gray-200)] text-left ${item.is_folder
                                                ? 'hover:border-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 cursor-pointer'
                                                : 'opacity-60 cursor-default'
                                                }`}
                                        >
                                            <FolderOpen className={`w-5 h-5 ${item.is_folder ? 'text-amber-500' : 'text-[var(--color-gray-400)]'}`} />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-sm text-[var(--color-gray-900)] truncate">{item.name}</p>
                                                {item.is_folder && item.child_count !== undefined && (
                                                    <p className="text-xs text-[var(--color-gray-500)]">{item.child_count} items</p>
                                                )}
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                            <div className="flex justify-end pt-4 border-t border-[var(--color-gray-200)]">
                                <Button variant="pill" onClick={handleStartSharePointSync}>
                                    Sync This Folder
                                    <ArrowRight className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Quick Preview */}
            {profile && (
                <div className="bg-white rounded-xl border border-[var(--color-gray-200)] p-6 mb-8">
                    <h3 className="font-semibold text-[var(--color-gray-900)] mb-4">Profile Summary</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <span className="text-[var(--color-gray-500)]">Who we are:</span>
                            <p className="text-[var(--color-gray-700)] line-clamp-2">{profile.who_we_are || '—'}</p>
                        </div>
                        <div>
                            <span className="text-[var(--color-gray-500)]">What we do:</span>
                            <p className="text-[var(--color-gray-700)] line-clamp-2">{profile.what_we_do || '—'}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* CTA */}
            <div className="flex justify-center">
                <Button variant="pill" onClick={() => window.location.href = '/campaigns'}>
                    Create Campaign
                    <ArrowRight className="w-4 h-4" />
                </Button>
            </div>

            {/* Sync Modal */}
            {showSyncModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 max-w-lg w-full mx-4 shadow-xl">
                        {!isSyncing ? (
                            <>
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold text-[var(--color-gray-900)]">
                                        📊 Sync Estimate
                                    </h3>
                                    <button onClick={() => setShowSyncModal(false)} className="text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)]">
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>

                                {syncScanResult && (
                                    <div className="space-y-4">
                                        <div className="bg-[var(--color-gray-50)] rounded-lg p-4 space-y-2">
                                            <div className="flex justify-between">
                                                <span className="text-[var(--color-gray-600)]">Documents found:</span>
                                                <span className="font-medium">{syncScanResult.total_files} files</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-[var(--color-gray-600)]">Supported formats:</span>
                                                <span className="font-medium text-green-600">{syncScanResult.supported_files} (.docx, .pdf, etc)</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-[var(--color-gray-600)]">Skipping:</span>
                                                <span className="text-[var(--color-gray-400)]">{syncScanResult.skipped_files} (unsupported)</span>
                                            </div>
                                        </div>

                                        <div className="border-t border-[var(--color-gray-200)] pt-4 space-y-2">
                                            <div className="flex justify-between">
                                                <span className="text-[var(--color-gray-600)]">Estimated tokens:</span>
                                                <span className="font-medium">~{syncScanResult.estimated_tokens.toLocaleString()}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-[var(--color-gray-600)]">💵 Estimated cost:</span>
                                                <span className="font-bold text-[var(--color-primary)]">${syncScanResult.estimated_cost.toFixed(2)}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-[var(--color-gray-600)]">⏱️ Estimated time:</span>
                                                <span className="font-medium">~{syncScanResult.estimated_time_minutes} minutes</span>
                                            </div>
                                        </div>

                                        <p className="text-sm text-[var(--color-gray-500)]">
                                            This will extract knowledge and generate training examples for your custom AI model. Progress is saved automatically.
                                        </p>

                                        <div className="flex gap-3 pt-2">
                                            <Button variant="ghost" className="flex-1" onClick={() => setShowSyncModal(false)}>
                                                Cancel
                                            </Button>
                                            <Button variant="pill" className="flex-1" onClick={handleConfirmSync}>
                                                Start Sync
                                                <ArrowRight className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                <h3 className="text-lg font-semibold text-[var(--color-gray-900)] mb-4">
                                    📂 Syncing Documents...
                                </h3>

                                {syncProgress && (
                                    <div className="space-y-4">
                                        <div className="relative pt-1">
                                            <div className="flex mb-2 items-center justify-between">
                                                <span className="text-sm font-medium text-[var(--color-gray-700)]">
                                                    {syncProgress.processed} of {syncProgress.total} documents
                                                </span>
                                                <span className="text-sm font-medium text-[var(--color-primary)]">
                                                    {syncProgress.total > 0 ? Math.round((syncProgress.processed / syncProgress.total) * 100) : 0}%
                                                </span>
                                            </div>
                                            <div className="overflow-hidden h-3 text-xs flex rounded-full bg-[var(--color-gray-200)]">
                                                <div
                                                    style={{ width: `${syncProgress.total > 0 ? (syncProgress.processed / syncProgress.total) * 100 : 0}%` }}
                                                    className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] transition-all duration-500"
                                                />
                                            </div>
                                        </div>

                                        <p className="text-sm text-[var(--color-gray-500)]">
                                            Status: {syncProgress.status}
                                        </p>

                                        <p className="text-xs text-[var(--color-gray-400)]">
                                            ✓ Progress auto-saves every batch. You can close this dialog.
                                        </p>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
