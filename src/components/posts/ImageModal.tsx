import { useState, useEffect, useRef, useCallback } from 'react'
import {
    X, ChevronDown, ChevronUp, Copy, Check, Sparkles, Loader2,
    Image as ImageIcon, Upload, Trash2, Star, StarOff, RefreshCw,
    ZoomIn, Download, AlertCircle, Layers, Eye
} from 'lucide-react'
import { Button, Modal } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useSpaceStore } from '@/stores/spaceStore'
import type { PostImage, ImageSettings, PromptStyle, ImageStatus } from '@/types/image'
import { DEFAULT_IMAGE_SETTINGS, ASPECT_RATIO_DIMENSIONS } from '@/types/image'

interface Post {
    id: string
    title: string
    body: string | null
    image_prompt: string | null
    image_prompt_style: PromptStyle | null
    image_settings: ImageSettings | null
    image_status: ImageStatus
}

interface ImageModalProps {
    isOpen: boolean
    onClose: () => void
    post: Post
    onUpdate: () => void
}

export function ImageModal({ isOpen, onClose, post, onUpdate }: ImageModalProps) {
    const { currentSpace } = useSpaceStore()

    // State
    const [isContextExpanded, setIsContextExpanded] = useState(true)
    const [copiedText, setCopiedText] = useState(false)
    const [prompt, setPrompt] = useState(post.image_prompt || '')
    const [promptStyle, setPromptStyle] = useState<PromptStyle>(post.image_prompt_style || 'realistic')
    const [settings, setSettings] = useState<ImageSettings>(post.image_settings || DEFAULT_IMAGE_SETTINGS)
    const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false)
    const [isGeneratingImages, setIsGeneratingImages] = useState(false)
    const [images, setImages] = useState<PostImage[]>([])
    const [isLoadingImages, setIsLoadingImages] = useState(true)
    const [previewImage, setPreviewImage] = useState<PostImage | null>(null)
    const [uploadProgress, setUploadProgress] = useState<number | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [useAiPrompt, setUseAiPrompt] = useState(true)
    const [selectedImageId, setSelectedImageId] = useState<string | null>(null)
    const [applyMainLogo, setApplyMainLogo] = useState(false)
    const [applyTopLeft, setApplyTopLeft] = useState(true)
    const [applyBottomRight, setApplyBottomRight] = useState(true)
    const [isApplyingLogo, setIsApplyingLogo] = useState(false)
    const [successMessage, setSuccessMessage] = useState<string | null>(null)

    // Prompt preview state
    const [showPromptPreview, setShowPromptPreview] = useState(false)
    const [isLoadingPreview, setIsLoadingPreview] = useState(false)
    const [previewPrompts, setPreviewPrompts] = useState<{ realistic: string; editorial: string } | null>(null)

    // Generation progress state
    const [generationProgress, setGenerationProgress] = useState<{
        step: number  // 0-4: 0=idle, 1=realistic prompt, 2=realistic image, 3=editorial prompt, 4=editorial image
        statusText: string
    }>({ step: 0, statusText: '' })

    const fileInputRef = useRef<HTMLInputElement>(null)

    // Fetch images on mount
    const fetchImages = useCallback(async () => {
        if (!currentSpace) return

        setIsLoadingImages(true)
        try {
            const { data, error } = await supabase
                .from('post_images')
                .select('*')
                .eq('post_id', post.id)
                .eq('space_id', currentSpace.id)
                .order('created_at', { ascending: false })

            if (error) throw error
            setImages(data || [])
        } catch (err) {
            console.error('Error fetching images:', err)
        } finally {
            setIsLoadingImages(false)
        }
    }, [post.id, currentSpace])

    // Brand profile state for logo URLs
    const [brandProfile, setBrandProfile] = useState<{
        logo_url?: string | null
        logo_top_left_url?: string | null
        logo_bottom_right_url?: string | null
    } | null>(null)

    // Fetch brand profile for logos
    const fetchBrandProfile = useCallback(async () => {
        if (!currentSpace) return
        try {
            const { data, error } = await supabase
                .from('brand_profile')
                .select('logo_url, logo_top_left_url, logo_bottom_right_url')
                .eq('space_id', currentSpace.id)
                .single()

            if (error && error.code !== 'PGRST116') throw error
            setBrandProfile(data)
        } catch (err) {
            console.error('Error fetching brand profile:', err)
        }
    }, [currentSpace])

    useEffect(() => {
        if (isOpen) {
            fetchImages()
            fetchBrandProfile()
            setPrompt(post.image_prompt || '')
            setPromptStyle(post.image_prompt_style || 'realistic')
            setSettings(post.image_settings || DEFAULT_IMAGE_SETTINGS)
        }
    }, [isOpen, post, fetchImages, fetchBrandProfile])

    // Copy post text
    const handleCopyText = async () => {
        if (post.body) {
            await navigator.clipboard.writeText(post.body)
            setCopiedText(true)
            setTimeout(() => setCopiedText(false), 2000)
        }
    }

    // Generate image prompt
    const handleGeneratePrompt = async (style: PromptStyle) => {
        if (!currentSpace || !post.body) return

        setIsGeneratingPrompt(true)
        setError(null)

        try {
            const { data, error } = await supabase.functions.invoke('generate-image-prompt', {
                body: {
                    post_id: post.id,
                    space_id: currentSpace.id,
                    style: style,
                    post_body: post.body,
                },
            })

            if (error) throw error

            if (data?.prompt) {
                setPrompt(data.prompt)
                setPromptStyle(style)

                // Save to database
                await supabase
                    .from('posts')
                    .update({
                        image_prompt: data.prompt,
                        image_prompt_style: style,
                        image_status: 'prompt_ready',
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', post.id)

                onUpdate()
            }
        } catch (err) {
            console.error('Error generating prompt:', err)
            setError(err instanceof Error ? err.message : 'Failed to generate prompt')
        } finally {
            setIsGeneratingPrompt(false)
        }
    }

    // Save prompt changes
    const handleSavePrompt = async () => {
        try {
            await supabase
                .from('posts')
                .update({
                    image_prompt: prompt,
                    image_prompt_style: promptStyle,
                    image_settings: settings,
                    image_status: prompt ? 'prompt_ready' : 'no_image',
                    updated_at: new Date().toISOString(),
                })
                .eq('id', post.id)

            onUpdate()
        } catch (err) {
            console.error('Error saving prompt:', err)
        }
    }

    // Generate images with manual prompt
    const handleGenerateImages = async (count: number = 2) => {
        if (!currentSpace || !prompt) return

        setIsGeneratingImages(true)
        setError(null)

        try {
            const { data, error } = await supabase.functions.invoke('generate-post-images', {
                body: {
                    post_id: post.id,
                    space_id: currentSpace.id,
                    prompt: prompt,
                    settings: settings,
                    count: count,
                },
            })

            if (error) throw error

            // Refresh images
            await fetchImages()
            onUpdate()
        } catch (err) {
            console.error('Error generating images:', err)
            setError(err instanceof Error ? err.message : 'Failed to generate images')
        } finally {
            setIsGeneratingImages(false)
        }
    }

    // Preview prompts: Show user what AI will generate before actually generating
    const handlePreviewPrompts = async () => {
        if (!currentSpace || !post.body) return

        setIsLoadingPreview(true)
        setShowPromptPreview(true)
        setPreviewPrompts(null)

        try {
            // Generate realistic prompt preview
            const realisticPromptResult = await supabase.functions.invoke('generate-image-prompt', {
                body: {
                    post_id: post.id,
                    space_id: currentSpace.id,
                    style: 'realistic',
                    post_body: post.body,
                },
            })

            const realisticPrompt = realisticPromptResult.data?.prompt || 'Failed to generate realistic prompt'

            // Generate editorial prompt preview
            const editorialPromptResult = await supabase.functions.invoke('generate-image-prompt', {
                body: {
                    post_id: post.id,
                    space_id: currentSpace.id,
                    style: 'editorial',
                    post_body: post.body,
                },
            })

            const editorialPrompt = editorialPromptResult.data?.prompt || 'Failed to generate editorial prompt'

            setPreviewPrompts({
                realistic: realisticPrompt,
                editorial: editorialPrompt,
            })
        } catch (err) {
            console.error('Error previewing prompts:', err)
            setError('Failed to preview prompts')
        } finally {
            setIsLoadingPreview(false)
        }
    }

    // Auto-generate: AI creates prompt and generates images (one realistic, one editorial)
    const handleAutoGenerate = async () => {
        if (!currentSpace || !post.body) return

        setIsGeneratingImages(true)
        setError(null)
        setGenerationProgress({ step: 1, statusText: 'Creating realistic prompt...' })

        try {
            // Generate 2 images with different styles
            // First, generate a realistic prompt
            const realisticPromptResult = await supabase.functions.invoke('generate-image-prompt', {
                body: {
                    post_id: post.id,
                    space_id: currentSpace.id,
                    style: 'realistic',
                    post_body: post.body,
                },
            })

            if (realisticPromptResult.error) throw realisticPromptResult.error
            const realisticPrompt = realisticPromptResult.data?.prompt || ''

            setGenerationProgress({ step: 2, statusText: 'Generating realistic image...' })

            // Generate realistic image
            await supabase.functions.invoke('generate-post-images', {
                body: {
                    post_id: post.id,
                    space_id: currentSpace.id,
                    prompt: realisticPrompt,
                    settings: { ...DEFAULT_IMAGE_SETTINGS, style: 'photographic' },
                    count: 1,
                },
            })

            setGenerationProgress({ step: 3, statusText: 'Creating editorial prompt...' })

            // Generate editorial prompt
            const editorialPromptResult = await supabase.functions.invoke('generate-image-prompt', {
                body: {
                    post_id: post.id,
                    space_id: currentSpace.id,
                    style: 'editorial',
                    post_body: post.body,
                },
            })

            if (editorialPromptResult.error) throw editorialPromptResult.error
            const editorialPrompt = editorialPromptResult.data?.prompt || ''

            setGenerationProgress({ step: 4, statusText: 'Generating editorial image...' })

            // Generate editorial/illustrative image
            await supabase.functions.invoke('generate-post-images', {
                body: {
                    post_id: post.id,
                    space_id: currentSpace.id,
                    prompt: editorialPrompt,
                    settings: { ...DEFAULT_IMAGE_SETTINGS, style: 'illustrative' },
                    count: 1,
                },
            })

            // Refresh images
            await fetchImages()
            onUpdate()
        } catch (err) {
            console.error('Error auto-generating images:', err)
            setError(err instanceof Error ? err.message : 'Failed to generate images')
        } finally {
            setIsGeneratingImages(false)
            setGenerationProgress({ step: 0, statusText: '' })
        }
    }

    // Upload image
    const handleUpload = async (file: File) => {
        if (!currentSpace) return

        setUploadProgress(0)
        setError(null)

        try {
            const ext = file.name.split('.').pop()
            const filename = `${post.id}/${Date.now()}.${ext}`

            // Upload to storage
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('generated-images')
                .upload(filename, file, {
                    upsert: true,
                })

            // Set progress to 100 after upload completes
            setUploadProgress(100)

            if (uploadError) throw uploadError

            // Create post_image record
            const { error: insertError } = await supabase
                .from('post_images')
                .insert({
                    post_id: post.id,
                    space_id: currentSpace.id,
                    source_type: 'uploaded',
                    storage_path: filename,
                    generation_status: 'completed',
                    is_primary: images.length === 0, // First image is primary
                    width: 1024, // We'll get actual dimensions later
                    height: 1024,
                    file_size: file.size,
                    mime_type: file.type,
                })

            if (insertError) throw insertError

            // Refresh images
            await fetchImages()
            onUpdate()
        } catch (err) {
            console.error('Error uploading image:', err)
            setError(err instanceof Error ? err.message : 'Failed to upload image')
        } finally {
            setUploadProgress(null)
        }
    }

    // Set primary image
    const handleSetPrimary = async (imageId: string) => {
        try {
            await supabase
                .from('post_images')
                .update({ is_primary: true })
                .eq('id', imageId)

            await fetchImages()
            onUpdate()
        } catch (err) {
            console.error('Error setting primary:', err)
        }
    }

    // Delete image
    const handleDeleteImage = async (image: PostImage) => {
        try {
            // Delete from storage
            await supabase.storage
                .from('generated-images')
                .remove([image.storage_path])

            // Delete record
            await supabase
                .from('post_images')
                .delete()
                .eq('id', image.id)

            await fetchImages()
            onUpdate()
        } catch (err) {
            console.error('Error deleting image:', err)
        }
    }

    // Apply logo overlay to selected image using client-side canvas compositing
    const handleApplyLogo = async () => {
        if (!currentSpace || !selectedImageId) return

        // Find the selected image
        const sourceImage = images.find(img => img.id === selectedImageId)
        if (!sourceImage) {
            setError('Source image not found')
            return
        }

        // Determine which logos to apply
        const topLeftLogoUrl = applyMainLogo
            ? brandProfile?.logo_url
            : applyTopLeft
                ? brandProfile?.logo_top_left_url
                : null
        const bottomRightLogoUrl = applyBottomRight
            ? brandProfile?.logo_bottom_right_url
            : null

        if (!topLeftLogoUrl && !bottomRightLogoUrl) {
            setError('Please select at least one logo position')
            return
        }

        setIsApplyingLogo(true)
        setError(null)

        try {
            // Get source image URL
            const sourceImageUrl = getImageUrl(sourceImage.storage_path)

            // Load images using canvas
            const loadImage = (url: string): Promise<HTMLImageElement> => {
                return new Promise((resolve, reject) => {
                    const img = new window.Image()
                    img.crossOrigin = 'anonymous'
                    img.onload = () => resolve(img)
                    img.onerror = (e) => reject(new Error(`Failed to load image: ${url}`))
                    img.src = url
                })
            }

            // Load the source image
            const sourceImg = await loadImage(sourceImageUrl)

            // Create canvas at source image size
            const canvas = document.createElement('canvas')
            canvas.width = sourceImg.naturalWidth || sourceImg.width
            canvas.height = sourceImg.naturalHeight || sourceImg.height
            const ctx = canvas.getContext('2d')
            if (!ctx) throw new Error('Failed to get canvas context')

            // Draw source image
            ctx.drawImage(sourceImg, 0, 0)

            // Logo size and margin configuration
            const marginPercent = 0.03 // 3% margin from edges
            const maxLogoSizePercent = 0.15 // Max 15% of image dimension

            // Draw top-left logo
            if (topLeftLogoUrl) {
                try {
                    const logoImg = await loadImage(topLeftLogoUrl)
                    const maxLogoWidth = canvas.width * maxLogoSizePercent
                    const maxLogoHeight = canvas.height * maxLogoSizePercent

                    // Scale logo to fit within max dimensions while maintaining aspect ratio
                    const logoAspect = logoImg.width / logoImg.height
                    let logoWidth = maxLogoWidth
                    let logoHeight = logoWidth / logoAspect
                    if (logoHeight > maxLogoHeight) {
                        logoHeight = maxLogoHeight
                        logoWidth = logoHeight * logoAspect
                    }

                    const x = canvas.width * marginPercent
                    const y = canvas.height * marginPercent
                    ctx.drawImage(logoImg, x, y, logoWidth, logoHeight)
                } catch (logoErr) {
                    console.warn('Failed to load top-left logo:', logoErr)
                }
            }

            // Draw bottom-right logo
            if (bottomRightLogoUrl) {
                try {
                    const logoImg = await loadImage(bottomRightLogoUrl)
                    const maxLogoWidth = canvas.width * maxLogoSizePercent
                    const maxLogoHeight = canvas.height * maxLogoSizePercent

                    // Scale logo to fit within max dimensions while maintaining aspect ratio
                    const logoAspect = logoImg.width / logoImg.height
                    let logoWidth = maxLogoWidth
                    let logoHeight = logoWidth / logoAspect
                    if (logoHeight > maxLogoHeight) {
                        logoHeight = maxLogoHeight
                        logoWidth = logoHeight * logoAspect
                    }

                    const x = canvas.width - logoWidth - (canvas.width * marginPercent)
                    const y = canvas.height - logoHeight - (canvas.height * marginPercent)
                    ctx.drawImage(logoImg, x, y, logoWidth, logoHeight)
                } catch (logoErr) {
                    console.warn('Failed to load bottom-right logo:', logoErr)
                }
            }

            // Convert canvas to blob
            const blob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(
                    (b) => b ? resolve(b) : reject(new Error('Failed to create blob')),
                    'image/png',
                    1.0
                )
            })

            // Generate filename and upload to storage
            const timestamp = Date.now()
            const fileName = `${post.id}/${timestamp}_with_logo.png`

            const { error: uploadError } = await supabase.storage
                .from('generated-images')
                .upload(fileName, blob, {
                    contentType: 'image/png',
                    upsert: true,
                })

            if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

            // Determine logo position description for prompt_used
            let logoPositionDesc = ''
            if (topLeftLogoUrl && bottomRightLogoUrl) {
                logoPositionDesc = applyMainLogo ? 'main-logo-top-left + bottom-right' : 'top-left + bottom-right'
            } else if (topLeftLogoUrl) {
                logoPositionDesc = applyMainLogo ? 'main-logo-top-left' : 'top-left'
            } else {
                logoPositionDesc = 'bottom-right'
            }

            // Create new post_images record
            const { error: insertError } = await supabase
                .from('post_images')
                .insert({
                    post_id: post.id,
                    space_id: currentSpace.id,
                    source_type: 'generated',
                    storage_path: fileName,
                    generation_status: 'completed',
                    is_primary: true,
                    width: canvas.width,
                    height: canvas.height,
                    file_size: blob.size,
                    mime_type: 'image/png',
                    prompt_used: `[LOGO OVERLAY] ${logoPositionDesc} (from image ${selectedImageId})`,
                })

            if (insertError) throw new Error(`Failed to save record: ${insertError.message}`)

            // Mark the source image as no longer primary
            await supabase
                .from('post_images')
                .update({ is_primary: false })
                .eq('id', selectedImageId)

            // Refresh images and close selection
            await fetchImages()
            onUpdate()
            setSelectedImageId(null)
            setSuccessMessage('Logo overlay applied! New image created and set as primary.')
            setTimeout(() => setSuccessMessage(null), 4000)

        } catch (err) {
            console.error('Error applying logo:', err)
            setError(err instanceof Error ? err.message : 'Failed to apply logo')
        } finally {
            setIsApplyingLogo(false)
        }
    }

    // Get public URL for image
    const getImageUrl = (path: string) => {
        const { data } = supabase.storage
            .from('generated-images')
            .getPublicUrl(path)
        return data.publicUrl
    }

    return (
        <>
            <Modal
                isOpen={isOpen}
                onClose={onClose}
                title={`Image: ${post.title}`}
                size="xl"
            >
                <div className="space-y-6 max-h-[80vh] overflow-y-auto">
                    {/* Error Display */}
                    {error && (
                        <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg">
                            <AlertCircle className="w-4 h-4" />
                            <span className="text-sm">{error}</span>
                            <button onClick={() => setError(null)} className="ml-auto">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    {/* Success Display */}
                    {successMessage && (
                        <div className="flex items-center gap-2 p-3 bg-green-50 text-green-700 rounded-lg">
                            <Check className="w-4 h-4" />
                            <span className="text-sm">{successMessage}</span>
                            <button onClick={() => setSuccessMessage(null)} className="ml-auto">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    )}

                    {/* Post Context Section */}
                    <div className="border border-[var(--color-gray-200)] rounded-lg overflow-hidden">
                        <button
                            onClick={() => setIsContextExpanded(!isContextExpanded)}
                            className="w-full flex items-center justify-between p-4 bg-[var(--color-gray-50)] hover:bg-[var(--color-gray-100)] transition-colors"
                        >
                            <span className="font-medium text-[var(--color-gray-700)]">Post Context</span>
                            <div className="flex items-center gap-2">
                                {post.body && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleCopyText()
                                        }}
                                        className="p-1.5 rounded hover:bg-[var(--color-gray-200)]"
                                        title="Copy text"
                                    >
                                        {copiedText ? (
                                            <Check className="w-4 h-4 text-green-500" />
                                        ) : (
                                            <Copy className="w-4 h-4 text-[var(--color-gray-500)]" />
                                        )}
                                    </button>
                                )}
                                {isContextExpanded ? (
                                    <ChevronUp className="w-4 h-4 text-[var(--color-gray-500)]" />
                                ) : (
                                    <ChevronDown className="w-4 h-4 text-[var(--color-gray-500)]" />
                                )}
                            </div>
                        </button>
                        {isContextExpanded && (
                            <div className="p-4 text-sm text-[var(--color-gray-700)] whitespace-pre-wrap max-h-48 overflow-y-auto">
                                {post.body || <span className="text-[var(--color-gray-400)] italic">No post content yet</span>}
                            </div>
                        )}
                    </div>

                    {/* Image Prompt Section */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <h3 className="font-medium text-[var(--color-gray-900)]">Image Generation</h3>
                            <label className="flex items-center gap-2 text-sm text-[var(--color-gray-600)]">
                                <input
                                    type="checkbox"
                                    checked={useAiPrompt}
                                    onChange={(e) => setUseAiPrompt(e.target.checked)}
                                    className="w-4 h-4 rounded"
                                />
                                Use AI prompt
                            </label>
                        </div>

                        {/* AI Mode - Simple one-click generation */}
                        {useAiPrompt && (
                            <div className="space-y-3">
                                <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg">
                                    <p className="text-sm text-[var(--color-gray-600)] mb-3">
                                        AI will analyze your post and generate two images: one realistic and one artistic/editorial style.
                                    </p>
                                    <div className="flex gap-2">
                                        <Button
                                            onClick={handleAutoGenerate}
                                            disabled={isGeneratingImages || isLoadingPreview || !post.body}
                                            isLoading={isGeneratingImages}
                                        >
                                            <Sparkles className="w-4 h-4" />
                                            Generate 2 AI Images
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            onClick={handlePreviewPrompts}
                                            disabled={isGeneratingImages || isLoadingPreview || !post.body}
                                        >
                                            {isLoadingPreview ? (
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                            ) : (
                                                <Eye className="w-4 h-4" />
                                            )}
                                            {showPromptPreview ? 'Refresh Preview' : 'Preview Prompts'}
                                        </Button>
                                    </div>

                                    {/* Generation Progress Bar */}
                                    {isGeneratingImages && generationProgress.step > 0 && (
                                        <div className="mt-4 space-y-2">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="font-medium text-[var(--color-gray-700)]">{generationProgress.statusText}</span>
                                                <span className="text-[var(--color-gray-500)]">Step {generationProgress.step} of 4</span>
                                            </div>
                                            <div className="h-2 bg-[var(--color-gray-200)] rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] transition-all duration-500 ease-out"
                                                    style={{ width: `${(generationProgress.step / 4) * 100}%` }}
                                                />
                                            </div>
                                            <div className="flex justify-between text-xs text-[var(--color-gray-500)]">
                                                <div className="flex items-center gap-1">
                                                    <span className={`w-2 h-2 rounded-full ${generationProgress.step >= 1 ? 'bg-blue-500' : 'bg-gray-300'}`} />
                                                    <span className={generationProgress.step >= 1 ? 'text-blue-600 font-medium' : ''}>Prompt 1</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <span className={`w-2 h-2 rounded-full ${generationProgress.step >= 2 ? 'bg-blue-500' : 'bg-gray-300'}`} />
                                                    <span className={generationProgress.step >= 2 ? 'text-blue-600 font-medium' : ''}>Image 1</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <span className={`w-2 h-2 rounded-full ${generationProgress.step >= 3 ? 'bg-purple-500' : 'bg-gray-300'}`} />
                                                    <span className={generationProgress.step >= 3 ? 'text-purple-600 font-medium' : ''}>Prompt 2</span>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <span className={`w-2 h-2 rounded-full ${generationProgress.step >= 4 ? 'bg-purple-500' : 'bg-gray-300'}`} />
                                                    <span className={generationProgress.step >= 4 ? 'text-purple-600 font-medium' : ''}>Image 2</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Prompt Preview Panel */}
                                {showPromptPreview && (
                                    <div className="border border-[var(--color-gray-200)] rounded-lg overflow-hidden">
                                        <button
                                            className="w-full flex items-center justify-between p-3 bg-[var(--color-gray-50)] hover:bg-[var(--color-gray-100)] transition-colors"
                                            onClick={() => setShowPromptPreview(false)}
                                        >
                                            <span className="font-medium text-sm text-[var(--color-gray-700)]">
                                                📝 Prompt Preview
                                            </span>
                                            <ChevronUp className="w-4 h-4 text-[var(--color-gray-500)]" />
                                        </button>
                                        <div className="p-4 space-y-4">
                                            {isLoadingPreview ? (
                                                <div className="flex items-center justify-center py-8 gap-3">
                                                    <Loader2 className="w-5 h-5 animate-spin text-[var(--color-primary)]" />
                                                    <span className="text-sm text-[var(--color-gray-500)]">Generating prompts...</span>
                                                </div>
                                            ) : previewPrompts ? (
                                                <>
                                                    <div>
                                                        <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-gray-500)] uppercase mb-2">
                                                            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                                                            Realistic / Photographic Style
                                                        </div>
                                                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-[var(--color-gray-700)] whitespace-pre-wrap">
                                                            {previewPrompts.realistic}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-gray-500)] uppercase mb-2">
                                                            <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                                                            Editorial / Illustrative Style
                                                        </div>
                                                        <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-sm text-[var(--color-gray-700)] whitespace-pre-wrap">
                                                            {previewPrompts.editorial}
                                                        </div>
                                                    </div>
                                                </>
                                            ) : (
                                                <p className="text-center text-sm text-[var(--color-gray-500)] py-4">
                                                    Click "Preview Prompts" to see what AI will generate
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Manual Mode - Show prompt textarea and settings */}
                        {!useAiPrompt && (
                            <>
                                <textarea
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    onBlur={handleSavePrompt}
                                    placeholder="Describe the image you want to generate..."
                                    rows={4}
                                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-gray-300)] focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent text-sm"
                                />

                                {/* Settings - only in manual mode */}
                                <div className="flex flex-wrap items-center gap-4 p-3 bg-[var(--color-gray-50)] rounded-lg">
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-[var(--color-gray-600)]">Style:</label>
                                        <select
                                            value={settings.style}
                                            onChange={(e) => setSettings({ ...settings, style: e.target.value as ImageSettings['style'] })}
                                            className="text-xs px-2 py-1 rounded border border-[var(--color-gray-200)]"
                                        >
                                            <option value="photographic">Photographic</option>
                                            <option value="illustrative">Illustrative</option>
                                        </select>
                                    </div>
                                    <label className="flex items-center gap-1.5 text-xs text-[var(--color-gray-600)]">
                                        <input
                                            type="checkbox"
                                            checked={settings.include_people}
                                            onChange={(e) => setSettings({ ...settings, include_people: e.target.checked })}
                                            className="w-3.5 h-3.5 rounded"
                                        />
                                        Include People
                                    </label>
                                    <label className="flex items-center gap-1.5 text-xs text-[var(--color-gray-600)]">
                                        <input
                                            type="checkbox"
                                            checked={!settings.include_text}
                                            onChange={(e) => setSettings({ ...settings, include_text: !e.target.checked })}
                                            className="w-3.5 h-3.5 rounded"
                                        />
                                        No Text
                                    </label>
                                    <label className="flex items-center gap-1.5 text-xs text-[var(--color-gray-600)]">
                                        <input
                                            type="checkbox"
                                            checked={!settings.include_logos}
                                            onChange={(e) => setSettings({ ...settings, include_logos: !e.target.checked })}
                                            className="w-3.5 h-3.5 rounded"
                                        />
                                        No Logos
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-[var(--color-gray-600)]">Ratio:</label>
                                        <select
                                            value={settings.aspect_ratio}
                                            onChange={(e) => setSettings({ ...settings, aspect_ratio: e.target.value as ImageSettings['aspect_ratio'] })}
                                            className="text-xs px-2 py-1 rounded border border-[var(--color-gray-200)]"
                                        >
                                            <option value="1:1">1:1 (Square)</option>
                                            <option value="4:5">4:5 (Portrait)</option>
                                            <option value="16:9">16:9 (Landscape)</option>
                                            <option value="9:16">9:16 (Story)</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Generate Buttons - only in manual mode */}
                                <div className="flex items-center gap-3">
                                    <Button
                                        onClick={() => handleGenerateImages(2)}
                                        disabled={!prompt || isGeneratingImages}
                                        isLoading={isGeneratingImages}
                                    >
                                        <ImageIcon className="w-4 h-4" />
                                        Generate 2 Images
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        onClick={() => handleGenerateImages(4)}
                                        disabled={!prompt || isGeneratingImages}
                                    >
                                        Generate 4
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Image Gallery Section */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="font-medium text-[var(--color-gray-900)]">
                                Images {images.length > 0 && `(${images.length})`}
                            </h3>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                    const file = e.target.files?.[0]
                                    if (file) handleUpload(file)
                                }}
                            />
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <Upload className="w-4 h-4" />
                                Upload
                            </Button>
                        </div>

                        {/* Upload Progress */}
                        {uploadProgress !== null && (
                            <div className="flex items-center gap-2">
                                <div className="flex-1 h-2 bg-[var(--color-gray-200)] rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-[var(--color-primary)] transition-all"
                                        style={{ width: `${uploadProgress}%` }}
                                    />
                                </div>
                                <span className="text-xs text-[var(--color-gray-500)]">{uploadProgress}%</span>
                            </div>
                        )}

                        {/* Image Grid */}
                        {isLoadingImages ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="w-6 h-6 animate-spin text-[var(--color-primary)]" />
                            </div>
                        ) : images.length === 0 ? (
                            <div
                                className="border-2 border-dashed border-[var(--color-gray-300)] rounded-lg p-8 text-center cursor-pointer hover:border-[var(--color-primary)] transition-colors"
                                onClick={() => fileInputRef.current?.click()}
                                onDragOver={(e) => {
                                    e.preventDefault()
                                    e.currentTarget.classList.add('border-[var(--color-primary)]', 'bg-[var(--color-gray-50)]')
                                }}
                                onDragLeave={(e) => {
                                    e.currentTarget.classList.remove('border-[var(--color-primary)]', 'bg-[var(--color-gray-50)]')
                                }}
                                onDrop={(e) => {
                                    e.preventDefault()
                                    e.currentTarget.classList.remove('border-[var(--color-primary)]', 'bg-[var(--color-gray-50)]')
                                    const file = e.dataTransfer.files[0]
                                    if (file && file.type.startsWith('image/')) {
                                        handleUpload(file)
                                    }
                                }}
                            >
                                <Upload className="w-8 h-8 mx-auto mb-2 text-[var(--color-gray-400)]" />
                                <p className="text-sm text-[var(--color-gray-500)]">
                                    Drop an image here or click to upload
                                </p>
                                <p className="text-xs text-[var(--color-gray-400)] mt-1">
                                    Or generate images using the prompt above
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                {images.map((image) => (
                                    <div
                                        key={image.id}
                                        onClick={() => !image.is_primary && handleSetPrimary(image.id)}
                                        className={`relative group rounded-lg overflow-hidden border-2 transition-all ${!image.is_primary ? 'cursor-pointer' : ''
                                            } ${image.is_primary
                                                ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)] ring-opacity-20'
                                                : 'border-[var(--color-gray-200)] hover:border-[var(--color-primary)] hover:border-opacity-50'
                                            }`}
                                        title={image.is_primary ? 'Primary image' : 'Click to select as primary'}
                                    >
                                        {/* Image */}
                                        <img
                                            src={getImageUrl(image.storage_path)}
                                            alt="Post image"
                                            className="w-full aspect-square object-cover"
                                            loading="lazy"
                                        />

                                        {/* Primary Badge */}
                                        {image.is_primary && (
                                            <div className="absolute top-2 left-2 px-2 py-0.5 bg-[var(--color-primary)] text-white text-xs rounded-full">
                                                Primary
                                            </div>
                                        )}

                                        {/* Source Badge */}
                                        <div className={`absolute top-2 right-2 px-2 py-0.5 text-white text-xs rounded-full ${image.prompt_used?.startsWith('[LOGO OVERLAY]')
                                            ? 'bg-purple-600'
                                            : 'bg-black bg-opacity-50'
                                            }`}>
                                            {image.source_type === 'uploaded'
                                                ? 'Uploaded'
                                                : image.prompt_used?.startsWith('[LOGO OVERLAY]')
                                                    ? '✓ With Logo'
                                                    : 'Generated'}
                                        </div>

                                        {/* Generating Overlay */}
                                        {image.generation_status === 'generating' && (
                                            <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                                                <Loader2 className="w-8 h-8 animate-spin text-white" />
                                            </div>
                                        )}

                                        {/* Error Overlay */}
                                        {image.generation_status === 'failed' && (
                                            <div className="absolute inset-0 bg-red-500 bg-opacity-50 flex items-center justify-center">
                                                <AlertCircle className="w-8 h-8 text-white" />
                                            </div>
                                        )}

                                        {/* Hover Actions */}
                                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                                            <button
                                                onClick={() => setPreviewImage(image)}
                                                className="p-2 bg-white rounded-full hover:bg-[var(--color-gray-100)]"
                                                title="Preview"
                                            >
                                                <ZoomIn className="w-4 h-4" />
                                            </button>
                                            {!image.is_primary && (
                                                <button
                                                    onClick={() => handleSetPrimary(image.id)}
                                                    className="p-2 bg-white rounded-full hover:bg-[var(--color-gray-100)]"
                                                    title="Set as primary"
                                                >
                                                    <Star className="w-4 h-4" />
                                                </button>
                                            )}
                                            <button
                                                onClick={() => setSelectedImageId(image.id)}
                                                className="p-2 bg-white rounded-full hover:bg-purple-100 text-purple-600"
                                                title="Apply Logo"
                                            >
                                                <Layers className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteImage(image)}
                                                className="p-2 bg-white rounded-full hover:bg-red-100 text-red-500"
                                                title="Delete"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Logo Overlay Panel - shown when an image is selected */}
                    {selectedImageId && (
                        <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg space-y-3">
                            <div className="flex items-center justify-between">
                                <h3 className="font-medium text-purple-900">Apply Logo Overlay</h3>
                                <button
                                    onClick={() => setSelectedImageId(null)}
                                    className="text-purple-600 hover:text-purple-800"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <p className="text-sm text-purple-700">Select which logos to overlay on the image:</p>

                            {/* Top-Left Position Options */}
                            <div className="space-y-2">
                                <p className="text-xs font-medium text-purple-600 uppercase">Top-Left Corner:</p>
                                <div className="flex flex-wrap gap-4 pl-2">
                                    <label className="flex items-center gap-2 text-sm text-purple-800">
                                        <input
                                            type="radio"
                                            name="topLeftLogo"
                                            checked={!applyMainLogo && applyTopLeft}
                                            onChange={() => {
                                                setApplyMainLogo(false)
                                                setApplyTopLeft(true)
                                            }}
                                            className="w-4 h-4 text-purple-600"
                                        />
                                        Top-Left Logo
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-purple-800">
                                        <input
                                            type="radio"
                                            name="topLeftLogo"
                                            checked={applyMainLogo}
                                            onChange={() => {
                                                setApplyMainLogo(true)
                                                setApplyTopLeft(false)
                                            }}
                                            className="w-4 h-4 text-purple-600"
                                        />
                                        Main Logo
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-purple-800">
                                        <input
                                            type="radio"
                                            name="topLeftLogo"
                                            checked={!applyMainLogo && !applyTopLeft}
                                            onChange={() => {
                                                setApplyMainLogo(false)
                                                setApplyTopLeft(false)
                                            }}
                                            className="w-4 h-4 text-purple-600"
                                        />
                                        None
                                    </label>
                                </div>
                            </div>

                            {/* Bottom-Right Option */}
                            <div className="space-y-2">
                                <p className="text-xs font-medium text-purple-600 uppercase">Bottom-Right Corner:</p>
                                <div className="flex flex-wrap gap-4 pl-2">
                                    <label className="flex items-center gap-2 text-sm text-purple-800">
                                        <input
                                            type="radio"
                                            name="bottomRightLogo"
                                            checked={applyBottomRight}
                                            onChange={() => setApplyBottomRight(true)}
                                            className="w-4 h-4 text-purple-600"
                                        />
                                        Bottom-Right Logo
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-purple-800">
                                        <input
                                            type="radio"
                                            name="bottomRightLogo"
                                            checked={!applyBottomRight}
                                            onChange={() => setApplyBottomRight(false)}
                                            className="w-4 h-4 text-purple-600"
                                        />
                                        None
                                    </label>
                                </div>
                            </div>

                            <Button
                                onClick={handleApplyLogo}
                                disabled={isApplyingLogo || (!applyTopLeft && !applyBottomRight && !applyMainLogo)}
                                isLoading={isApplyingLogo}
                                className="bg-purple-600 hover:bg-purple-700"
                            >
                                <Layers className="w-4 h-4" />
                                Apply Logo & Create Final Image
                            </Button>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-[var(--color-gray-200)]">
                    <Button variant="secondary" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </Modal>

            {/* Image Preview Modal */}
            <Modal
                isOpen={!!previewImage}
                onClose={() => setPreviewImage(null)}
                title="Image Preview"
                size="xl"
            >
                {previewImage && (
                    <div className="space-y-4">
                        <img
                            src={getImageUrl(previewImage.storage_path)}
                            alt="Preview"
                            className="w-full rounded-lg"
                        />
                        <div className="flex justify-between items-center">
                            <div className="text-sm text-[var(--color-gray-500)]">
                                {previewImage.width}×{previewImage.height} • {previewImage.source_type}
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => {
                                        const link = document.createElement('a')
                                        link.href = getImageUrl(previewImage.storage_path)
                                        link.download = `image_${previewImage.id}.png`
                                        link.target = '_blank'
                                        document.body.appendChild(link)
                                        link.click()
                                        document.body.removeChild(link)
                                    }}
                                >
                                    <Download className="w-4 h-4" />
                                    Download
                                </Button>
                                {!previewImage.is_primary && (
                                    <Button
                                        size="sm"
                                        onClick={() => {
                                            handleSetPrimary(previewImage.id)
                                            setPreviewImage(null)
                                        }}
                                    >
                                        <Star className="w-4 h-4" />
                                        Set as Primary
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </Modal>
        </>
    )
}
