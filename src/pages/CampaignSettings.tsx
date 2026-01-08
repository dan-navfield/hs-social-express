import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Play, Save, Settings, FileText, Sparkles, Target, Loader2, Eye, Trash2, ListChecks, MessageSquareText, Check, RefreshCw, Lightbulb, ChevronRight, Edit3, X, Image as ImageIcon, Copy, Download, CheckCircle2, Layers } from 'lucide-react'
import { Button, Input, Textarea, StatusBadge } from '@/components/ui'
import { ImageModal } from '@/components/posts/ImageModal'
import { supabase } from '@/lib/supabase'
import { useSpaceStore } from '@/stores/spaceStore'
import type { Database, CampaignStatus, GenerationSettings, LockedSourceSettings, PostStatus } from '@/types/database'
import type { ImageStatus, ImageSettings, PromptStyle } from '@/types/image'

type Campaign = Database['public']['Tables']['campaigns']['Row']
type Post = Database['public']['Tables']['posts']['Row']

type TabKey = 'setup' | 'ideas' | 'posts'

interface ExtendedGenerationSettings extends GenerationSettings {
    topics?: string
    example_post?: string
    generated_ideas?: string[]
}

interface BrandProfile {
    tone_notes?: string      // Was tone_of_voice
    who_we_serve?: string    // Was target_audience
}

// Component to show image status on post row
function PostImageStatus({ postId, spaceId, refreshKey }: { postId: string; spaceId: string; refreshKey?: number }) {
    const [status, setStatus] = useState<'none' | 'images' | 'with-logo'>('none')

    useEffect(() => {
        if (!spaceId) return

        const fetchStatus = async () => {
            const { data } = await supabase
                .from('post_images')
                .select('prompt_used')
                .eq('post_id', postId)
                .eq('space_id', spaceId)

            if (data && data.length > 0) {
                const hasLogo = data.some(img => img.prompt_used?.startsWith('[LOGO OVERLAY]'))
                setStatus(hasLogo ? 'with-logo' : 'images')
            } else {
                setStatus('none')
            }
        }

        fetchStatus()
    }, [postId, spaceId, refreshKey])

    if (status === 'none') return null

    if (status === 'with-logo') {
        return (
            <div className="flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium" title="Has image with logo">
                <Layers className="w-3 h-3" />
                <span>Logo</span>
            </div>
        )
    }

    return (
        <div className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium" title="Has images">
            <ImageIcon className="w-3 h-3" />
        </div>
    )
}

