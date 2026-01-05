import { useState, useEffect, useCallback } from 'react'
import { Plus, Image as ImageIcon, Paintbrush, Eye, MoreHorizontal, ChevronDown, Copy, Download, Check, X, Sparkles, Layers, Loader2, Trash2 } from 'lucide-react'
import { Button, StatusBadge, Modal } from '@/components/ui'
import { ImageModal } from '@/components/posts/ImageModal'
import { supabase } from '@/lib/supabase'
import { useSpaceStore } from '@/stores/spaceStore'
import { useAuthStore } from '@/stores/authStore'
import type { ImageStatus, ImageSettings, PromptStyle } from '@/types/image'
import { IMAGE_STATUS_LABELS, IMAGE_STATUS_COLORS } from '@/types/image'

type Tab = 'all' | 'drafts' | 'selected' | 'sent'
type BulkScope = 'selected' | 'view' | 'batch'

interface Post {
    id: string
    title: string
    topic: string | null
    status: string
    body: string | null
    author_id: string
    likes: number
    comments: number
    space_id: string
    campaign_id: string | null
    created_at: string
    generated_image_path: string | null
    final_image_path: string | null
    campaign?: { name: string } | null
    // New image fields
    image_prompt: string | null
    image_prompt_style: PromptStyle | null
    image_settings: ImageSettings | null
    image_status: ImageStatus
}