export function CampaignSettings() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const { currentSpace } = useSpaceStore()

    const [campaign, setCampaign] = useState<Campaign | null>(null)
    const [posts, setPosts] = useState<Post[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [activeTab, setActiveTab] = useState<TabKey>('setup')
    const [brandProfile, setBrandProfile] = useState<BrandProfile | null>(null)

    // Setup form state
    const [name, setName] = useState('')
    const [targetCount, setTargetCount] = useState(10)
    const [examplePost, setExamplePost] = useState('')
    const [toneNotes, setToneNotes] = useState('')
    const [audienceNotes, setAudienceNotes] = useState('')
    const [targetTopics, setTargetTopics] = useState('') // Specific topics/inspiration
    const [postLength, setPostLength] = useState<'short' | 'medium' | 'long'>('medium')
    const [includeHashtags, setIncludeHashtags] = useState(true)
    const [includeCTA, setIncludeCTA] = useState(true)
    const [includeEmojis, setIncludeEmojis] = useState<'none' | 'subtle' | 'frequent'>('subtle')
    const [useWebsite, setUseWebsite] = useState(true)
    const [useManual, setUseManual] = useState(true)

    // Ideas state
    const [ideas, setIdeas] = useState<string[]>([])
    const [isGeneratingIdeas, setIsGeneratingIdeas] = useState(false)
    const [ideaGenerationStage, setIdeaGenerationStage] = useState<'saving' | 'connecting' | 'analyzing' | 'generating' | 'complete'>('saving')
    const [selectedIdeaIndices, setSelectedIdeaIndices] = useState<Set<number>>(new Set())
    const [editingIdeaIndex, setEditingIdeaIndex] = useState<number | null>(null)
    const [editingIdeaText, setEditingIdeaText] = useState('')

    // Post generation state
    const [isGeneratingPosts, setIsGeneratingPosts] = useState(false)
    const [generationProgress, setGenerationProgress] = useState<{
        current: number
        total: number
        stage: 'connecting' | 'preparing' | 'generating' | 'saving' | 'completed'
        currentTopic: string
        completedTopics: string[]
    }>({
        current: 0,
        total: 0,
        stage: 'connecting',
        currentTopic: '',
        completedTopics: []
    })

    // Post selection and expansion
    const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set())
    const [expandedPostId, setExpandedPostId] = useState<string | null>(null)
    const [imageModalPost, setImageModalPost] = useState<(Post & { image_prompt: string | null; image_prompt_style: PromptStyle | null; image_settings: ImageSettings | null; image_status: ImageStatus }) | null>(null)

    // Preview modal state
    const [previewPost, setPreviewPost] = useState<Post | null>(null)
    const [previewImage, setPreviewImage] = useState<{ url: string; prompt: string } | null>(null)
    const [copiedText, setCopiedText] = useState(false)

    // Image status refresh counter - increment to force re-fetch
    const [imageStatusRefresh, setImageStatusRefresh] = useState(0)

    // Bulk operations state
    const [isBulkGeneratingImages, setIsBulkGeneratingImages] = useState(false)
    const [bulkImageProgress, setBulkImageProgress] = useState({
        current: 0,
        total: 0,
        phase: 'preparing' as 'preparing' | 'fetching' | 'generating' | 'complete',
        statusText: 'Preparing...',
        successCount: 0,
        errorCount: 0,
    })
    const [isBulkApplyingLogos, setIsBulkApplyingLogos] = useState(false)
    const [bulkLogoProgress, setBulkLogoProgress] = useState({
        current: 0,
        total: 0,
        phase: 'preparing' as 'preparing' | 'loading' | 'compositing' | 'uploading' | 'complete',
        statusText: 'Preparing...',
        successCount: 0,
        errorCount: 0,
    })
    const [showBulkLogoModal, setShowBulkLogoModal] = useState(false)
    const [bulkLogoOptions, setBulkLogoOptions] = useState({
        randomizePrimary: true,  // Randomly select which image to make primary
        randomizeLogo: true,     // Randomly select which logo position to use
    })

    // Status change state
    const [statusDropdownPostId, setStatusDropdownPostId] = useState<string | null>(null)
    const [showBulkStatusModal, setShowBulkStatusModal] = useState(false)
    const [selectedBulkStatus, setSelectedBulkStatus] = useState<PostStatus>('published')

    // Available statuses for dropdown
    const availableStatuses: { value: PostStatus; label: string; color: string }[] = [
        { value: 'draft', label: 'Draft', color: 'bg-blue-100 text-blue-800' },
        { value: 'ready_to_publish', label: 'Ready', color: 'bg-purple-100 text-purple-800' },
        { value: 'scheduled', label: 'Scheduled', color: 'bg-indigo-100 text-indigo-800' },
        { value: 'published', label: 'Published', color: 'bg-green-100 text-green-800' },
    ]

    const fetchCampaign = useCallback(async () => {
        if (!id) return

        setIsLoading(true)
        try {
            const { data, error } = await supabase
                .from('campaigns')
                .select('*')
                .eq('id', id)
                .single()

            if (error) throw error

            setCampaign(data)
            setName(data.name)
            setTargetCount(data.target_count || 10)

            const sourceSettings = data.locked_source_settings as LockedSourceSettings | null
            setUseWebsite(sourceSettings?.use_website ?? true)
            setUseManual(sourceSettings?.use_manual ?? true)

            const genSettings = data.generation_settings as ExtendedGenerationSettings | null
            setExamplePost(genSettings?.example_post || '')
            setToneNotes(genSettings?.tone_modifiers || '')
            setAudienceNotes(genSettings?.audience_notes || '')
            setTargetTopics((genSettings as any)?.target_topics || '')
            setPostLength((genSettings as any)?.post_length || 'medium')
            setIncludeHashtags((genSettings as any)?.include_hashtags ?? true)
            setIncludeCTA((genSettings as any)?.include_cta ?? true)
            setIncludeEmojis((genSettings as any)?.include_emojis || 'subtle')
            setIdeas(genSettings?.generated_ideas || [])

            // Fetch posts
            const { data: postsData } = await supabase
                .from('posts')
                .select('*')
                .eq('campaign_id', id)
                .order('sequence_number', { ascending: true })

            setPosts(postsData || [])

            // Fetch brand profile for defaults
            if (data.space_id) {
                try {
                    const { data: profile, error: profileError } = await supabase
                        .from('brand_profile')
                        .select('tone_notes, who_we_serve')
                        .eq('space_id', data.space_id)
                        .maybeSingle()  // Use maybeSingle to avoid error when no row exists

                    if (!profileError && profile) {
                        console.log('Brand profile loaded:', profile)
                        setBrandProfile(profile)
                    } else if (profileError) {
                        console.warn('Brand profile fetch error:', profileError)
                    }
                } catch (e) {
                    console.error('Exception fetching brand profile:', e)
                }
            }

            // Auto-select tab based on state
            if (postsData && postsData.length > 0) {
                setActiveTab('posts')
            } else if (genSettings?.generated_ideas && genSettings.generated_ideas.length > 0) {
                setActiveTab('ideas')
            }
        } catch (error) {
            console.error('Error fetching campaign:', error)
        } finally {
            setIsLoading(false)
        }
    }, [id])

    useEffect(() => {
        fetchCampaign()
    }, [fetchCampaign])

    const handleSave = async () => {
        if (!id) return

        setIsSaving(true)
        try {
            const { error } = await supabase
                .from('campaigns')
                .update({
                    name,
                    target_count: targetCount,
                    locked_source_settings: {
                        use_website: useWebsite,
                        use_manual: useManual,
                        use_sharepoint: false,
                    },
                    generation_settings: {
                        example_post: examplePost,
                        tone_modifiers: toneNotes,
                        audience_notes: audienceNotes,
                        target_topics: targetTopics,
                        post_length: postLength,
                        include_hashtags: includeHashtags,
                        include_cta: includeCTA,
                        include_emojis: includeEmojis,
                        generated_ideas: ideas,
                        topics: ideas.join('\n'), // For backward compatibility
                    },
                    updated_at: new Date().toISOString(),
                })
                .eq('id', id)

            if (error) throw error
        } catch (error) {
            console.error('Error saving campaign:', error)
            alert('Failed to save campaign')
        } finally {
            setIsSaving(false)
        }
    }

    // Quick save for ideas only (used when deleting/modifying ideas)
    const saveIdeas = async (newIdeas: string[]) => {
        if (!id) return
        try {
            await supabase
                .from('campaigns')
                .update({
                    generation_settings: {
                        example_post: examplePost,
                        tone_modifiers: toneNotes,
                        audience_notes: audienceNotes,
                        target_topics: targetTopics,
                        post_length: postLength,
                        include_hashtags: includeHashtags,
                        include_cta: includeCTA,
                        include_emojis: includeEmojis,
                        generated_ideas: newIdeas,
                        topics: newIdeas.join('\n'),
                    },
                    updated_at: new Date().toISOString(),
                })
                .eq('id', id)
        } catch (error) {
            console.error('Error saving ideas:', error)
        }
    }

    const handleGenerateIdeas = async () => {
        if (!id) return

        setIsGeneratingIdeas(true)
        setIdeaGenerationStage('saving')

        await handleSave() // Save settings first

        setIdeaGenerationStage('connecting')
        await new Promise(r => setTimeout(r, 500)) // Brief pause for visual feedback

        setIdeaGenerationStage('analyzing')
        await new Promise(r => setTimeout(r, 800)) // Simulated analysis time

        setIdeaGenerationStage('generating')

        try {
            const { data, error } = await supabase.functions.invoke('generate-ideas', {
                body: { campaign_id: id, count: targetCount },
            })

            if (error) throw error

            setIdeaGenerationStage('complete')
            await new Promise(r => setTimeout(r, 500)) // Brief success pause

            setIdeas(data.ideas || [])
            await saveIdeas(data.ideas || [])
            setActiveTab('ideas')
        } catch (error) {
            console.error('Error generating ideas:', error)
            alert('Failed to generate ideas')
        } finally {
            setIsGeneratingIdeas(false)
        }
    }

    const handleRegenerateSelected = async () => {
        if (selectedIdeaIndices.size === 0) return

        setIsGeneratingIdeas(true)
        try {
            const { data, error } = await supabase.functions.invoke('generate-ideas', {
                body: { campaign_id: id, count: selectedIdeaIndices.size },
            })

            if (error) throw error

            // Replace selected ideas with new ones
            const newIdeas = [...ideas]
            const indicesToReplace = Array.from(selectedIdeaIndices).sort((a, b) => a - b)
            indicesToReplace.forEach((idx, i) => {
                if (data.ideas[i]) {
                    newIdeas[idx] = data.ideas[i]
                }
            })
            setIdeas(newIdeas)
            setSelectedIdeaIndices(new Set())
            await handleSave()
        } catch (error) {
            console.error('Error regenerating ideas:', error)
        } finally {
            setIsGeneratingIdeas(false)
        }
    }

    const handleDeleteIdea = async (index: number) => {
        const newIdeas = ideas.filter((_, i) => i !== index)
        setIdeas(newIdeas)
        selectedIdeaIndices.delete(index)
        setSelectedIdeaIndices(new Set(selectedIdeaIndices))
        await saveIdeas(newIdeas)
    }

    const handleEditIdea = (index: number) => {
        setEditingIdeaIndex(index)
        setEditingIdeaText(ideas[index])
    }

    const handleSaveEditedIdea = async () => {
        if (editingIdeaIndex !== null) {
            const newIdeas = [...ideas]
            newIdeas[editingIdeaIndex] = editingIdeaText
            setIdeas(newIdeas)
            setEditingIdeaIndex(null)
            setEditingIdeaText('')
            await saveIdeas(newIdeas)
        }
    }

    const toggleIdeaSelect = (index: number) => {
        const next = new Set(selectedIdeaIndices)
        if (next.has(index)) {
            next.delete(index)
        } else {
            next.add(index)
        }
        setSelectedIdeaIndices(next)
    }

    const handleGeneratePosts = async () => {
        if (!id || ideas.length === 0) return

        // Save ideas to campaign first
        await handleSave()

        setIsGeneratingPosts(true)
        setGenerationProgress({
            current: 0,
            total: ideas.length,
            stage: 'connecting',
            currentTopic: '',
            completedTopics: []
        })

        try {
            // Stage: Connecting
            await new Promise(resolve => setTimeout(resolve, 500))
            setGenerationProgress(prev => ({ ...prev, stage: 'preparing' }))

            await supabase
                .from('campaigns')
                .update({ status: 'running', updated_at: new Date().toISOString() })
                .eq('id', id)

            // Stage: Preparing
            await new Promise(resolve => setTimeout(resolve, 500))
            setGenerationProgress(prev => ({
                ...prev,
                stage: 'generating',
                currentTopic: ideas[0] || 'Starting...'
            }))

            // Poll for progress
            const pollInterval = setInterval(async () => {
                const { data: postsData } = await supabase
                    .from('posts')
                    .select('*, topic')
                    .eq('campaign_id', id)
                    .order('sequence_number', { ascending: true })

                const count = postsData?.length || 0
                const completedTopics = postsData?.map(p => p.topic || ideas[count - 1] || '') || []
                const nextTopicIndex = count < ideas.length ? count : ideas.length - 1

                setGenerationProgress(prev => ({
                    ...prev,
                    current: count,
                    stage: count >= ideas.length ? 'completed' : 'generating',
                    currentTopic: count < ideas.length ? ideas[nextTopicIndex] : 'Finishing up...',
                    completedTopics: completedTopics.slice(0, count)
                }))
                setPosts(postsData || [])

                if (count >= ideas.length) {
                    clearInterval(pollInterval)
                    setGenerationProgress(prev => ({ ...prev, stage: 'completed' }))
                    setTimeout(() => {
                        setIsGeneratingPosts(false)
                        setActiveTab('posts')
                    }, 1500)
                }
            }, 2000)

            const { error } = await supabase.functions.invoke('generate-campaign-posts', {
                body: { campaign_id: id },
            })

            if (error) {
                clearInterval(pollInterval)
                throw error
            }

            // Fallback timeout
            setTimeout(async () => {
                clearInterval(pollInterval)
                await fetchCampaign()
                setIsGeneratingPosts(false)
                setActiveTab('posts')
            }, ideas.length * 8000) // ~8s per post max

        } catch (error) {
            console.error('Error generating posts:', error)
            alert('Failed to generate posts')
            setIsGeneratingPosts(false)
        }
    }

    const handleDeletePost = async (postId: string) => {
        if (!confirm('Delete this post?')) return
        try {
            await supabase.from('posts').delete().eq('id', postId)
            await fetchCampaign()
        } catch (error) {
            console.error('Error deleting post:', error)
        }
    }

    const handleBulkDeletePosts = async () => {
        if (selectedPostIds.size === 0) return
        if (!confirm(`Delete ${selectedPostIds.size} selected post(s)?`)) return
        try {
            await supabase.from('posts').delete().in('id', Array.from(selectedPostIds))
            setSelectedPostIds(new Set())
            await fetchCampaign()
        } catch (error) {
            console.error('Error deleting posts:', error)
        }
    }

    const togglePostSelect = (postId: string) => {
        const next = new Set(selectedPostIds)
        if (next.has(postId)) next.delete(postId)
        else next.add(postId)
        setSelectedPostIds(next)
    }

    const toggleSelectAllPosts = () => {
        if (selectedPostIds.size === posts.length) setSelectedPostIds(new Set())
        else setSelectedPostIds(new Set(posts.map(p => p.id)))
    }

    // Open preview modal with primary image
    const handleOpenPreview = async (post: Post) => {
        setPreviewPost(post)

        // Fetch primary image for this post
        if (currentSpace) {
            const { data: imageData } = await supabase
                .from('post_images')
                .select('*')
                .eq('post_id', post.id)
                .eq('space_id', currentSpace.id)
                .eq('is_primary', true)
                .single()

            if (imageData) {
                const { data: urlData } = supabase.storage
                    .from('generated-images')
                    .getPublicUrl(imageData.storage_path)

                setPreviewImage({
                    url: urlData.publicUrl,
                    prompt: imageData.prompt_used || ''
                })
            } else {
                setPreviewImage(null)
            }
        }
    }

    // Copy post text to clipboard
    const handleCopyText = async () => {
        if (previewPost?.body) {
            await navigator.clipboard.writeText(previewPost.body)
            setCopiedText(true)
            setTimeout(() => setCopiedText(false), 2000)
        }
    }

    // Download image with smart filename
    const handleDownloadImage = async () => {
        if (!previewImage?.url) return

        try {
            const response = await fetch(previewImage.url)
            const blob = await response.blob()

            // Generate filename from prompt
            let filename = 'image.png'
            if (previewImage.prompt) {
                // Extract meaningful words, remove special chars, limit length
                const cleanPrompt = previewImage.prompt
                    .replace(/\[LOGO OVERLAY\]/gi, '')
                    .replace(/[^a-zA-Z0-9\s]/g, '')
                    .trim()
                    .toLowerCase()
                    .split(/\s+/)
                    .slice(0, 5)
                    .join('-')

                if (cleanPrompt) {
                    filename = `${cleanPrompt}.png`
                }
            }

            // Create download link
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = filename
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
        } catch (err) {
            console.error('Download failed:', err)
        }
    }

    // Change status for a single post
    const handleChangePostStatus = async (postId: string, newStatus: PostStatus) => {
        try {
            const { error } = await supabase
                .from('posts')
                .update({ status: newStatus, updated_at: new Date().toISOString() })
                .eq('id', postId)

            if (error) {
                console.error('Failed to change status:', error)
                alert(`Failed to update status: ${error.message}`)
                return
            }

            // Update local state
            setPosts(prev => prev.map(p => p.id === postId ? { ...p, status: newStatus } : p))
            setStatusDropdownPostId(null)
        } catch (err) {
            console.error('Failed to change status:', err)
            alert('Failed to update status')
        }
    }

    // Bulk change status for selected posts
    const handleBulkChangeStatus = async () => {
        if (selectedPostIds.size === 0) return

        setShowBulkStatusModal(false)

        try {
            const { error } = await supabase
                .from('posts')
                .update({ status: selectedBulkStatus, updated_at: new Date().toISOString() })
                .in('id', Array.from(selectedPostIds))

            if (error) {
                console.error('Failed to bulk change status:', error)
                alert(`Failed to update status: ${error.message}`)
                return
            }

            // Update local state
            setPosts(prev => prev.map(p =>
                selectedPostIds.has(p.id) ? { ...p, status: selectedBulkStatus } : p
            ))
            setSelectedPostIds(new Set())
        } catch (err) {
            console.error('Failed to bulk change status:', err)
            alert('Failed to update status')
        }
    }

    // Bulk generate images for selected posts
    const handleBulkGenerateImages = async () => {
        if (selectedPostIds.size === 0 || !currentSpace) return

        setIsBulkGeneratingImages(true)
        setBulkImageProgress({
            current: 0,
            total: selectedPostIds.size,
            phase: 'preparing',
            statusText: 'Preparing batch...',
            successCount: 0,
            errorCount: 0,
        })

        const postIds = Array.from(selectedPostIds)
        let successCount = 0
        let errorCount = 0

        for (let i = 0; i < postIds.length; i++) {
            const postId = postIds[i]
            const postNumber = i + 1

            // Update progress - fetching phase
            setBulkImageProgress(prev => ({
                ...prev,
                current: i,
                phase: 'fetching',
                statusText: `Fetching post ${postNumber} of ${postIds.length}...`,
            }))

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
                    setBulkImageProgress(prev => ({ ...prev, errorCount }))
                    continue
                }

                // Update progress - generating phase
                setBulkImageProgress(prev => ({
                    ...prev,
                    phase: 'generating',
                    statusText: `Generating images for post ${postNumber} of ${postIds.length}...`,
                }))

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

                // Update counts in progress
                setBulkImageProgress(prev => ({
                    ...prev,
                    successCount,
                    errorCount,
                }))

                // Small delay between requests to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500))
            } catch (err) {
                console.error(`Failed to generate images for post ${postId}:`, err)
                errorCount++
                setBulkImageProgress(prev => ({ ...prev, errorCount }))
            }
        }

        setBulkImageProgress(prev => ({
            ...prev,
            current: postIds.length,
            phase: 'complete',
            statusText: `Complete! ${successCount} successful, ${errorCount} failed`,
            successCount,
            errorCount,
        }))

        // Small delay to show completion state
        await new Promise(resolve => setTimeout(resolve, 1000))

        setIsBulkGeneratingImages(false)
        setImageStatusRefresh(prev => prev + 1)
        setSelectedPostIds(new Set())

        // Show summary only if there were errors
        if (errorCount > 0) {
            alert(`Completed: ${successCount} successful, ${errorCount} failed. Check console for details.`)
        }
    }

    // Bulk apply logos to selected posts
    const handleBulkApplyLogos = async () => {
        if (selectedPostIds.size === 0 || !currentSpace) return

        setShowBulkLogoModal(false)
        setIsBulkApplyingLogos(true)
        setBulkLogoProgress({
            current: 0,
            total: selectedPostIds.size,
            phase: 'preparing',
            statusText: 'Loading brand assets...',
            successCount: 0,
            errorCount: 0,
        })

        // Fetch brand profile for logo URLs
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

        const postIds = Array.from(selectedPostIds)
        const logoOptions = [
            { topLeft: brand.logo_url, bottomRight: brand.logo_bottom_right_url },           // Main + BR
            { topLeft: brand.logo_top_left_url, bottomRight: brand.logo_bottom_right_url },  // TL + BR
            { topLeft: brand.logo_url, bottomRight: null },                                   // Main only
            { topLeft: brand.logo_top_left_url, bottomRight: null },                          // TL only
            { topLeft: null, bottomRight: brand.logo_bottom_right_url },                      // BR only
        ].filter(opt => opt.topLeft || opt.bottomRight) // Remove invalid options

        let successCount = 0
        let errorCount = 0

        for (let i = 0; i < postIds.length; i++) {
            const postId = postIds[i]
            const postNumber = i + 1

            // Update progress - loading phase
            setBulkLogoProgress(prev => ({
                ...prev,
                current: i,
                phase: 'loading',
                statusText: `Loading images for post ${postNumber} of ${postIds.length}...`,
            }))

            try {
                // Get images for this post
                const { data: images } = await supabase
                    .from('post_images')
                    .select('*')
                    .eq('post_id', postId)
                    .eq('space_id', currentSpace.id)
                    .eq('generation_status', 'completed')

                if (!images || images.length === 0) {
                    errorCount++
                    setBulkLogoProgress(prev => ({ ...prev, errorCount }))
                    continue
                }

                // Filter out already logo'd images
                const eligibleImages = images.filter(img => !img.prompt_used?.startsWith('[LOGO OVERLAY]'))
                if (eligibleImages.length === 0) {
                    errorCount++
                    setBulkLogoProgress(prev => ({ ...prev, errorCount }))
                    continue
                }

                // Select source image (random or first)
                const sourceImage = bulkLogoOptions.randomizePrimary
                    ? eligibleImages[Math.floor(Math.random() * eligibleImages.length)]
                    : eligibleImages[0]

                // Select logo configuration (random or default both)
                const logoConfig = bulkLogoOptions.randomizeLogo && logoOptions.length > 0
                    ? logoOptions[Math.floor(Math.random() * logoOptions.length)]
                    : { topLeft: brand.logo_url || brand.logo_top_left_url, bottomRight: brand.logo_bottom_right_url }

                // Update progress - compositing phase
                setBulkLogoProgress(prev => ({
                    ...prev,
                    phase: 'compositing',
                    statusText: `Compositing logos for post ${postNumber} of ${postIds.length}...`,
                }))

                // Get source image URL
                const { data: urlData } = supabase.storage
                    .from('generated-images')
                    .getPublicUrl(sourceImage.storage_path)

                // Load and composite image
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

                // Draw top-left logo
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

                // Draw bottom-right logo
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

                // Update progress - uploading phase
                setBulkLogoProgress(prev => ({
                    ...prev,
                    phase: 'uploading',
                    statusText: `Saving image for post ${postNumber} of ${postIds.length}...`,
                }))

                // Convert to blob and upload
                const blob = await new Promise<Blob>((resolve, reject) => {
                    canvas.toBlob(b => b ? resolve(b) : reject(new Error('Failed')), 'image/png', 1.0)
                })

                const timestamp = Date.now()
                const fileName = `${postId}/${timestamp}_with_logo.png`

                await supabase.storage
                    .from('generated-images')
                    .upload(fileName, blob, { contentType: 'image/png', upsert: true })

                // Create new record and set as primary
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

                // Mark previous images as not primary
                await supabase.from('post_images')
                    .update({ is_primary: false })
                    .eq('post_id', postId)
                    .neq('storage_path', fileName)

                successCount++
                setBulkLogoProgress(prev => ({ ...prev, successCount }))

            } catch (err) {
                console.error(`Failed to apply logo for post ${postId}:`, err)
                errorCount++
                setBulkLogoProgress(prev => ({ ...prev, errorCount }))
            }
        }

        setBulkLogoProgress(prev => ({
            ...prev,
            current: postIds.length,
            phase: 'complete',
            statusText: `Complete! ${successCount} successful, ${errorCount} failed`,
            successCount,
            errorCount,
        }))

        // Small delay to show completion state
        await new Promise(resolve => setTimeout(resolve, 1000))

        setIsBulkApplyingLogos(false)
        setImageStatusRefresh(prev => prev + 1)
        setSelectedPostIds(new Set())

        // Show summary only if there were errors
        if (errorCount > 0) {
            alert(`Completed: ${successCount} successful, ${errorCount} failed. Check console for details.`)
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-[var(--color-gray-400)]" />
            </div>
        )
    }

    if (!campaign) {
        return (
            <div className="p-8 text-center">
                <p className="text-[var(--color-gray-500)]">Campaign not found</p>
                <Button variant="ghost" onClick={() => navigate('/campaigns')} className="mt-4">
                    <ArrowLeft className="w-4 h-4" /> Back to Campaigns
                </Button>
            </div>
        )
    }

    const tabs: { key: TabKey; label: string; icon: any; count?: number }[] = [
        { key: 'setup', label: 'Setup', icon: Settings },
        { key: 'ideas', label: 'Content Ideas', icon: Lightbulb, count: ideas.length },
        { key: 'posts', label: 'Generated Posts', icon: FileText, count: posts.length },
    ]

    return (
        <div className="p-8 max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="sm" onClick={() => navigate('/campaigns')}>
                        <ArrowLeft className="w-4 h-4" />
                    </Button>
                    <div>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="text-2xl font-bold text-[var(--color-gray-900)] bg-transparent border-none focus:outline-none p-0"
                            placeholder="Campaign name..."
                        />
                        <div className="flex items-center gap-2 mt-1">
                            <StatusBadge status={campaign.status} />
                            <span className="text-sm text-[var(--color-gray-500)]">
                                {posts.length} posts generated
                            </span>
                        </div>
                    </div>
                </div>
                <Button variant="secondary" onClick={handleSave} disabled={isSaving}>
                    <Save className="w-4 h-4" />
                    {isSaving ? 'Saving...' : 'Save'}
                </Button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-[var(--color-gray-200)] mb-6">
                {tabs.map((tab) => (
                    <button
                        key={tab.key}
                        className={`px-4 py-3 font-medium text-sm border-b-2 transition-colors flex items-center gap-2 ${activeTab === tab.key
                            ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                            : 'border-transparent text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)]'
                            }`}
                        onClick={() => setActiveTab(tab.key)}
                    >
                        <tab.icon className="w-4 h-4" />
                        {tab.label}
                        {tab.count !== undefined && tab.count > 0 && (
                            <span className="text-xs bg-[var(--color-gray-100)] text-[var(--color-gray-600)] px-2 py-0.5 rounded-full">
                                {tab.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            {activeTab === 'setup' && (
                <div className="space-y-6">
                    {/* Basic Settings */}
                    <div className="grid grid-cols-2 gap-6">
                        <div className="bg-white rounded-xl border border-[var(--color-gray-200)] p-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                                    <Target className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-[var(--color-gray-900)]">Campaign Settings</h3>
                                    <p className="text-sm text-[var(--color-gray-500)]">Basic configuration</p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-[var(--color-gray-700)] mb-1">
                                        Number of Posts
                                    </label>
                                    <div className="flex gap-2">
                                        <input
                                            type="number"
                                            min={1}
                                            max={100}
                                            value={targetCount || ''}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value)
                                                setTargetCount(isNaN(val) ? 0 : val)
                                            }}
                                            onBlur={(e) => {
                                                const val = parseInt(e.target.value)
                                                if (!val || val < 1) setTargetCount(10)
                                                if (val > 100) setTargetCount(100)
                                            }}
                                            className="flex-1 px-3 py-2 border border-[var(--color-gray-300)] rounded-lg"
                                        />
                                        <div className="flex gap-1">
                                            {[5, 10, 20, 30].map(n => (
                                                <button
                                                    key={n}
                                                    onClick={() => setTargetCount(n)}
                                                    className={`px-3 py-2 text-sm rounded-lg border transition-colors ${targetCount === n
                                                        ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                                                        : 'border-[var(--color-gray-300)] hover:bg-[var(--color-gray-50)]'
                                                        }`}
                                                >
                                                    {n}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-[var(--color-gray-700)] mb-1">
                                        Post Length
                                    </label>
                                    <div className="flex gap-2">
                                        {([
                                            { value: 'short', label: 'Short', desc: '~100 words' },
                                            { value: 'medium', label: 'Medium', desc: '~200 words' },
                                            { value: 'long', label: 'Long', desc: '~300+ words' },
                                        ] as const).map(opt => (
                                            <button
                                                key={opt.value}
                                                onClick={() => setPostLength(opt.value)}
                                                className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors text-center ${postLength === opt.value
                                                    ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                                                    : 'border-[var(--color-gray-300)] hover:bg-[var(--color-gray-50)]'
                                                    }`}
                                            >
                                                <div className="font-medium">{opt.label}</div>
                                                <div className={`text-xs ${postLength === opt.value ? 'text-white/70' : 'text-[var(--color-gray-400)]'}`}>{opt.desc}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-3 pt-2">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={includeHashtags}
                                            onChange={(e) => setIncludeHashtags(e.target.checked)}
                                            className="w-4 h-4 rounded"
                                        />
                                        <span className="text-sm text-[var(--color-gray-600)]">#Hashtags</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={includeCTA}
                                            onChange={(e) => setIncludeCTA(e.target.checked)}
                                            className="w-4 h-4 rounded"
                                        />
                                        <span className="text-sm text-[var(--color-gray-600)]">Call to Action</span>
                                    </label>
                                    <select
                                        value={includeEmojis}
                                        onChange={(e) => setIncludeEmojis(e.target.value as any)}
                                        className="text-sm border border-[var(--color-gray-300)] rounded-lg px-2 py-1"
                                    >
                                        <option value="none">No Emojis</option>
                                        <option value="subtle">Subtle 😊</option>
                                        <option value="frequent">Frequent 🎉</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl border border-[var(--color-gray-200)] p-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                                    <Sparkles className="w-5 h-5 text-green-600" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-[var(--color-gray-900)]">Tone & Audience</h3>
                                    <p className="text-sm text-[var(--color-gray-500)]">
                                        {brandProfile ? 'Override Brand Studio defaults or leave blank to use them' : 'Voice and targeting'}
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-[var(--color-gray-700)] mb-1">
                                        Tone of Voice
                                        {brandProfile?.tone_notes && !toneNotes && (
                                            <span className="text-xs text-green-600 ml-2">✓ Using Brand Studio</span>
                                        )}
                                    </label>
                                    <textarea
                                        value={toneNotes}
                                        onChange={(e) => setToneNotes(e.target.value)}
                                        placeholder={brandProfile?.tone_notes || 'e.g., Thought leadership, insightful, ends with questions'}
                                        rows={2}
                                        className={`w-full px-3 py-2 border rounded-lg text-sm resize-none ${!toneNotes && brandProfile?.tone_notes
                                            ? 'border-green-200 bg-green-50/30 placeholder:text-green-600/70'
                                            : 'border-[var(--color-gray-300)]'
                                            }`}
                                    />
                                    {!toneNotes && brandProfile?.tone_notes && (
                                        <p className="text-xs text-green-600 mt-1">
                                            ↳ Will use: "{brandProfile.tone_notes}"
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-[var(--color-gray-700)] mb-1">
                                        Target Audience
                                        {brandProfile?.who_we_serve && !audienceNotes && (
                                            <span className="text-xs text-green-600 ml-2">✓ Using Brand Studio</span>
                                        )}
                                    </label>
                                    <textarea
                                        value={audienceNotes}
                                        onChange={(e) => setAudienceNotes(e.target.value)}
                                        placeholder={brandProfile?.who_we_serve || 'e.g., Government digital leaders, tech executives'}
                                        rows={2}
                                        className={`w-full px-3 py-2 border rounded-lg text-sm resize-none ${!audienceNotes && brandProfile?.who_we_serve
                                            ? 'border-green-200 bg-green-50/30 placeholder:text-green-600/70'
                                            : 'border-[var(--color-gray-300)]'
                                            }`}
                                    />
                                    {!audienceNotes && brandProfile?.who_we_serve && (
                                        <p className="text-xs text-green-600 mt-1">
                                            ↳ Will use: "{brandProfile.who_we_serve}"
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Example Post */}
                    <div className="bg-white rounded-xl border border-[var(--color-gray-200)] p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                                <MessageSquareText className="w-5 h-5 text-purple-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-[var(--color-gray-900)]">Example Post (Style Reference)</h3>
                                <p className="text-sm text-[var(--color-gray-500)]">Paste an example - AI will match this style</p>
                            </div>
                        </div>

                        <textarea
                            value={examplePost}
                            onChange={(e) => setExamplePost(e.target.value)}
                            className="w-full min-h-[12rem] px-4 py-3 border border-[var(--color-gray-300)] rounded-lg text-sm resize-y"
                            placeholder="Paste an example LinkedIn post here..."
                        />
                    </div>

                    {/* Target Topics / Inspiration */}
                    <div className="bg-white rounded-xl border border-[var(--color-gray-200)] p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                                <Lightbulb className="w-5 h-5 text-amber-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-[var(--color-gray-900)]">Target Topics / Inspiration</h3>
                                <p className="text-sm text-[var(--color-gray-500)]">Optional - specific topics you want some posts about (one per line)</p>
                            </div>
                        </div>

                        <textarea
                            value={targetTopics}
                            onChange={(e) => setTargetTopics(e.target.value)}
                            className="w-full min-h-[8rem] px-4 py-3 border border-[var(--color-gray-300)] rounded-lg text-sm resize-y font-mono"
                            placeholder="e.g.&#10;Intranet strategy&#10;Content governance&#10;SharePoint migration lessons"
                        />
                        <p className="text-xs text-[var(--color-gray-400)] mt-2">
                            💡 These will inspire some (but not all) of your content ideas. The AI will create a varied mix.
                        </p>
                    </div>

                    {/* Next Step */}
                    {isGeneratingIdeas ? (
                        <div className="bg-gradient-to-r from-teal-50 to-cyan-50 rounded-xl border border-teal-200 p-6">
                            <div className="flex items-center gap-4 mb-4">
                                <div className="w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center">
                                    <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-[var(--color-gray-900)]">Generating Content Ideas</h3>
                                    <p className="text-sm text-[var(--color-gray-500)]">
                                        Creating {targetCount} unique topic ideas based on your brand
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                {(['saving', 'connecting', 'analyzing', 'generating', 'complete'] as const).map((stage, index) => {
                                    const stages = ['saving', 'connecting', 'analyzing', 'generating', 'complete']
                                    const currentIndex = stages.indexOf(ideaGenerationStage)
                                    const isComplete = index < currentIndex
                                    const isCurrent = stage === ideaGenerationStage
                                    const labels = {
                                        saving: 'Saving campaign settings...',
                                        connecting: 'Connecting to AI...',
                                        analyzing: 'Analyzing brand context...',
                                        generating: 'Generating topic ideas...',
                                        complete: 'Ideas ready!'
                                    }

                                    return (
                                        <div key={stage} className={`flex items-center gap-3 py-1 ${isCurrent ? 'text-teal-700' : isComplete ? 'text-teal-600' : 'text-gray-400'}`}>
                                            {isComplete ? (
                                                <Check className="w-4 h-4 text-teal-600" />
                                            ) : isCurrent ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <div className="w-4 h-4 rounded-full border border-current" />
                                            )}
                                            <span className={`text-sm ${isCurrent ? 'font-medium' : ''}`}>{labels[stage]}</span>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className="flex justify-end">
                            <Button
                                variant="pill"
                                onClick={handleGenerateIdeas}
                            >
                                Generate {targetCount} Content Ideas
                                <ChevronRight className="w-4 h-4" />
                            </Button>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'ideas' && (
                <div className="space-y-4">
                    {/* Actions Bar */}
                    <div className="bg-white rounded-xl border border-[var(--color-gray-200)] p-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={ideas.length > 0 && selectedIdeaIndices.size === ideas.length}
                                    onChange={() => {
                                        if (selectedIdeaIndices.size === ideas.length) {
                                            setSelectedIdeaIndices(new Set())
                                        } else {
                                            setSelectedIdeaIndices(new Set(ideas.map((_, i) => i)))
                                        }
                                    }}
                                    className="w-4 h-4 rounded border-[var(--color-gray-300)]"
                                />
                                <span className="text-sm text-[var(--color-gray-600)]">
                                    {selectedIdeaIndices.size === ideas.length ? 'Deselect all' : 'Select all'}
                                </span>
                            </label>
                            <span className="text-sm text-[var(--color-gray-400)]">
                                {ideas.length} ideas • {selectedIdeaIndices.size} selected
                            </span>
                            {selectedIdeaIndices.size > 0 && (
                                <>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={handleRegenerateSelected}
                                        disabled={isGeneratingIdeas}
                                    >
                                        <RefreshCw className={`w-4 h-4 ${isGeneratingIdeas ? 'animate-spin' : ''}`} />
                                        Regenerate Selected
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={async () => {
                                            const newIdeas = ideas.filter((_, i) => !selectedIdeaIndices.has(i))
                                            setIdeas(newIdeas)
                                            setSelectedIdeaIndices(new Set())
                                            await saveIdeas(newIdeas)
                                        }}
                                        className="text-red-600 hover:bg-red-50"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                        Delete Selected ({selectedIdeaIndices.size})
                                    </Button>
                                </>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="secondary"
                                onClick={handleGenerateIdeas}
                                disabled={isGeneratingIdeas}
                            >
                                <RefreshCw className={`w-4 h-4 ${isGeneratingIdeas ? 'animate-spin' : ''}`} />
                                Regenerate All
                            </Button>
                            <Button
                                variant="pill"
                                onClick={handleGeneratePosts}
                                disabled={ideas.length === 0 || isGeneratingPosts}
                            >
                                <Play className="w-4 h-4" />
                                Generate {ideas.length} Posts
                            </Button>
                        </div>
                    </div>

                    {/* Ideas List */}
                    <div className="bg-white rounded-xl border border-[var(--color-gray-200)] overflow-hidden">
                        {ideas.length === 0 ? (
                            <div className="p-12 text-center">
                                <div className="w-16 h-16 bg-[var(--color-gray-100)] rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Lightbulb className="w-8 h-8 text-[var(--color-gray-400)]" />
                                </div>
                                <p className="text-[var(--color-gray-500)] mb-4">No ideas generated yet</p>
                                <Button variant="pill" onClick={handleGenerateIdeas} disabled={isGeneratingIdeas}>
                                    {isGeneratingIdeas ? 'Generating...' : `Generate ${targetCount} Ideas`}
                                </Button>
                            </div>
                        ) : (
                            <div className="divide-y divide-[var(--color-gray-100)]">
                                {ideas.map((idea, index) => (
                                    <div
                                        key={index}
                                        className={`p-4 transition-colors ${selectedIdeaIndices.has(index) ? 'bg-blue-50' : 'hover:bg-[var(--color-gray-50)]'
                                            }`}
                                    >
                                        {editingIdeaIndex === index ? (
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={editingIdeaText}
                                                    onChange={(e) => setEditingIdeaText(e.target.value)}
                                                    className="flex-1 px-3 py-2 border border-[var(--color-gray-300)] rounded-lg text-sm"
                                                    autoFocus
                                                />
                                                <Button variant="primary" size="sm" onClick={handleSaveEditedIdea}>
                                                    <Check className="w-4 h-4" />
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => setEditingIdeaIndex(null)}>
                                                    <X className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIdeaIndices.has(index)}
                                                    onChange={() => toggleIdeaSelect(index)}
                                                    className="w-4 h-4 rounded"
                                                />
                                                <span className="text-xs font-medium bg-[var(--color-gray-100)] text-[var(--color-gray-600)] px-2 py-0.5 rounded">
                                                    #{index + 1}
                                                </span>
                                                <span className="flex-1 text-[var(--color-gray-800)]">{idea}</span>
                                                <Button variant="ghost" size="sm" onClick={() => handleEditIdea(index)}>
                                                    <Edit3 className="w-4 h-4" />
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => handleDeleteIdea(index)}>
                                                    <Trash2 className="w-4 h-4 text-red-500" />
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'posts' && (
                <div className="space-y-4">
                    {/* Bulk Actions Bar */}
                    {posts.length > 0 && (
                        <div className="bg-white rounded-xl border border-[var(--color-gray-200)] p-3 flex items-center justify-between">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={posts.length > 0 && selectedPostIds.size === posts.length}
                                    onChange={toggleSelectAllPosts}
                                    className="w-4 h-4 rounded"
                                />
                                <span className="text-sm text-[var(--color-gray-600)]">
                                    Select all ({selectedPostIds.size} selected)
                                </span>
                            </label>
                            {selectedPostIds.size > 0 && (
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={handleBulkGenerateImages}
                                        disabled={isBulkGeneratingImages || isBulkApplyingLogos}
                                    >
                                        <Sparkles className="w-4 h-4" />
                                        Generate Images ({selectedPostIds.size})
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setShowBulkLogoModal(true)}
                                        disabled={isBulkGeneratingImages || isBulkApplyingLogos}
                                        className="text-purple-600"
                                    >
                                        <Layers className="w-4 h-4" />
                                        Apply Logos ({selectedPostIds.size})
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={handleBulkDeletePosts}
                                        className="text-red-600"
                                        disabled={isBulkGeneratingImages || isBulkApplyingLogos}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                        Delete
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setShowBulkStatusModal(true)}
                                        disabled={isBulkGeneratingImages || isBulkApplyingLogos}
                                        className="text-indigo-600"
                                    >
                                        <Check className="w-4 h-4" />
                                        Change Status
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    <div className="bg-white rounded-xl border border-[var(--color-gray-200)] overflow-hidden">
                        {posts.length === 0 ? (
                            <div className="p-12 text-center">
                                <div className="w-16 h-16 bg-[var(--color-gray-100)] rounded-full flex items-center justify-center mx-auto mb-4">
                                    <FileText className="w-8 h-8 text-[var(--color-gray-400)]" />
                                </div>
                                <p className="text-[var(--color-gray-500)] mb-2">No posts generated yet</p>
                                <p className="text-sm text-[var(--color-gray-400)] mb-4">
                                    {ideas.length > 0
                                        ? 'Review your ideas and click "Generate Posts"'
                                        : 'Start by generating content ideas in the Ideas tab'}
                                </p>
                                {ideas.length > 0 && (
                                    <Button variant="pill" onClick={handleGeneratePosts} disabled={isGeneratingPosts}>
                                        <Play className="w-4 h-4" />
                                        Generate {ideas.length} Posts
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <div className="divide-y divide-[var(--color-gray-100)]">
                                {posts.map((post, index) => (
                                    <div
                                        key={post.id}
                                        className={`transition-colors ${selectedPostIds.has(post.id) ? 'bg-blue-50' : 'hover:bg-[var(--color-gray-50)]'
                                            }`}
                                    >
                                        <div className="p-4">
                                            <div className="flex items-start gap-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedPostIds.has(post.id)}
                                                    onChange={() => togglePostSelect(post.id)}
                                                    className="w-4 h-4 mt-1 rounded"
                                                />
                                                <div
                                                    className="flex-1 cursor-pointer"
                                                    onClick={() => setExpandedPostId(expandedPostId === post.id ? null : post.id)}
                                                >
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <span className="text-xs font-medium bg-[var(--color-gray-100)] text-[var(--color-gray-600)] px-2 py-0.5 rounded">
                                                            #{index + 1}
                                                        </span>
                                                        {/* Interactive Status Badge */}
                                                        <div className="relative">
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    setStatusDropdownPostId(statusDropdownPostId === post.id ? null : post.id)
                                                                }}
                                                                className="group"
                                                            >
                                                                <StatusBadge status={post.status} className="cursor-pointer hover:ring-2 hover:ring-[var(--color-primary)]/30" />
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
                                                    </div>
                                                    <div className={`text-[var(--color-gray-800)] text-sm ${expandedPostId === post.id ? 'whitespace-pre-wrap' : 'whitespace-pre-wrap line-clamp-3'
                                                        }`}>
                                                        {post.body || 'No content'}
                                                    </div>
                                                    {post.body && post.body.length > 200 && (
                                                        <button className="text-xs text-[var(--color-primary)] mt-2 hover:underline">
                                                            {expandedPostId === post.id ? '↑ Show less' : '↓ Show full post'}
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    {/* Image Status Indicators */}
                                                    <PostImageStatus postId={post.id} spaceId={currentSpace?.id || ''} refreshKey={imageStatusRefresh} />

                                                    <Button variant="ghost" size="sm" onClick={() => setImageModalPost({ ...post, image_prompt: (post as any).image_prompt || null, image_prompt_style: (post as any).image_prompt_style || null, image_settings: (post as any).image_settings || null, image_status: (post as any).image_status || 'no_image' })} title="Manage Images">
                                                        <ImageIcon className="w-4 h-4" />
                                                    </Button>
                                                    <Button variant="ghost" size="sm" onClick={() => handleOpenPreview(post)} title="Preview for Social Media">
                                                        <Eye className="w-4 h-4" />
                                                    </Button>
                                                    <Button variant="ghost" size="sm" onClick={() => handleDeletePost(post.id)}>
                                                        <Trash2 className="w-4 h-4 text-red-500" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Generation Progress Overlay */}
            {isGeneratingPosts && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-2xl p-8 max-w-lg w-full mx-4 shadow-2xl">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-14 h-14 bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-secondary)] rounded-xl flex items-center justify-center">
                                <Sparkles className="w-7 h-7 text-white animate-pulse" />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-[var(--color-gray-900)]">Generating Posts</h3>
                                <p className="text-sm text-[var(--color-gray-500)]">
                                    {generationProgress.current} of {generationProgress.total} completed
                                </p>
                            </div>
                        </div>

                        {/* Stage Indicator */}
                        <div className="flex items-center gap-2 mb-4">
                            <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${generationProgress.stage === 'connecting'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-green-100 text-green-700'
                                }`}>
                                {generationProgress.stage === 'connecting' ? (
                                    <><Loader2 className="w-3 h-3 animate-spin" /> Connecting to OpenAI...</>
                                ) : (
                                    <><Check className="w-3 h-3" /> Connected</>
                                )}
                            </div>
                            <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${generationProgress.stage === 'preparing'
                                ? 'bg-blue-100 text-blue-700'
                                : generationProgress.stage === 'connecting'
                                    ? 'bg-gray-100 text-gray-400'
                                    : 'bg-green-100 text-green-700'
                                }`}>
                                {generationProgress.stage === 'preparing' ? (
                                    <><Loader2 className="w-3 h-3 animate-spin" /> Preparing...</>
                                ) : generationProgress.stage === 'connecting' ? (
                                    'Preparing'
                                ) : (
                                    <><Check className="w-3 h-3" /> Ready</>
                                )}
                            </div>
                            <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${generationProgress.stage === 'generating'
                                ? 'bg-blue-100 text-blue-700'
                                : generationProgress.stage === 'completed'
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-gray-100 text-gray-400'
                                }`}>
                                {generationProgress.stage === 'generating' ? (
                                    <><Loader2 className="w-3 h-3 animate-spin" /> Writing...</>
                                ) : generationProgress.stage === 'completed' ? (
                                    <><Check className="w-3 h-3" /> Done!</>
                                ) : (
                                    'Writing'
                                )}
                            </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="mb-4">
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-[var(--color-gray-500)]">Progress</span>
                                <span className="font-medium text-[var(--color-primary)]">
                                    {generationProgress.total > 0
                                        ? Math.round((generationProgress.current / generationProgress.total) * 100)
                                        : 0}%
                                </span>
                            </div>
                            <div className="h-3 bg-[var(--color-gray-200)] rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] transition-all duration-500"
                                    style={{ width: `${generationProgress.total > 0 ? (generationProgress.current / generationProgress.total) * 100 : 0}%` }}
                                />
                            </div>
                        </div>

                        {/* Current Topic */}
                        {generationProgress.currentTopic && (
                            <div className="bg-blue-50 rounded-lg p-3 mb-4">
                                <p className="text-xs text-blue-600 mb-1 font-medium">Currently writing:</p>
                                <p className="text-sm text-blue-800 flex items-center gap-2">
                                    <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                                    <span className="line-clamp-2">{generationProgress.currentTopic}</span>
                                </p>
                            </div>
                        )}

                        {/* Topic Progress List */}
                        <div className="max-h-48 overflow-y-auto space-y-1">
                            {ideas.slice(0, 15).map((idea, i) => (
                                <div
                                    key={i}
                                    className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg transition-colors ${i < generationProgress.current
                                        ? 'bg-green-50 text-green-700'
                                        : i === generationProgress.current
                                            ? 'bg-blue-50 text-blue-700'
                                            : 'text-[var(--color-gray-400)]'
                                        }`}
                                >
                                    {i < generationProgress.current ? (
                                        <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                                    ) : i === generationProgress.current ? (
                                        <Loader2 className="w-4 h-4 animate-spin text-blue-500 flex-shrink-0" />
                                    ) : (
                                        <span className="w-4 h-4 rounded-full border border-[var(--color-gray-300)] flex-shrink-0" />
                                    )}
                                    <span className="truncate">{idea}</span>
                                </div>
                            ))}
                            {ideas.length > 15 && (
                                <p className="text-xs text-[var(--color-gray-400)] text-center py-2">
                                    + {ideas.length - 15} more topics
                                </p>
                            )}
                        </div>

                        <p className="text-xs text-[var(--color-gray-400)] text-center mt-4">
                            ✓ Posts are saved automatically as they complete
                        </p>
                    </div>
                </div>
            )}

            {/* Image Modal */}
            {imageModalPost && (
                <ImageModal
                    isOpen={!!imageModalPost}
                    onClose={() => setImageModalPost(null)}
                    post={imageModalPost}
                    onUpdate={() => {
                        // Refresh posts and image status indicators
                        setImageStatusRefresh(prev => prev + 1)
                        supabase
                            .from('posts')
                            .select('*')
                            .eq('campaign_id', id)
                            .order('created_at', { ascending: true })
                            .then(({ data }) => {
                                if (data) setPosts(data)
                            })
                    }}
                />
            )}

            {/* Preview Modal - Ready for Social Media */}
            {previewPost && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b border-[var(--color-gray-200)]">
                            <div>
                                <h2 className="text-lg font-semibold text-[var(--color-gray-900)]">Ready for Social Media</h2>
                                <p className="text-sm text-[var(--color-gray-500)]">Copy text and download image</p>
                            </div>
                            <button
                                onClick={() => {
                                    setPreviewPost(null)
                                    setPreviewImage(null)
                                }}
                                className="p-2 hover:bg-[var(--color-gray-100)] rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-6 space-y-6">
                            {/* Text Section - First */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-medium text-[var(--color-gray-700)]">Post Text</h3>
                                    <div className="flex items-center gap-2">
                                        {previewImage && (
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={handleDownloadImage}
                                            >
                                                <Download className="w-4 h-4" />
                                                Download Image
                                            </Button>
                                        )}
                                        <Button
                                            variant={copiedText ? 'primary' : 'secondary'}
                                            size="sm"
                                            onClick={handleCopyText}
                                        >
                                            {copiedText ? (
                                                <>
                                                    <CheckCircle2 className="w-4 h-4" />
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
                                </div>
                                <div className="bg-[var(--color-gray-50)] rounded-xl p-4 text-sm text-[var(--color-gray-800)] whitespace-pre-wrap">
                                    {previewPost.body || 'No content'}
                                </div>
                            </div>

                            {/* Image Section - Second */}
                            {previewImage ? (
                                <div className="space-y-3">
                                    <div className="relative rounded-xl overflow-hidden bg-[var(--color-gray-100)]">
                                        <img
                                            src={previewImage.url}
                                            alt="Post image"
                                            className="w-full object-contain max-h-[400px]"
                                        />
                                    </div>
                                    <Button
                                        variant="secondary"
                                        onClick={handleDownloadImage}
                                        className="w-full"
                                    >
                                        <Download className="w-4 h-4" />
                                        Download Image
                                    </Button>
                                </div>
                            ) : (
                                <div className="bg-[var(--color-gray-50)] rounded-xl p-8 text-center">
                                    <ImageIcon className="w-12 h-12 text-[var(--color-gray-300)] mx-auto mb-2" />
                                    <p className="text-[var(--color-gray-500)]">No primary image selected</p>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        className="mt-3"
                                        onClick={() => {
                                            setPreviewPost(null)
                                            setPreviewImage(null)
                                            setImageModalPost({
                                                ...previewPost,
                                                image_prompt: (previewPost as any).image_prompt || null,
                                                image_prompt_style: (previewPost as any).image_prompt_style || null,
                                                image_settings: (previewPost as any).image_settings || null,
                                                image_status: (previewPost as any).image_status || 'no_image'
                                            })
                                        }}
                                    >
                                        <ImageIcon className="w-4 h-4" />
                                        Add Images
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
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
                                    <p className="text-sm text-[var(--color-gray-500)]">Apply logos to {selectedPostIds.size} selected posts</p>
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
                                    <p className="text-sm text-[var(--color-gray-500)]">Update status for {selectedPostIds.size} selected posts</p>
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
                            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${bulkImageProgress.phase === 'complete'
                                ? 'bg-green-500'
                                : 'bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-secondary)]'
                                }`}>
                                {bulkImageProgress.phase === 'complete' ? (
                                    <CheckCircle2 className="w-7 h-7 text-white" />
                                ) : (
                                    <Sparkles className="w-7 h-7 text-white animate-pulse" />
                                )}
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-[var(--color-gray-900)]">
                                    {bulkImageProgress.phase === 'complete' ? 'Generation Complete!' : 'Generating Images'}
                                </h3>
                                <p className="text-sm text-[var(--color-gray-500)]">
                                    {bulkImageProgress.current} of {bulkImageProgress.total} posts complete
                                </p>
                            </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="mb-6">
                            <div className="flex justify-between text-sm mb-2">
                                <span className="text-[var(--color-gray-500)]">Progress</span>
                                <span className="font-semibold text-[var(--color-primary)]">
                                    {bulkImageProgress.total > 0 ? Math.round((bulkImageProgress.current / bulkImageProgress.total) * 100) : 0}%
                                </span>
                            </div>
                            <div className="h-4 bg-[var(--color-gray-200)] rounded-full overflow-hidden">
                                <div
                                    className={`h-full transition-all duration-500 relative ${bulkImageProgress.phase === 'complete'
                                        ? 'bg-green-500'
                                        : 'bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)]'
                                        }`}
                                    style={{ width: `${bulkImageProgress.total > 0 ? (bulkImageProgress.current / bulkImageProgress.total) * 100 : 0}%` }}
                                >
                                    {bulkImageProgress.phase !== 'complete' && (
                                        <div className="absolute inset-0 bg-white/20 animate-pulse" />
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Status Counts */}
                        <div className="flex gap-4 mb-4">
                            <div className="flex items-center gap-2 text-sm">
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                                <span className="text-[var(--color-gray-600)]">{bulkImageProgress.successCount} successful</span>
                            </div>
                            {bulkImageProgress.errorCount > 0 && (
                                <div className="flex items-center gap-2 text-sm">
                                    <X className="w-4 h-4 text-red-500" />
                                    <span className="text-[var(--color-gray-600)]">{bulkImageProgress.errorCount} failed</span>
                                </div>
                            )}
                        </div>

                        {/* Status */}
                        <div className={`rounded-xl p-4 flex items-center gap-3 ${bulkImageProgress.phase === 'complete' ? 'bg-green-50' : 'bg-blue-50'
                            }`}>
                            {bulkImageProgress.phase === 'complete' ? (
                                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                            ) : (
                                <Loader2 className="w-5 h-5 text-blue-600 animate-spin flex-shrink-0" />
                            )}
                            <div>
                                <div className={`text-sm font-medium ${bulkImageProgress.phase === 'complete' ? 'text-green-900' : 'text-blue-900'
                                    }`}>
                                    {bulkImageProgress.statusText}
                                </div>
                                {bulkImageProgress.phase !== 'complete' && (
                                    <div className="text-xs text-blue-600">
                                        {bulkImageProgress.phase === 'fetching' ? 'Reading post data...' : 'AI is creating unique images'}
                                    </div>
                                )}
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
                            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${bulkLogoProgress.phase === 'complete'
                                ? 'bg-green-500'
                                : 'bg-gradient-to-br from-purple-500 to-pink-500'
                                }`}>
                                {bulkLogoProgress.phase === 'complete' ? (
                                    <CheckCircle2 className="w-7 h-7 text-white" />
                                ) : (
                                    <Layers className="w-7 h-7 text-white animate-pulse" />
                                )}
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-[var(--color-gray-900)]">
                                    {bulkLogoProgress.phase === 'complete' ? 'Logos Applied!' : 'Applying Logos'}
                                </h3>
                                <p className="text-sm text-[var(--color-gray-500)]">
                                    {bulkLogoProgress.current} of {bulkLogoProgress.total} posts complete
                                </p>
                            </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="mb-6">
                            <div className="flex justify-between text-sm mb-2">
                                <span className="text-[var(--color-gray-500)]">Progress</span>
                                <span className="font-semibold text-purple-600">
                                    {bulkLogoProgress.total > 0 ? Math.round((bulkLogoProgress.current / bulkLogoProgress.total) * 100) : 0}%
                                </span>
                            </div>
                            <div className="h-4 bg-[var(--color-gray-200)] rounded-full overflow-hidden">
                                <div
                                    className={`h-full transition-all duration-500 relative ${bulkLogoProgress.phase === 'complete'
                                        ? 'bg-green-500'
                                        : 'bg-gradient-to-r from-purple-500 to-pink-500'
                                        }`}
                                    style={{ width: `${bulkLogoProgress.total > 0 ? (bulkLogoProgress.current / bulkLogoProgress.total) * 100 : 0}%` }}
                                >
                                    {bulkLogoProgress.phase !== 'complete' && (
                                        <div className="absolute inset-0 bg-white/20 animate-pulse" />
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Status Counts + Options */}
                        <div className="flex flex-wrap gap-2 mb-4">
                            <div className="flex items-center gap-1.5 text-sm px-2 py-1 bg-green-50 text-green-700 rounded-full">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {bulkLogoProgress.successCount} done
                            </div>
                            {bulkLogoProgress.errorCount > 0 && (
                                <div className="flex items-center gap-1.5 text-sm px-2 py-1 bg-red-50 text-red-700 rounded-full">
                                    <X className="w-3.5 h-3.5" />
                                    {bulkLogoProgress.errorCount} skipped
                                </div>
                            )}
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

                        {/* Status */}
                        <div className={`rounded-xl p-4 flex items-center gap-3 ${bulkLogoProgress.phase === 'complete' ? 'bg-green-50' : 'bg-purple-50'
                            }`}>
                            {bulkLogoProgress.phase === 'complete' ? (
                                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                            ) : (
                                <Loader2 className="w-5 h-5 text-purple-600 animate-spin flex-shrink-0" />
                            )}
                            <div>
                                <div className={`text-sm font-medium ${bulkLogoProgress.phase === 'complete' ? 'text-green-900' : 'text-purple-900'
                                    }`}>
                                    {bulkLogoProgress.statusText}
                                </div>
                                {bulkLogoProgress.phase !== 'complete' && (
                                    <div className="text-xs text-purple-600">
                                        {bulkLogoProgress.phase === 'loading' && 'Finding source images...'}
                                        {bulkLogoProgress.phase === 'compositing' && 'Drawing logos onto image...'}
                                        {bulkLogoProgress.phase === 'uploading' && 'Saving to cloud storage...'}
                                    </div>
                                )}
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