export function Posts() {
    const { currentSpace } = useSpaceStore()
    const { user } = useAuthStore()
    const [posts, setPosts] = useState<Post[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
    const [activeTab, setActiveTab] = useState<Tab>('all')
    const [showBulkGenerateModal, setShowBulkGenerateModal] = useState(false)
    const [showBulkActions, setShowBulkActions] = useState(false)
    const [exportPost, setExportPost] = useState<Post | null>(null)
    const [copiedText, setCopiedText] = useState(false)
    const [imageModalPost, setImageModalPost] = useState<Post | null>(null)

    // Filter states
    const [activeFilters, setActiveFilters] = useState<string[]>([])

    // Bulk operations state
    const [isBulkGeneratingImages, setIsBulkGeneratingImages] = useState(false)
    const [bulkImageProgress, setBulkImageProgress] = useState({ current: 0, total: 0 })
    const [isBulkApplyingLogos, setIsBulkApplyingLogos] = useState(false)
    const [bulkLogoProgress, setBulkLogoProgress] = useState({ current: 0, total: 0 })
    const [showBulkLogoModal, setShowBulkLogoModal] = useState(false)
    const [bulkLogoOptions, setBulkLogoOptions] = useState({
        randomizePrimary: true,
        randomizeLogo: true,
    })
    const [imageStatusRefresh, setImageStatusRefresh] = useState(0)

    // Status change state
    const [statusDropdownPostId, setStatusDropdownPostId] = useState<string | null>(null)
    const [showBulkStatusModal, setShowBulkStatusModal] = useState(false)
    const [selectedBulkStatus, setSelectedBulkStatus] = useState<string>('published')

    // Available statuses for dropdown
    const availableStatuses: { value: string; label: string; color: string }[] = [
        { value: 'draft', label: 'Draft', color: 'bg-blue-100 text-blue-800' },
        { value: 'ready_to_publish', label: 'Ready', color: 'bg-purple-100 text-purple-800' },
        { value: 'scheduled', label: 'Scheduled', color: 'bg-indigo-100 text-indigo-800' },
        { value: 'published', label: 'Published', color: 'bg-green-100 text-green-800' },
    ]

    const fetchPosts = useCallback(async () => {
        if (!currentSpace) return

        setIsLoading(true)
        try {
            let query = supabase
                .from('posts')
                .select('*, campaign:campaigns(name)')
                .eq('space_id', currentSpace.id)
                .order('created_at', { ascending: false })

            // Apply tab filter
            if (activeTab === 'drafts') {
                query = query.in('status', ['draft', 'generating_text', 'generating_image'])
            } else if (activeTab === 'selected') {
                query = query.eq('status', 'selected_to_publish')
            } else if (activeTab === 'sent') {
                query = query.eq('status', 'sent_to_hubspot')
            }

            const { data, error } = await query

            if (error) throw error
            setPosts(data || [])
        } catch (error) {
            console.error('Error fetching posts:', error)
        } finally {
            setIsLoading(false)
        }
    }, [currentSpace, activeTab])

    useEffect(() => {
        fetchPosts()
    }, [fetchPosts])

    // Count posts by status
    const allCount = posts.length
    const draftsCount = posts.filter(p => p.status === 'draft' || p.status === 'generating_text' || p.status === 'generating_image').length
    const selectedCount = posts.filter(p => p.status === 'selected_to_publish').length
    const sentCount = posts.filter(p => p.status === 'sent_to_hubspot').length

    const toggleFilter = (filter: string) => {
        setActiveFilters(prev =>
            prev.includes(filter)
                ? prev.filter(f => f !== filter)
                : [...prev, filter]
        )
    }

    const toggleSelectAll = () => {
        if (selectedIds.size === posts.length) {
            setSelectedIds(new Set())
        } else {
            setSelectedIds(new Set(posts.map(p => p.id)))
        }
    }

    const toggleSelect = (id: string) => {
        const next = new Set(selectedIds)
        if (next.has(id)) {
            next.delete(id)
        } else {
            next.add(id)
        }
        setSelectedIds(next)
    }

    const handleBulkAction = async (action: 'generate_text' | 'generate_image' | 'apply_logos', scope: BulkScope) => {
        let targetIds: string[] = []

        if (scope === 'selected') {
            targetIds = Array.from(selectedIds)
        } else if (scope === 'view') {
            targetIds = posts.map(p => p.id)
        }

        if (targetIds.length === 0) {
            alert('No posts selected')
            return
        }

        setShowBulkActions(false)

        if (action === 'generate_text') {
            await handleGenerateText(targetIds)
        } else {
            console.log(`Bulk ${action} for ${targetIds.length} posts`)
        }
    }

    const handleGenerateText = async (postIds: string[]) => {
        if (!currentSpace) return

        try {
            // Optimistically update status
            setPosts(prev => prev.map(p =>
                postIds.includes(p.id) ? { ...p, status: 'generating_text' } : p
            ))

            // Call the edge function
            const { data, error } = await supabase.functions.invoke('generate-posts', {
                body: {
                    post_ids: postIds,
                    space_id: currentSpace.id,
                },
            })

            if (error) throw error

            console.log('Generate text result:', data)

            // Refresh posts to get updated content
            await fetchPosts()
        } catch (error) {
            console.error('Error generating text:', error)
            alert(error instanceof Error ? error.message : 'Failed to generate text')
            await fetchPosts()
        }
    }

    const handleGenerateImage = async (postId: string) => {
        if (!currentSpace) return

        try {
            // Optimistically update status
            setPosts(prev => prev.map(p =>
                p.id === postId ? { ...p, status: 'generating_image' } : p
            ))

            // Call the edge function
            const { data, error } = await supabase.functions.invoke('generate-image', {
                body: {
                    post_id: postId,
                    space_id: currentSpace.id,
                },
            })

            if (error) throw error

            console.log('Generate image result:', data)

            // Refresh posts to get updated content
            await fetchPosts()
        } catch (error) {
            console.error('Error generating image:', error)
            alert(error instanceof Error ? error.message : 'Failed to generate image')
            await fetchPosts()
        }
    }

    const handleComposeImage = async (postId: string) => {
        if (!currentSpace) return

        try {
            // Optimistically update status
            setPosts(prev => prev.map(p =>
                p.id === postId ? { ...p, status: 'compositing' } : p
            ))

            // Call the edge function
            const { data, error } = await supabase.functions.invoke('compose-image', {
                body: {
                    post_id: postId,
                    space_id: currentSpace.id,
                },
            })

            if (error) throw error

            console.log('Compose image result:', data)

            // Refresh posts to get updated content
            await fetchPosts()
        } catch (error) {
            console.error('Error composing image:', error)
            alert(error instanceof Error ? error.message : 'Failed to compose image')
            await fetchPosts()
        }
    }

    const handleSelectToPublish = async (postId: string) => {
        try {
            // Update status to selected_to_publish and create snapshot
            const post = posts.find(p => p.id === postId)
            if (!post) return

            const { error } = await supabase
                .from('posts')
                .update({
                    status: 'selected_to_publish',
                    publish_snapshot: {
                        body: post.body,
                        title: post.title,
                        selected_at: new Date().toISOString(),
                    },
                    updated_at: new Date().toISOString(),
                })
                .eq('id', postId)

            if (error) throw error

            await fetchPosts()
        } catch (error) {
            console.error('Error selecting post:', error)
            alert(error instanceof Error ? error.message : 'Failed to select post')
        }
    }

    const handleSendToHubSpot = async (postId: string) => {
        if (!currentSpace) return

        try {
            // Call the HubSpot send edge function
            const { data, error } = await supabase.functions.invoke('hubspot-send', {
                body: {
                    post_id: postId,
                    space_id: currentSpace.id,
                },
            })

            if (error) throw error

            console.log('HubSpot send result:', data)
            await fetchPosts()
        } catch (error) {
            console.error('Error sending to HubSpot:', error)
            alert(error instanceof Error ? error.message : 'Failed to send to HubSpot. Make sure HubSpot is connected.')
        }
    }

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return

        if (!confirm(`Delete ${selectedIds.size} selected post(s)? This cannot be undone.`)) return

        try {
            const { error } = await supabase
                .from('posts')
                .delete()
                .in('id', Array.from(selectedIds))

            if (error) throw error

            setSelectedIds(new Set())
            await fetchPosts()
        } catch (error) {
            console.error('Error deleting posts:', error)
            alert('Failed to delete posts')
        }
    }

    // Change status for a single post
    const handleChangePostStatus = async (postId: string, newStatus: string) => {
        try {
            await supabase
                .from('posts')
                .update({ status: newStatus, updated_at: new Date().toISOString() })
                .eq('id', postId)

            // Update local state
            setPosts(prev => prev.map(p => p.id === postId ? { ...p, status: newStatus } : p))
            setStatusDropdownPostId(null)
        } catch (err) {
            console.error('Failed to change status:', err)
        }
    }

    // Bulk change status for selected posts
    const handleBulkChangeStatus = async () => {
        if (selectedIds.size === 0) return

        setShowBulkStatusModal(false)

        try {
            await supabase
                .from('posts')
                .update({ status: selectedBulkStatus, updated_at: new Date().toISOString() })
                .in('id', Array.from(selectedIds))

            // Update local state
            setPosts(prev => prev.map(p =>
                selectedIds.has(p.id) ? { ...p, status: selectedBulkStatus } : p
            ))
            setSelectedIds(new Set())
        } catch (err) {
            console.error('Failed to bulk change status:', err)
        }
    }

    // Bulk generate images for selected posts
    const handleBulkGenerateImages = async () => {
        if (selectedIds.size === 0 || !currentSpace) return

        setIsBulkGeneratingImages(true)
        setBulkImageProgress({ current: 0, total: selectedIds.size })

        const postIds = Array.from(selectedIds)
        let successCount = 0
        let errorCount = 0

        for (let i = 0; i < postIds.length; i++) {
            const postId = postIds[i]
            setBulkImageProgress({ current: i, total: postIds.length })

            try {
                // Fetch the post to get its prompt and settings
                const { data: post, error: fetchError } = await supabase
                    .from('posts')
                    .select('body, image_prompt, image_settings')
                    .eq('id', postId)
                    .single()

                if (fetchError || !post) {
                    console.error(`Failed to fetch post ${postId}:`, fetchError)
                    errorCount++
                    continue
                }

                // Use image_prompt if available, otherwise generate from body
                const prompt = post.image_prompt ||
                    `Professional LinkedIn post image about: ${post.body?.slice(0, 200) || 'business content'}`

                const settings = post.image_settings || {
                    style: 'photographic',
                    include_people: true,
                    include_text: false,
                    include_logos: false,
                    aspect_ratio: '1:1',
                }

                // Generate images for this post
                const { data, error } = await supabase.functions.invoke('generate-post-images', {
                    body: {
                        post_id: postId,
                        space_id: currentSpace.id,
                        prompt,
                        settings,
                        count: 2,
                    },
                })

                if (error) {
                    console.error(`Edge function error for post ${postId}:`, error)
                    errorCount++
                } else if (data?.success) {
                    successCount++
                    console.log(`Generated ${data.total_generated} images for post ${postId}`)
                } else {
                    console.error(`Generation failed for post ${postId}:`, data?.error)
                    errorCount++
                }

                // Small delay between requests to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000))
            } catch (err) {
                console.error(`Failed to generate images for post ${postId}:`, err)
                errorCount++
            }
        }

        setBulkImageProgress({ current: postIds.length, total: postIds.length })
        setIsBulkGeneratingImages(false)
        setImageStatusRefresh(prev => prev + 1)
        setSelectedIds(new Set())
        await fetchPosts()

        // Show summary
        if (errorCount > 0) {
            alert(`Completed: ${successCount} successful, ${errorCount} failed. Check console for details.`)
        }
    }

    // Bulk apply logos to selected posts
    const handleBulkApplyLogos = async () => {
        if (selectedIds.size === 0 || !currentSpace) return

        setShowBulkLogoModal(false)
        setIsBulkApplyingLogos(true)
        setBulkLogoProgress({ current: 0, total: selectedIds.size })

        const { data: brand } = await supabase
            .from('brand_profile')
            .select('logo_url, logo_top_left_url, logo_bottom_right_url')
            .eq('space_id', currentSpace.id)
            .single()

        if (!brand) {
            alert('No brand profile found. Please set up your logos in Brand Settings.')
            setIsBulkApplyingLogos(false)
            return
        }

        const postIds = Array.from(selectedIds)
        const logoOptions = [
            { topLeft: brand.logo_url, bottomRight: brand.logo_bottom_right_url },
            { topLeft: brand.logo_top_left_url, bottomRight: brand.logo_bottom_right_url },
            { topLeft: brand.logo_url, bottomRight: null },
            { topLeft: brand.logo_top_left_url, bottomRight: null },
            { topLeft: null, bottomRight: brand.logo_bottom_right_url },
        ].filter(opt => opt.topLeft || opt.bottomRight)

        for (let i = 0; i < postIds.length; i++) {
            const postId = postIds[i]
            setBulkLogoProgress({ current: i, total: postIds.length })

            try {
                const { data: images } = await supabase
                    .from('post_images')
                    .select('*')
                    .eq('post_id', postId)
                    .eq('space_id', currentSpace.id)
                    .eq('generation_status', 'completed')

                if (!images || images.length === 0) continue

                const eligibleImages = images.filter(img => !img.prompt_used?.startsWith('[LOGO OVERLAY]'))
                if (eligibleImages.length === 0) continue

                const sourceImage = bulkLogoOptions.randomizePrimary
                    ? eligibleImages[Math.floor(Math.random() * eligibleImages.length)]
                    : eligibleImages[0]

                const logoConfig = bulkLogoOptions.randomizeLogo && logoOptions.length > 0
                    ? logoOptions[Math.floor(Math.random() * logoOptions.length)]
                    : { topLeft: brand.logo_url || brand.logo_top_left_url, bottomRight: brand.logo_bottom_right_url }

                const { data: urlData } = supabase.storage
                    .from('generated-images')
                    .getPublicUrl(sourceImage.storage_path)

                const loadImage = (url: string): Promise<HTMLImageElement> => {
                    return new Promise((resolve, reject) => {
                        const img = new window.Image()
                        img.crossOrigin = 'anonymous'
                        img.onload = () => resolve(img)
                        img.onerror = () => reject(new Error(`Failed to load: ${url}`))
                        img.src = url
                    })
                }

                const sourceImg = await loadImage(urlData.publicUrl)
                const canvas = document.createElement('canvas')
                canvas.width = sourceImg.naturalWidth || sourceImg.width
                canvas.height = sourceImg.naturalHeight || sourceImg.height
                const ctx = canvas.getContext('2d')
                if (!ctx) continue

                ctx.drawImage(sourceImg, 0, 0)

                const marginPercent = 0.03
                const maxLogoSizePercent = 0.15

                if (logoConfig.topLeft) {
                    try {
                        const logoImg = await loadImage(logoConfig.topLeft)
                        const maxLogoWidth = canvas.width * maxLogoSizePercent
                        const maxLogoHeight = canvas.height * maxLogoSizePercent
                        const logoAspect = logoImg.width / logoImg.height
                        let logoWidth = maxLogoWidth
                        let logoHeight = logoWidth / logoAspect
                        if (logoHeight > maxLogoHeight) {
                            logoHeight = maxLogoHeight
                            logoWidth = logoHeight * logoAspect
                        }
                        ctx.drawImage(logoImg, canvas.width * marginPercent, canvas.height * marginPercent, logoWidth, logoHeight)
                    } catch { }
                }

                if (logoConfig.bottomRight) {
                    try {
                        const logoImg = await loadImage(logoConfig.bottomRight)
                        const maxLogoWidth = canvas.width * maxLogoSizePercent
                        const maxLogoHeight = canvas.height * maxLogoSizePercent
                        const logoAspect = logoImg.width / logoImg.height
                        let logoWidth = maxLogoWidth
                        let logoHeight = logoWidth / logoAspect
                        if (logoHeight > maxLogoHeight) {
                            logoHeight = maxLogoHeight
                            logoWidth = logoHeight * logoAspect
                        }
                        ctx.drawImage(logoImg, canvas.width - logoWidth - (canvas.width * marginPercent), canvas.height - logoHeight - (canvas.height * marginPercent), logoWidth, logoHeight)
                    } catch { }
                }

                const blob = await new Promise<Blob>((resolve, reject) => {
                    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Failed')), 'image/png', 1.0)
                })

                const timestamp = Date.now()
                const fileName = `${postId}/${timestamp}_with_logo.png`

                await supabase.storage
                    .from('generated-images')
                    .upload(fileName, blob, { contentType: 'image/png', upsert: true })

                await supabase.from('post_images').insert({
                    post_id: postId,
                    space_id: currentSpace.id,
                    source_type: 'generated',
                    storage_path: fileName,
                    generation_status: 'completed',
                    is_primary: true,
                    width: canvas.width,
                    height: canvas.height,
                    file_size: blob.size,
                    mime_type: 'image/png',
                    prompt_used: `[LOGO OVERLAY] ${logoConfig.topLeft ? 'top-left' : ''} ${logoConfig.bottomRight ? 'bottom-right' : ''} (from ${sourceImage.id})`,
                })

                await supabase.from('post_images')
                    .update({ is_primary: false })
                    .eq('post_id', postId)
                    .neq('storage_path', fileName)

            } catch (err) {
                console.error(`Failed to apply logo for post ${postId}:`, err)
            }
        }

        setBulkLogoProgress({ current: postIds.length, total: postIds.length })
        setIsBulkApplyingLogos(false)
        setImageStatusRefresh(prev => prev + 1)
        setSelectedIds(new Set())
        await fetchPosts()
    }

    const tabs: { key: Tab; label: string; count: number }[] = [
        { key: 'all', label: 'All', count: allCount },
        { key: 'drafts', label: 'Drafts', count: draftsCount },
        { key: 'selected', label: 'Selected', count: selectedCount },
        { key: 'sent', label: 'Sent', count: sentCount },
    ]

    const filterOptions = ['Title', 'Author', 'Spaces', 'Topics']

    return (
        <div className="p-8 bg-white min-h-screen">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-semibold text-[var(--color-gray-900)]">All Posts</h1>
                <Button variant="pill" onClick={() => setShowBulkGenerateModal(true)}>
                    New post
                </Button>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-6 mb-6">
                {tabs.map((tab) => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`text-sm font-medium transition-colors ${activeTab === tab.key
                            ? 'text-[var(--color-gray-900)]'
                            : 'text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)]'
                            }`}
                    >
                        {tab.label} <span className={activeTab === tab.key ? 'text-[var(--color-gray-900)]' : 'text-[var(--color-gray-400)]'}>{tab.count}</span>
                    </button>
                ))}
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-2 mb-6">
                {filterOptions.map((filter) => (
                    <button
                        key={filter}
                        onClick={() => toggleFilter(filter)}
                        className={`
              inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm border transition-colors
              ${activeFilters.includes(filter)
                                ? 'bg-[var(--color-gray-100)] border-[var(--color-gray-300)] text-[var(--color-gray-700)]'
                                : 'bg-white border-[var(--color-gray-200)] text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'
                            }
            `}
                    >
                        <Plus className="w-3 h-3" />
                        {filter}
                    </button>
                ))}
            </div>

            {/* Posts count and Bulk actions */}
            <div className="flex items-center gap-4 mb-4">
                <span className="text-sm text-[var(--color-gray-600)]">
                    {posts.length} posts {selectedIds.size > 0 && `(${selectedIds.size} selected)`}
                </span>
                <div className="relative">
                    <button
                        onClick={() => setShowBulkActions(!showBulkActions)}
                        disabled={isBulkGeneratingImages || isBulkApplyingLogos}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm border border-[var(--color-gray-200)] text-[var(--color-gray-600)] hover:bg-[var(--color-gray-50)] disabled:opacity-50"
                    >
                        Bulk actions
                        <ChevronDown className="w-4 h-4" />
                    </button>
                    {showBulkActions && (
                        <>
                            <div className="fixed inset-0" onClick={() => setShowBulkActions(false)} />
                            <div className="absolute left-0 top-full mt-1 w-64 bg-white rounded-lg shadow-lg border border-[var(--color-gray-200)] py-1 z-10">
                                <button
                                    className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--color-gray-50)] text-[var(--color-gray-700)] font-medium"
                                    onClick={() => handleBulkAction('generate_text', 'selected')}
                                >
                                    ✨ Generate Text ({selectedIds.size})
                                </button>
                                <div className="border-t border-[var(--color-gray-100)] my-1" />
                                <button
                                    className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--color-gray-50)] text-[var(--color-gray-700)] flex items-center gap-2"
                                    onClick={() => { setShowBulkActions(false); handleBulkGenerateImages(); }}
                                    disabled={selectedIds.size === 0}
                                >
                                    <Sparkles className="w-4 h-4" />
                                    Generate Images ({selectedIds.size})
                                </button>
                                <button
                                    className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--color-gray-50)] text-purple-700 flex items-center gap-2"
                                    onClick={() => { setShowBulkActions(false); setShowBulkLogoModal(true); }}
                                    disabled={selectedIds.size === 0}
                                >
                                    <Layers className="w-4 h-4" />
                                    Apply Logos ({selectedIds.size})
                                </button>
                                <button
                                    className="w-full px-4 py-2 text-left text-sm hover:bg-[var(--color-gray-50)] text-indigo-700 flex items-center gap-2"
                                    onClick={() => { setShowBulkActions(false); setShowBulkStatusModal(true); }}
                                    disabled={selectedIds.size === 0}
                                >
                                    <Check className="w-4 h-4" />
                                    Change Status ({selectedIds.size})
                                </button>
                                <div className="border-t border-[var(--color-gray-100)] my-1" />
                                <button
                                    className="w-full px-4 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"
                                    onClick={handleBulkDelete}
                                    disabled={selectedIds.size === 0}
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Delete Selected ({selectedIds.size})
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="border-t border-[var(--color-gray-200)]">
                {/* Table Header */}
                <div className="grid grid-cols-[auto_1fr_120px_150px_150px_120px_80px_100px] gap-4 items-center py-3 text-xs font-medium text-[var(--color-gray-500)] uppercase tracking-wider border-b border-[var(--color-gray-100)]">
                    <div className="pl-4">
                        <input
                            type="checkbox"
                            checked={posts.length > 0 && selectedIds.size === posts.length}
                            onChange={toggleSelectAll}
                            className="w-4 h-4 rounded border-[var(--color-gray-300)] text-[var(--color-primary)]"
                        />
                    </div>
                    <div>Title</div>
                    <div>Status</div>
                    <div>Campaign</div>
                    <div>Author</div>
                    <div>Space</div>
                    <div className="text-center">Likes</div>
                    <div></div>
                </div>

                {/* Table Body */}
                {isLoading ? (
                    <div className="py-12 text-center text-[var(--color-gray-500)]">
                        Loading posts...
                    </div>
                ) : posts.length === 0 ? (
                    <div className="py-12 text-center text-[var(--color-gray-500)]">
                        No posts found. Click "New post" to create one!
                    </div>
                ) : (
                    posts.map((post) => (
                        <div
                            key={post.id}
                            className={`
                grid grid-cols-[auto_1fr_120px_150px_150px_120px_80px_100px] gap-4 items-center py-4 border-b border-[var(--color-gray-100)]
                hover:bg-[var(--color-gray-50)] transition-colors
                ${selectedIds.has(post.id) ? 'bg-blue-50' : ''}
              `}
                        >
                            <div className="pl-4">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.has(post.id)}
                                    onChange={() => toggleSelect(post.id)}
                                    className="w-4 h-4 rounded border-[var(--color-gray-300)] text-[var(--color-primary)]"
                                />
                            </div>
                            <div className="font-medium text-[var(--color-gray-900)]">
                                {post.title}
                            </div>
                            <div className="relative">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setStatusDropdownPostId(statusDropdownPostId === post.id ? null : post.id)
                                    }}
                                >
                                    <StatusBadge status={post.status as any} className="cursor-pointer hover:ring-2 hover:ring-[var(--color-primary)]/30" />
                                </button>
                                {statusDropdownPostId === post.id && (
                                    <>
                                        <div className="fixed inset-0" onClick={() => setStatusDropdownPostId(null)} />
                                        <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-[var(--color-gray-200)] py-1 z-20 min-w-[120px]">
                                            {availableStatuses.map(status => (
                                                <button
                                                    key={status.value}
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleChangePostStatus(post.id, status.value)
                                                    }}
                                                    className={`w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-[var(--color-gray-50)] ${post.status === status.value ? 'bg-[var(--color-gray-50)]' : ''
                                                        }`}
                                                >
                                                    <span className={`w-2 h-2 rounded-full ${status.color.split(' ')[0]}`} />
                                                    {status.label}
                                                    {post.status === status.value && (
                                                        <Check className="w-3 h-3 ml-auto text-green-600" />
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                            <div className="text-sm text-[var(--color-gray-600)]">
                                {post.campaign?.name || <span className="text-[var(--color-gray-400)] italic">No campaign</span>}
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-6 h-6 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white text-xs font-medium">
                                    {user?.email?.[0]?.toUpperCase() || 'U'}
                                </div>
                                <span className="text-sm text-[var(--color-gray-700)]">
                                    {user?.user_metadata?.full_name || 'You'}
                                </span>
                            </div>
                            <div className="text-sm text-[var(--color-gray-600)]">
                                {currentSpace?.name || '-'}
                            </div>
                            <div className="text-center text-sm text-[var(--color-gray-600)]">
                                {post.likes}
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    className="p-1.5 rounded hover:bg-[var(--color-gray-100)] text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)] disabled:opacity-50"
                                    title="Manage Images"
                                    onClick={() => setImageModalPost(post)}
                                >
                                    <ImageIcon className="w-4 h-4" />
                                </button>
                                <button
                                    className="p-1.5 rounded hover:bg-[var(--color-gray-100)] text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)] disabled:opacity-50"
                                    title="Apply Logos"
                                    onClick={() => handleComposeImage(post.id)}
                                    disabled={post.status === 'compositing' || !post.status?.includes('image_ready')}
                                >
                                    <Paintbrush className="w-4 h-4" />
                                </button>
                                <button
                                    className="p-1.5 rounded hover:bg-[var(--color-gray-100)] text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)]"
                                    title="View/Edit"
                                >
                                    <Eye className="w-4 h-4" />
                                </button>
                                <button
                                    className="p-1.5 rounded hover:bg-[var(--color-gray-100)] text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)]"
                                >
                                    <MoreHorizontal className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))
                )}

                {/* Footer */}
                {posts.length > 0 && (
                    <div className="py-3 text-sm text-[var(--color-gray-500)]">
                        Showing 1-{posts.length} of {posts.length}
                    </div>
                )}
            </div>

            {/* Bulk Generate Modal */}
            <Modal
                isOpen={showBulkGenerateModal}
                onClose={() => setShowBulkGenerateModal(false)}
                title="Bulk Generate Posts"
                size="lg"
            >
                <BulkGenerateForm
                    onClose={() => setShowBulkGenerateModal(false)}
                    onSuccess={fetchPosts}
                />
            </Modal>

            {/* Export Modal */}
            <Modal
                isOpen={!!exportPost}
                onClose={() => { setExportPost(null); setCopiedText(false); }}
                title="Export Post"
                size="lg"
            >
                {exportPost && (
                    <div className="space-y-6">
                        {/* Post Text Section */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-medium text-[var(--color-gray-700)]">Post Text</h3>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={async () => {
                                        await navigator.clipboard.writeText(exportPost.body || '')
                                        setCopiedText(true)
                                        setTimeout(() => setCopiedText(false), 2000)
                                    }}
                                >
                                    {copiedText ? (
                                        <>
                                            <Check className="w-4 h-4 text-green-500" />
                                            Copied!
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="w-4 h-4" />
                                            Copy Text
                                        </>
                                    )}
                                </Button>
                            </div>
                            <div className="bg-[var(--color-gray-50)] rounded-lg p-4 text-sm text-[var(--color-gray-700)] whitespace-pre-wrap max-h-48 overflow-y-auto">
                                {exportPost.body || 'No content yet'}
                            </div>
                        </div>

                        {/* Image Section */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-medium text-[var(--color-gray-700)]">Image</h3>
                                {(exportPost.final_image_path || exportPost.generated_image_path) && (
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => {
                                            const imagePath = exportPost.final_image_path || exportPost.generated_image_path
                                            if (!imagePath) return

                                            // Get public URL from Supabase storage
                                            const { data } = supabase.storage
                                                .from('post-images')
                                                .getPublicUrl(imagePath)

                                            // Create download link with post title as filename
                                            const link = document.createElement('a')
                                            link.href = data.publicUrl
                                            link.download = `${exportPost.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_image.png`
                                            link.target = '_blank'
                                            document.body.appendChild(link)
                                            link.click()
                                            document.body.removeChild(link)
                                        }}
                                    >
                                        <Download className="w-4 h-4" />
                                        Download Image
                                    </Button>
                                )}
                            </div>
                            <div className="bg-[var(--color-gray-100)] rounded-lg overflow-hidden flex items-center justify-center min-h-[200px]">
                                {exportPost.final_image_path || exportPost.generated_image_path ? (
                                    <img
                                        src={supabase.storage
                                            .from('post-images')
                                            .getPublicUrl(exportPost.final_image_path || exportPost.generated_image_path || '')
                                            .data.publicUrl}
                                        alt={exportPost.title}
                                        className="max-w-full max-h-[300px] object-contain"
                                    />
                                ) : (
                                    <div className="text-[var(--color-gray-400)] text-center py-8">
                                        <ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                        <p>No image generated yet</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Close button */}
                        <div className="flex justify-end pt-4 border-t border-[var(--color-gray-200)]">
                            <Button variant="secondary" onClick={() => { setExportPost(null); setCopiedText(false); }}>
                                Close
                            </Button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Image Modal */}
            {imageModalPost && (
                <ImageModal
                    isOpen={!!imageModalPost}
                    onClose={() => setImageModalPost(null)}
                    post={imageModalPost}
                    onUpdate={fetchPosts}
                />
            )}

            {/* Bulk Logo Options Modal */}
            {showBulkLogoModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl">
                        <div className="p-6">
                            <div className="flex items-center gap-4 mb-6">
                                <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                                    <Layers className="w-6 h-6 text-white" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-[var(--color-gray-900)]">Bulk Apply Logos</h3>
                                    <p className="text-sm text-[var(--color-gray-500)]">Apply logos to {selectedIds.size} selected posts</p>
                                </div>
                            </div>

                            <div className="space-y-4 mb-6">
                                <label className="flex items-start gap-3 p-3 rounded-lg border border-[var(--color-gray-200)] hover:border-purple-300 cursor-pointer transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={bulkLogoOptions.randomizePrimary}
                                        onChange={(e) => setBulkLogoOptions(prev => ({ ...prev, randomizePrimary: e.target.checked }))}
                                        className="w-5 h-5 mt-0.5 rounded"
                                    />
                                    <div>
                                        <div className="font-medium text-[var(--color-gray-900)]">🎲 Randomize Primary Image</div>
                                        <div className="text-sm text-[var(--color-gray-500)]">Pick a random image from each post's gallery</div>
                                    </div>
                                </label>

                                <label className="flex items-start gap-3 p-3 rounded-lg border border-[var(--color-gray-200)] hover:border-purple-300 cursor-pointer transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={bulkLogoOptions.randomizeLogo}
                                        onChange={(e) => setBulkLogoOptions(prev => ({ ...prev, randomizeLogo: e.target.checked }))}
                                        className="w-5 h-5 mt-0.5 rounded"
                                    />
                                    <div>
                                        <div className="font-medium text-[var(--color-gray-900)]">🎯 Randomize Logo Position</div>
                                        <div className="text-sm text-[var(--color-gray-500)]">Randomly apply top-left, bottom-right, or both logos</div>
                                    </div>
                                </label>
                            </div>

                            <div className="flex gap-3">
                                <Button variant="secondary" className="flex-1" onClick={() => setShowBulkLogoModal(false)}>
                                    Cancel
                                </Button>
                                <Button variant="pill" className="flex-1" onClick={handleBulkApplyLogos}>
                                    <Layers className="w-4 h-4" />
                                    Apply Logos
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Status Change Modal */}
            {showBulkStatusModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl">
                        <div className="p-6">
                            <div className="flex items-center gap-4 mb-6">
                                <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-xl flex items-center justify-center">
                                    <Check className="w-6 h-6 text-white" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-[var(--color-gray-900)]">Change Status</h3>
                                    <p className="text-sm text-[var(--color-gray-500)]">Update status for {selectedIds.size} selected posts</p>
                                </div>
                            </div>

                            <div className="space-y-2 mb-6">
                                {availableStatuses.map(status => (
                                    <button
                                        key={status.value}
                                        onClick={() => setSelectedBulkStatus(status.value)}
                                        className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all ${selectedBulkStatus === status.value
                                                ? 'border-indigo-500 bg-indigo-50'
                                                : 'border-[var(--color-gray-200)] hover:border-indigo-300'
                                            }`}
                                    >
                                        <span className={`w-4 h-4 rounded-full ${status.color.split(' ')[0]}`} />
                                        <span className="font-medium text-[var(--color-gray-900)]">{status.label}</span>
                                        {selectedBulkStatus === status.value && (
                                            <Check className="w-4 h-4 ml-auto text-indigo-600" />
                                        )}
                                    </button>
                                ))}
                            </div>

                            <div className="flex gap-3">
                                <Button variant="secondary" className="flex-1" onClick={() => setShowBulkStatusModal(false)}>
                                    Cancel
                                </Button>
                                <Button variant="pill" className="flex-1" onClick={handleBulkChangeStatus}>
                                    <Check className="w-4 h-4" />
                                    Update Status
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Image Generation Progress */}
            {isBulkGeneratingImages && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl p-8">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-14 h-14 bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-secondary)] rounded-xl flex items-center justify-center">
                                <Sparkles className="w-7 h-7 text-white animate-pulse" />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-[var(--color-gray-900)]">Generating Images</h3>
                                <p className="text-sm text-[var(--color-gray-500)]">
                                    {bulkImageProgress.current} of {bulkImageProgress.total} posts complete
                                </p>
                            </div>
                        </div>

                        <div className="mb-6">
                            <div className="flex justify-between text-sm mb-2">
                                <span className="text-[var(--color-gray-500)]">Progress</span>
                                <span className="font-semibold text-[var(--color-primary)]">
                                    {bulkImageProgress.total > 0 ? Math.round((bulkImageProgress.current / bulkImageProgress.total) * 100) : 0}%
                                </span>
                            </div>
                            <div className="h-4 bg-[var(--color-gray-200)] rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] transition-all duration-500 relative"
                                    style={{ width: `${bulkImageProgress.total > 0 ? (bulkImageProgress.current / bulkImageProgress.total) * 100 : 0}%` }}
                                >
                                    <div className="absolute inset-0 bg-white/20 animate-pulse" />
                                </div>
                            </div>
                        </div>

                        <div className="bg-blue-50 rounded-xl p-4 flex items-center gap-3">
                            <Loader2 className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
                            <div>
                                <div className="text-sm font-medium text-blue-900">Processing post {bulkImageProgress.current + 1}...</div>
                                <div className="text-xs text-blue-600">AI is creating unique images for each post</div>
                            </div>
                        </div>

                        <p className="text-xs text-center text-[var(--color-gray-400)] mt-4">
                            ⚡ Images are saved automatically as they complete
                        </p>
                    </div>
                </div>
            )}

            {/* Bulk Logo Application Progress */}
            {isBulkApplyingLogos && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl p-8">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                                <Layers className="w-7 h-7 text-white animate-pulse" />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-[var(--color-gray-900)]">Applying Logos</h3>
                                <p className="text-sm text-[var(--color-gray-500)]">
                                    {bulkLogoProgress.current} of {bulkLogoProgress.total} posts complete
                                </p>
                            </div>
                        </div>

                        <div className="mb-6">
                            <div className="flex justify-between text-sm mb-2">
                                <span className="text-[var(--color-gray-500)]">Progress</span>
                                <span className="font-semibold text-purple-600">
                                    {bulkLogoProgress.total > 0 ? Math.round((bulkLogoProgress.current / bulkLogoProgress.total) * 100) : 0}%
                                </span>
                            </div>
                            <div className="h-4 bg-[var(--color-gray-200)] rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500 relative"
                                    style={{ width: `${bulkLogoProgress.total > 0 ? (bulkLogoProgress.current / bulkLogoProgress.total) * 100 : 0}%` }}
                                >
                                    <div className="absolute inset-0 bg-white/20 animate-pulse" />
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-2 mb-4">
                            {bulkLogoOptions.randomizePrimary && (
                                <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                                    🎲 Random image
                                </span>
                            )}
                            {bulkLogoOptions.randomizeLogo && (
                                <span className="px-2 py-1 bg-pink-100 text-pink-700 rounded-full text-xs font-medium">
                                    🎯 Random logo
                                </span>
                            )}
                        </div>

                        <div className="bg-purple-50 rounded-xl p-4 flex items-center gap-3">
                            <Loader2 className="w-5 h-5 text-purple-600 animate-spin flex-shrink-0" />
                            <div>
                                <div className="text-sm font-medium text-purple-900">Processing post {bulkLogoProgress.current + 1}...</div>
                                <div className="text-xs text-purple-600">Compositing logos onto images</div>
                            </div>
                        </div>

                        <p className="text-xs text-center text-[var(--color-gray-400)] mt-4">
                            ✨ Each image is saved as the new primary with logo applied
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}

// Bulk Generate Form Component
function BulkGenerateForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
    const { currentSpace } = useSpaceStore()
    const { user } = useAuthStore()
    const [batchName, setBatchName] = useState('')
    const [topics, setTopics] = useState('')
    const [postsPerTopic, setPostsPerTopic] = useState(1)
    const [isGenerating, setIsGenerating] = useState(false)

    const handleGenerate = async () => {
        if (!currentSpace || !user || !topics.trim()) return

        setIsGenerating(true)
        try {
            // Parse topics (one per line)
            const topicList = topics.split('\n').filter(t => t.trim())

            // Create batch
            const { data: batch, error: batchError } = await supabase
                .from('batches')
                .insert({
                    space_id: currentSpace.id,
                    name: batchName || `Batch ${new Date().toLocaleDateString()}`,
                    status: 'pending',
                    created_by: user.id,
                })
                .select()
                .single()

            if (batchError) throw batchError

            // Create draft posts for each topic
            const postsToCreate = topicList.flatMap(topic =>
                Array.from({ length: postsPerTopic }, (_, i) => ({
                    space_id: currentSpace.id,
                    batch_id: batch.id,
                    title: `${topic}${postsPerTopic > 1 ? ` (${i + 1})` : ''}`,
                    topic: topic.trim(),
                    status: 'draft',
                    author_id: user.id,
                    likes: 0,
                    comments: 0,
                }))
            )

            const { error: postsError } = await supabase
                .from('posts')
                .insert(postsToCreate)

            if (postsError) throw postsError

            onSuccess()
            onClose()
        } catch (error) {
            console.error('Error generating posts:', error)
        } finally {
            setIsGenerating(false)
        }
    }

    return (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-[var(--color-gray-700)] mb-1">
                    Batch Name
                </label>
                <input
                    type="text"
                    value={batchName}
                    onChange={(e) => setBatchName(e.target.value)}
                    placeholder="My LinkedIn Posts"
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-gray-300)] focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-[var(--color-gray-700)] mb-1">
                    Topics (one per line)
                </label>
                <textarea
                    value={topics}
                    onChange={(e) => setTopics(e.target.value)}
                    placeholder="AI in marketing&#10;Remote work tips&#10;Leadership lessons"
                    rows={5}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-gray-300)] focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent font-mono text-sm"
                />
            </div>

            <div>
                <label className="block text-sm font-medium text-[var(--color-gray-700)] mb-1">
                    Posts per Topic
                </label>
                <select
                    value={postsPerTopic}
                    onChange={(e) => setPostsPerTopic(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-gray-300)] focus:ring-2 focus:ring-[var(--color-primary)]"
                >
                    {[1, 2, 3, 5, 10].map(n => (
                        <option key={n} value={n}>{n}</option>
                    ))}
                </select>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-[var(--color-gray-200)]">
                <Button variant="secondary" onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    onClick={handleGenerate}
                    isLoading={isGenerating}
                    disabled={!topics.trim()}
                >
                    Create Draft Posts
                </Button>
            </div>
        </div>
    )
}
