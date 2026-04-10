import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Image as ImageIcon,
    Loader2,
    Download,
    Save,
    Plus,
    X,
    Sparkles,
    Layers,
    Check,
    RotateCcw,
    ChevronDown,
    FileText,
} from 'lucide-react'
import { Button } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useSpaceStore } from '@/stores/spaceStore'
import { useAuthStore } from '@/stores/authStore'
import { CONTENT_LAYERS, type ContentLayer } from '@/types/database'
import {
    applyLogoToImage,
    detectLogoVariant as detectVariant,
    LOGO_POSITIONS,
    POSITION_LABELS,
    type LogoPosition,
} from '@/lib/logo-overlay'

// ── Types ────────────────────────────────────────────

interface GeneratedImage {
    id: string
    url: string
    prompt: string
    aspectRatio: string
    createdAt: Date
}

interface Slide {
    id: string
    prompt: string
    generations: GeneratedImage[]
    selectedIndex: number
}

interface ContentAsset {
    id: string
    filename: string
    storage_path: string
    public_url: string | null
    mime_type: string
    file_size: number | null
    tags: string[]
    created_at: string
}

const ASPECT_RATIOS = ['1:1', '4:5', '9:16', '16:9', '3:4'] as const

const GEMINI_MODELS = [
    { value: 'gemini-2.5-flash-image', label: 'Flash Image' },
    { value: 'gemini-2.5-pro-image', label: 'Pro Image' },
    { value: 'gemini-2.0-flash-exp', label: '2.0 Flash Exp' },
] as const

function aspectRatioToClass(ratio: string): string {
    switch (ratio) {
        case '1:1': return 'aspect-square'
        case '16:9': return 'aspect-video'
        case '9:16': return 'aspect-[9/16]'
        case '4:5': return 'aspect-[4/5]'
        case '3:4': return 'aspect-[3/4]'
        default: return 'aspect-square'
    }
}

// ── AssetBrowser ─────────────────────────────────────

function AssetBrowser({
    referenceImages, onToggleReference, spaceId, refreshKey, onCreatePostFromAsset, onLoadToWorkbench,
}: {
    referenceImages: { url: string; filename: string }[]
    onToggleReference: (asset: { url: string; filename: string }) => void
    spaceId: string
    refreshKey: number
    onCreatePostFromAsset: (asset: ContentAsset) => void
    onLoadToWorkbench: (asset: ContentAsset) => void
}) {
    const [assets, setAssets] = useState<ContentAsset[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [uploading, setUploading] = useState(false)
    const [dragOver, setDragOver] = useState(false)
    const [uploadError, setUploadError] = useState<string | null>(null)
    const [previewAsset, setPreviewAsset] = useState<ContentAsset | null>(null)

    const fetchAssets = useCallback(async () => {
        const { data } = await supabase.from('content_assets').select('*').eq('space_id', spaceId).order('created_at', { ascending: false }).limit(50)
        setAssets(data || [])
        setIsLoading(false)
    }, [spaceId])

    useEffect(() => { fetchAssets() }, [fetchAssets, refreshKey])

    const handleUpload = useCallback(async (files: FileList | File[]) => {
        const file = files[0]
        if (!file || !file.type.startsWith('image/')) return
        setUploading(true)
        setUploadError(null)
        try {
            const ts = Date.now(), rnd = Math.random().toString(36).substring(2, 10)
            const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : 'png'
            const path = `image-studio/${spaceId}/uploads/${ts}-${rnd}.${ext}`
            const { error: err } = await supabase.storage.from('generated-images').upload(path, file, { contentType: file.type, upsert: true })
            if (err) throw err
            const { data: { publicUrl } } = supabase.storage.from('generated-images').getPublicUrl(path)
            await supabase.from('content_assets').insert({ space_id: spaceId, filename: file.name, storage_path: path, public_url: publicUrl, mime_type: file.type, file_size: file.size, tags: ['uploaded'] })
            await fetchAssets()
            if (publicUrl && referenceImages.length < 3) onToggleReference({ url: publicUrl, filename: file.name })
        } catch (err) {
            setUploadError(err instanceof Error ? err.message : 'Upload failed')
            setTimeout(() => setUploadError(null), 4000)
        } finally { setUploading(false) }
    }, [spaceId, fetchAssets, onToggleReference, referenceImages.length])

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault(); setDragOver(false)
        // Handle internal library asset drag
        const assetData = e.dataTransfer.getData('application/x-library-asset')
        if (assetData) {
            try {
                const asset = JSON.parse(assetData) as { url: string; filename: string }
                if (asset.url && referenceImages.length < 3 && !referenceImages.some(r => r.url === asset.url)) {
                    onToggleReference(asset)
                }
            } catch {}
            return
        }
        // Handle file drop from OS
        if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files)
    }, [handleUpload, referenceImages, onToggleReference])

    const studioAssets = assets.filter(a => a.tags?.includes('image-studio'))
    const otherAssets = assets.filter(a => !a.tags?.includes('image-studio'))

    type LibItem = { type: 'single'; asset: ContentAsset } | { type: 'carousel'; carouselId: string; assets: ContentAsset[] }
    const singles: LibItem[] = []
    const groups = new Map<string, ContentAsset[]>()
    for (const a of studioAssets) {
        const ct = a.tags?.find((t: string) => t.startsWith('carousel:'))
        if (ct) { groups.set(ct, [...(groups.get(ct) || []), a]) } else { singles.push({ type: 'single', asset: a }) }
    }
    const allItems: LibItem[] = [...Array.from(groups, ([carouselId, assets]) => ({ type: 'carousel' as const, carouselId, assets })), ...singles]

    return (
        <div className="w-64 shrink-0 border-r border-[var(--color-gray-200)] flex flex-col h-full bg-white">
            <div className="px-3 pt-3 pb-2 border-b border-[var(--color-gray-200)]">
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-gray-400)] mb-2">Upload Reference</p>
                <div
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors cursor-pointer ${dragOver ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-gray-300)] hover:border-[var(--color-gray-400)]'}`}
                    onClick={() => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.onchange = (e) => { const f = (e.target as HTMLInputElement).files; if (f) handleUpload(f) }; input.click() }}
                >
                    {uploading ? <Loader2 className="w-5 h-5 animate-spin text-[var(--color-primary)] mx-auto" /> : <><ImageIcon className="w-5 h-5 text-[var(--color-gray-300)] mx-auto mb-1" /><p className="text-[10px] text-[var(--color-gray-400)]">Drop image or click to upload</p></>}
                </div>
                {uploadError && <p className="mt-1.5 text-[10px] text-red-500">{uploadError}</p>}
                {referenceImages.length > 0 && (
                    <div className="mt-2 space-y-1">
                        {referenceImages.map((ref, i) => (
                            <div key={i} className="flex items-center gap-2 rounded-lg bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30 px-2 py-1.5">
                                <img src={ref.url} alt="" className="w-8 h-8 rounded object-cover" />
                                <span className="text-[10px] text-[var(--color-primary)] truncate flex-1">{ref.filename}</span>
                                <button onClick={() => onToggleReference(ref)} className="text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)]"><X className="w-3 h-3" /></button>
                            </div>
                        ))}
                        {referenceImages.length < 3 && <p className="text-[9px] text-[var(--color-gray-400)] text-center">{3 - referenceImages.length} slot{referenceImages.length < 2 ? 's' : ''} available</p>}
                    </div>
                )}
            </div>
            <div className="flex-1 overflow-y-auto">
                <div className="px-3 pt-3 pb-1"><p className="text-[10px] uppercase tracking-wider text-[var(--color-gray-400)]">Library</p></div>
                <div className="p-3 pt-2">
                    {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-[var(--color-gray-400)]" /></div>
                    : !assets.length ? <p className="text-xs text-[var(--color-gray-400)] text-center py-6">No assets yet</p>
                    : (
                        <div className="space-y-3">
                            {allItems.length > 0 && <div><p className="text-[9px] uppercase tracking-wider text-[var(--color-gray-400)] mb-1.5">Recent Generations</p><div className="grid grid-cols-2 gap-1.5">
                                {allItems.slice(0, 12).map(item => {
                                    if (item.type === 'carousel') {
                                        const first = item.assets[0]
                                        return <div key={item.carouselId} className="relative rounded-lg overflow-hidden border border-[var(--color-gray-200)]">{first?.public_url && <img src={first.public_url} alt="" className="w-full aspect-square object-cover" />}<div className="absolute bottom-1 right-1 bg-black/60 text-white text-[9px] font-medium px-1.5 py-0.5 rounded"><Layers className="w-2.5 h-2.5 inline mr-0.5" />{item.assets.length}</div></div>
                                    }
                                    const a = item.asset, isSel = referenceImages.some(r => r.url === a.public_url)
                                    return <button key={a.id} draggable onDragStart={(e) => { e.dataTransfer.setData('application/x-library-asset', JSON.stringify({ url: a.public_url, filename: a.filename })) }} onClick={() => setPreviewAsset(a)} className={`relative rounded-lg overflow-hidden border transition-colors ${isSel ? 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/40' : 'border-[var(--color-gray-200)] hover:border-[var(--color-gray-300)]'}`}>{a.public_url && <img src={a.public_url} alt={a.filename} className="w-full aspect-square object-cover" draggable={false} />}{isSel && <div className="absolute top-1 right-1 bg-[var(--color-primary)] rounded-full p-0.5"><Check className="w-2.5 h-2.5 text-white" /></div>}</button>
                                })}
                            </div></div>}
                            {otherAssets.length > 0 && <div><p className="text-[9px] uppercase tracking-wider text-[var(--color-gray-400)] mb-1.5">All Assets</p><div className="grid grid-cols-2 gap-1.5">
                                {otherAssets.slice(0, 20).map(a => {
                                    const isSel = referenceImages.some(r => r.url === a.public_url)
                                    return <button key={a.id} draggable onDragStart={(e) => { e.dataTransfer.setData('application/x-library-asset', JSON.stringify({ url: a.public_url, filename: a.filename })) }} onClick={() => setPreviewAsset(a)} className={`relative rounded-lg overflow-hidden border transition-colors ${isSel ? 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/40' : 'border-[var(--color-gray-200)] hover:border-[var(--color-gray-300)]'}`}>{a.public_url && <img src={a.public_url} alt={a.filename} className="w-full aspect-square object-cover" draggable={false} />}{isSel && <div className="absolute top-1 right-1 bg-[var(--color-primary)] rounded-full p-0.5"><Check className="w-2.5 h-2.5 text-white" /></div>}</button>
                                })}
                            </div></div>}
                        </div>
                    )}
                </div>
            </div>

            {/* Asset Preview Modal */}
            {previewAsset && previewAsset.public_url && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8" onClick={() => setPreviewAsset(null)}>
                    <div className="bg-white rounded-b-xl shadow-2xl max-w-2xl w-full overflow-hidden relative" onClick={e => e.stopPropagation()}>
                        {/* Close X */}
                        <button onClick={() => setPreviewAsset(null)} className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors">
                            <X className="w-4 h-4" />
                        </button>
                        <img src={previewAsset.public_url} alt={previewAsset.filename} className="w-full max-h-[70vh] object-cover" />
                        <div className="p-4 space-y-3">
                            <p className="text-xs text-[var(--color-gray-500)] truncate">{previewAsset.filename}</p>
                            {previewAsset.tags?.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                    {previewAsset.tags.map((tag, i) => (
                                        <span key={i} className="px-2 py-0.5 rounded-full text-[10px] bg-[var(--color-gray-100)] text-[var(--color-gray-500)]">{tag}</span>
                                    ))}
                                </div>
                            )}
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        const isSel = referenceImages.some(r => r.url === previewAsset.public_url)
                                        if (!isSel && referenceImages.length >= 3) return
                                        onToggleReference({ url: previewAsset.public_url!, filename: previewAsset.filename })
                                        setPreviewAsset(null)
                                    }}
                                    disabled={!referenceImages.some(r => r.url === previewAsset.public_url) && referenceImages.length >= 3}
                                    className="flex-1 px-3 py-2 rounded-lg bg-[var(--color-primary)] text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    {referenceImages.some(r => r.url === previewAsset.public_url) ? 'Remove from References' : 'Use as Reference'}
                                </button>
                                <button
                                    onClick={() => {
                                        onLoadToWorkbench(previewAsset)
                                        setPreviewAsset(null)
                                    }}
                                    className="px-3 py-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-xs font-medium hover:bg-[var(--color-primary)]/20"
                                >
                                    Edit in Workbench
                                </button>
                                <button
                                    onClick={() => {
                                        onCreatePostFromAsset(previewAsset)
                                        setPreviewAsset(null)
                                    }}
                                    className="px-3 py-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-xs font-medium hover:bg-[var(--color-primary)]/20"
                                >
                                    Create Post
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

// ── LogoPreviewOverlay ───────────────────────────────

function LogoPreviewOverlay({ logoUrl, position }: { logoUrl: string; position: LogoPosition }) {
    const style: React.CSSProperties = { position: 'absolute', width: '12%', pointerEvents: 'none' }
    if (position.startsWith('t')) style.top = '3%'
    if (position.startsWith('c')) { style.top = '50%'; style.transform = 'translateY(-50%)' }
    if (position.startsWith('b')) style.bottom = '3%'
    if (position.endsWith('l')) style.left = '3%'
    if (position.endsWith('c')) { style.left = '50%'; style.transform = (style.transform || '') + ' translateX(-50%)' }
    if (position.endsWith('r')) style.right = '3%'
    return <img src={logoUrl} alt="" style={style} />
}

// ── ComparisonView ───────────────────────────────────

function ComparisonView({ previous, latest, generations, aspectRatio, generating, selectedId, showLogo, logoUrl, logoPosition, onRevert, onSelect, onSelectGeneration }: {
    previous: GeneratedImage | null; latest: GeneratedImage | null; generations: GeneratedImage[]; aspectRatio: string; generating: boolean; selectedId: string | null; showLogo: boolean; logoUrl: string; logoPosition: LogoPosition; onRevert: () => void; onSelect: () => void; onSelectGeneration: (img: GeneratedImage) => void
}) {
    const arClass = aspectRatioToClass(aspectRatio)
    const hasBoth = previous && latest
    const borderSel = 'border-[var(--color-primary)]'
    const borderDef = 'border-[var(--color-gray-200)]'

    return (
        <div className="space-y-4">
            {hasBoth ? (
                <div className="grid grid-cols-2 gap-4">
                    {[{ img: previous, label: 'Previous', action: onRevert, btnText: 'Revert to this' }, { img: latest, label: 'Latest', action: onSelect, btnText: 'Use this' }].map(({ img, label, action, btnText }) => (
                        <div key={label} className="space-y-2">
                            <p className="text-[10px] uppercase tracking-wider text-[var(--color-gray-400)]">{label}</p>
                            <div className={`${arClass} relative max-h-[35vh] bg-[var(--color-gray-100)] border overflow-hidden flex items-center justify-center cursor-pointer rounded-lg ${selectedId === img.id ? borderSel : borderDef}`} onClick={action}>
                                <img src={img.url} alt="" className="w-full h-full object-cover" />
                                {showLogo && selectedId === img.id && logoUrl && <LogoPreviewOverlay logoUrl={logoUrl} position={logoPosition} />}
                                {selectedId === img.id && <div className="absolute top-2 left-2 bg-[var(--color-primary)] text-white text-[9px] font-medium px-1.5 py-0.5 rounded">Selected</div>}
                            </div>
                            <button className="w-full text-xs py-1.5 px-3 rounded-lg border border-[var(--color-gray-200)] text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)] hover:bg-[var(--color-gray-50)]" onClick={action}>{btnText}</button>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="space-y-2">
                    <div className={`${arClass} relative max-h-[40vh] bg-[var(--color-gray-100)] border ${borderDef} overflow-hidden flex items-center justify-center mx-auto rounded-lg`} style={{ maxWidth: '500px' }}>
                        {generating ? <div className="flex flex-col items-center gap-3"><Loader2 className="w-8 h-8 animate-spin text-[var(--color-primary)]" /><p className="text-xs text-[var(--color-gray-400)]">Generating...</p></div>
                        : latest ? <><img src={latest.url} alt="" className="w-full h-full object-cover" />{showLogo && selectedId === latest.id && logoUrl && <LogoPreviewOverlay logoUrl={logoUrl} position={logoPosition} />}</>
                        : <div className="flex flex-col items-center gap-3"><Sparkles className="w-8 h-8 text-[var(--color-gray-300)]" /><p className="text-xs text-[var(--color-gray-400)]">Enter a prompt and hit Generate</p></div>}
                    </div>
                    {latest && <button className="w-full text-xs py-1.5 rounded-lg border border-[var(--color-gray-200)] text-[var(--color-gray-500)] hover:bg-[var(--color-gray-50)] max-w-[500px] mx-auto block" onClick={onSelect}>Use this</button>}
                </div>
            )}
            {generations.length > 0 && (
                <div className="space-y-1.5">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--color-gray-400)]">All Generations</p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                        {generations.map(gen => (
                            <button key={gen.id} onClick={() => onSelectGeneration(gen)} className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border transition-colors ${latest?.id === gen.id ? 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/40' : previous?.id === gen.id ? 'border-[var(--color-gray-400)]' : 'border-[var(--color-gray-200)] hover:border-[var(--color-gray-300)]'}`}>
                                <img src={gen.url} alt="" className="w-full h-full object-cover" />
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

// ── PromptBar ────────────────────────────────────────

function PromptBar({ prompt, onPromptChange, aspectRatio, onAspectRatioChange, imageModel, onImageModelChange, referenceImages, onRemoveReference, generating, onGenerate, mode = 'single', hasGenerations = false, refinement, onRefinementChange }: {
    prompt: string; onPromptChange: (v: string) => void; aspectRatio: string; onAspectRatioChange: (v: string) => void; imageModel: string; onImageModelChange: (v: string) => void; referenceImages: { url: string; filename: string }[]; onRemoveReference: (i: number) => void; generating: boolean; onGenerate: () => void; mode?: 'single' | 'carousel'; hasGenerations?: boolean; refinement: string; onRefinementChange: (v: string) => void
}) {
    return (
        <div className="space-y-3">
            {referenceImages.length > 0 && <div className="flex flex-wrap items-center gap-2">{referenceImages.map((ref, i) => (
                <div key={i} className="flex items-center gap-2 bg-[var(--color-gray-50)] rounded-lg px-2.5 py-1.5">
                    <img src={ref.url} alt="" className="w-8 h-8 rounded object-cover" />
                    <span className="text-xs text-[var(--color-gray-500)] max-w-[100px] truncate">{ref.filename}</span>
                    <button onClick={() => onRemoveReference(i)} className="text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)]"><X className="w-3.5 h-3.5" /></button>
                </div>
            ))}</div>}
            <textarea rows={2} value={prompt} onChange={e => onPromptChange(e.target.value)} placeholder={mode === 'carousel' ? "Describe the carousel story or this slide's scene..." : 'Describe the image you want to generate...'} className="w-full bg-[var(--color-gray-50)] border border-[var(--color-gray-300)] rounded-xl px-4 py-3 text-sm text-[var(--color-gray-900)] placeholder:text-[var(--color-gray-400)] resize-y min-h-[60px] focus:outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onGenerate() } }} />
            {hasGenerations && (
                <div className="flex gap-2 items-start">
                    <input type="text" value={refinement} onChange={e => onRefinementChange(e.target.value)} placeholder="Refine: e.g. 'wider shot, more golden light...'" className="flex-1 bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20 rounded-lg px-3 py-2 text-xs text-[var(--color-gray-900)] placeholder:text-[var(--color-gray-400)] focus:outline-none focus:border-[var(--color-primary)]/40" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onGenerate() } }} />
                    {refinement.trim() && <button onClick={() => onRefinementChange('')} className="text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)] p-2"><X className="w-3.5 h-3.5" /></button>}
                </div>
            )}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">{ASPECT_RATIOS.map(r => (
                        <button key={r} onClick={() => onAspectRatioChange(r)} className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${aspectRatio === r ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-gray-100)] text-[var(--color-gray-500)] hover:bg-[var(--color-gray-200)]'}`}>{r}</button>
                    ))}</div>
                    <div className="w-px h-4 bg-[var(--color-gray-200)]" />
                    <select
                        value={imageModel}
                        onChange={e => onImageModelChange(e.target.value)}
                        className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-[var(--color-gray-100)] text-[var(--color-gray-500)] border-0 focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]/30 cursor-pointer"
                    >
                        {GEMINI_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                </div>
                <button onClick={onGenerate} disabled={generating || !prompt.trim()} className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5">
                    {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : hasGenerations ? <RotateCcw className="w-3.5 h-3.5" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {hasGenerations ? 'Regenerate' : 'Generate'}
                </button>
            </div>
        </div>
    )
}

// ── SlideStrip ───────────────────────────────────────

function SlideStrip({ slides, activeIndex, onSelectSlide, onAddSlide, showAll, onToggleAll }: { slides: Slide[]; activeIndex: number; onSelectSlide: (i: number) => void; onAddSlide: () => void; showAll: boolean; onToggleAll: () => void }) {
    const hasImgs = slides.some(s => s.generations.length > 0)
    return (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {slides.map((s, i) => <button key={s.id} onClick={() => onSelectSlide(i)} className={`shrink-0 w-9 h-9 rounded-lg text-xs font-medium transition-colors ${!showAll && i === activeIndex ? 'bg-[var(--color-primary)]/20 text-[var(--color-primary)] border border-[var(--color-primary)]' : 'bg-[var(--color-gray-100)] text-[var(--color-gray-500)] border border-[var(--color-gray-200)] hover:border-[var(--color-gray-300)]'}`}>{i + 1}</button>)}
            <button onClick={onAddSlide} className="shrink-0 w-9 h-9 rounded-lg border border-dashed border-[var(--color-gray-300)] text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)] flex items-center justify-center"><Plus className="w-3.5 h-3.5" /></button>
            {hasImgs && <><div className="w-px h-5 bg-[var(--color-gray-200)] mx-1" /><button onClick={onToggleAll} className={`shrink-0 px-3 h-9 rounded-lg text-xs font-medium flex items-center gap-1.5 ${showAll ? 'bg-[var(--color-primary)]/20 text-[var(--color-primary)] border border-[var(--color-primary)]' : 'bg-[var(--color-gray-100)] text-[var(--color-gray-500)] border border-[var(--color-gray-200)]'}`}><Layers className="w-3 h-3" />All</button></>}
        </div>
    )
}

// ── LogoPanel ────────────────────────────────────────

function LogoPanel({ logos, selectedLogoIndex, onSelectLogo, logoPosition, onPositionChange, onApply, onCancel, applying }: {
    logos: { url: string; label: string }[]; selectedLogoIndex: number; onSelectLogo: (i: number) => void; logoPosition: LogoPosition; onPositionChange: (p: LogoPosition) => void; onApply: () => void; onCancel: () => void; applying: boolean
}) {
    return (
        <div className="w-56 shrink-0 border-l border-[var(--color-gray-200)] flex flex-col h-full bg-white">
            <div className="px-4 py-3 border-b border-[var(--color-gray-200)]"><h2 className="text-sm font-medium text-[var(--color-gray-700)]">Brand Overlay</h2></div>
            <div className="p-4 space-y-5 flex-1">
                <div className="space-y-2">
                    <label className="text-xs font-medium text-[var(--color-gray-500)] uppercase tracking-wider">Logo</label>
                    {logos.length === 0 ? <p className="text-xs text-[var(--color-gray-400)]">No logos uploaded. Add in Brand Settings.</p> : (
                        <div className="grid grid-cols-2 gap-2">{logos.map((l, i) => (
                            <button key={i} onClick={() => onSelectLogo(i)} className={`px-3 py-2 rounded-lg text-xs font-medium ${selectedLogoIndex === i ? 'bg-[var(--color-primary)]/20 text-[var(--color-primary)] border border-[var(--color-primary)]' : 'bg-[var(--color-gray-100)] text-[var(--color-gray-500)] border border-[var(--color-gray-200)]'}`}>{l.label || `Logo ${i + 1}`}</button>
                        ))}</div>
                    )}
                </div>
                <div className="space-y-2">
                    <label className="text-xs font-medium text-[var(--color-gray-500)] uppercase tracking-wider">Position</label>
                    <div className="grid grid-cols-3 gap-1.5">{LOGO_POSITIONS.map(pos => (
                        <button key={pos} onClick={() => onPositionChange(pos)} className={`w-full aspect-square rounded text-[10px] font-medium ${logoPosition === pos ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-gray-100)] text-[var(--color-gray-400)] hover:bg-[var(--color-gray-200)]'}`}>{POSITION_LABELS[pos]}</button>
                    ))}</div>
                </div>
            </div>
            <div className="p-4 border-t border-[var(--color-gray-200)] space-y-2">
                <button onClick={onApply} disabled={applying || logos.length === 0} className="w-full px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-1.5">{applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Apply Logo & Save</button>
                <button className="w-full px-4 py-1.5 rounded-lg border border-[var(--color-gray-200)] text-xs text-[var(--color-gray-500)] hover:bg-[var(--color-gray-50)]" onClick={onCancel}>Cancel</button>
            </div>
        </div>
    )
}

// ── Main Component ───────────────────────────────────

export function ImageStudio() {
    const { currentSpace } = useSpaceStore()
    const { user } = useAuthStore()
    const navigate = useNavigate()
    const [mode, setMode] = useState<'single' | 'carousel'>('single')
    const [prompt, setPrompt] = useState('')
    const [aspectRatio, setAspectRatio] = useState<string>('1:1')
    const [imageModel, setImageModel] = useState('gemini-2.5-flash-image')
    const [referenceImages, setReferenceImages] = useState<{ url: string; filename: string }[]>([])
    const [generations, setGenerations] = useState<GeneratedImage[]>([])
    const [confirmedImage, setConfirmedImage] = useState<GeneratedImage | null>(null)
    const [latestImage, setLatestImage] = useState<GeneratedImage | null>(null)
    const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(null)
    const [generating, setGenerating] = useState(false)
    const [showLogoPanel, setShowLogoPanel] = useState(false)
    const [logos, setLogos] = useState<{ url: string; label: string }[]>([])
    const [selectedLogoIndex, setSelectedLogoIndex] = useState(0)
    const [logoPosition, setLogoPosition] = useState<LogoPosition>('br')
    const [applyingLogo, setApplyingLogo] = useState(false)
    const [basePrompt, setBasePrompt] = useState('')
    const [slides, setSlides] = useState<Slide[]>([{ id: crypto.randomUUID(), prompt: '', generations: [], selectedIndex: -1 }])
    const [activeSlideIndex, setActiveSlideIndex] = useState(0)
    const [showAllSlides, setShowAllSlides] = useState(false)
    const [toast, setToast] = useState<string | null>(null)
    const [refinement, setRefinement] = useState('')
    const [refreshKey, setRefreshKey] = useState(0)
    const [showSaveMenu, setShowSaveMenu] = useState(false)
    const [showCreatePostModal, setShowCreatePostModal] = useState(false)
    const [createPostTitle, setCreatePostTitle] = useState('')
    const [createPostLayer, setCreatePostLayer] = useState<ContentLayer | ''>('')
    const [creatingPost, setCreatingPost] = useState(false)

    const mutateAssets = useCallback(() => setRefreshKey(k => k + 1), [])

    useEffect(() => {
        if (!currentSpace) return
        // Load logos from brand_profile (same source as campaign posts)
        supabase.from('brand_profile').select('logo_url, logo_top_left_url, logo_bottom_right_url').eq('space_id', currentSpace.id).single().then(({ data, error }) => {
            if (error) console.warn('brand_profile query error:', error.code, error.message)
            if (!data) return
            const found: { url: string; label: string }[] = []
            if (data.logo_url) found.push({ url: data.logo_url, label: 'Main Logo' })
            if (data.logo_top_left_url) found.push({ url: data.logo_top_left_url, label: 'Top-Left Logo' })
            if (data.logo_bottom_right_url) found.push({ url: data.logo_bottom_right_url, label: 'Bottom-Right Logo' })
            if (found.length) setLogos(found)
        })
    }, [currentSpace])

    const showToastMsg = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 6000) }
    const activeSlide = slides[activeSlideIndex]
    const activeGenerations = mode === 'carousel' ? (activeSlide?.generations ?? []) : generations
    const activePrompt = mode === 'carousel' ? (activeSlide?.prompt ?? '') : prompt
    const setActivePrompt = (v: string) => { if (mode === 'carousel') { setSlides(p => p.map((s, i) => i === activeSlideIndex ? { ...s, prompt: v } : s)) } else { setPrompt(v) } }

    const handleGenerate = useCallback(async () => {
        if (!currentSpace) return
        const sp = mode === 'carousel' ? slides[activeSlideIndex]?.prompt : prompt
        if (!sp?.trim() || generating) return
        let cp = mode === 'carousel' && basePrompt.trim() ? `${basePrompt.trim()}\n\n${sp.trim()}` : sp
        if (refinement.trim()) cp = `${cp.trim()}\n\nAdditional refinements: ${refinement.trim()}`
        setGenerating(true)
        try {
            const { data, error } = await supabase.functions.invoke('image-studio-generate', { body: { prompt: cp.trim(), aspect_ratio: aspectRatio, reference_image_urls: referenceImages.length > 0 ? referenceImages.map(r => r.url) : undefined, space_id: currentSpace.id, model: imageModel } })
            if (error) {
                let errMsg = error.message || 'Generation failed'
                // For FunctionsHttpError, the response body is in data (supabase-js v2 parses it)
                if (data?.error) {
                    errMsg = data.error
                } else {
                    try {
                        if (error.context instanceof Response) {
                            const body = await error.context.json()
                            errMsg = body?.error || errMsg
                        }
                    } catch {}
                }
                throw new Error(errMsg)
            }
            if (data?.error) throw new Error(data.error)
            const ni: GeneratedImage = { id: data.asset.id, url: data.asset.publicUrl, prompt: cp.trim(), aspectRatio, createdAt: new Date() }
            if (mode === 'carousel') { setSlides(p => p.map((s, i) => i !== activeSlideIndex ? s : { ...s, generations: [...s.generations, ni], selectedIndex: s.generations.length })) } else { setGenerations(p => [...p, ni]) }
            setConfirmedImage(latestImage); setLatestImage(ni); setSelectedImage(ni); mutateAssets()
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Generation failed'
            console.error('Image generation error:', err)
            showToastMsg(msg)
        } finally { setGenerating(false) }
    }, [currentSpace, mode, prompt, basePrompt, slides, activeSlideIndex, aspectRatio, referenceImages, generating, latestImage, refinement, mutateAssets])

    const handleGenerateCarousel = useCallback(async () => {
        if (!currentSpace) return
        const up = (mode === 'carousel' ? (slides[activeSlideIndex]?.prompt || prompt) : prompt).trim()
        if (!up || generating) return
        setGenerating(true)
        try {
            const fp = basePrompt.trim() ? `${basePrompt.trim()}\n\n${up}` : up
            const { data: sd, error: se } = await supabase.functions.invoke('image-studio-split-prompt', { body: { prompt: fp, slide_count: 4 } })
            if (se || sd?.error) { showToastMsg('Failed to split prompt'); return }
            const ns: Slide[] = (sd.slides as string[]).map((p: string) => ({ id: crypto.randomUUID(), prompt: p, generations: [], selectedIndex: -1 }))
            setSlides(ns); setActiveSlideIndex(0)
            for (let i = 0; i < ns.length; i++) {
                setActiveSlideIndex(i)
                const sfp = basePrompt.trim() ? `${basePrompt.trim()}\n\n${ns[i].prompt}` : ns[i].prompt
                const { data: gd, error: ge } = await supabase.functions.invoke('image-studio-generate', { body: { prompt: sfp, aspect_ratio: aspectRatio, reference_image_urls: referenceImages.length > 0 ? referenceImages.map(r => r.url) : undefined, space_id: currentSpace.id, model: imageModel } })
                if (ge || gd?.error) { showToastMsg(`Failed slide ${i + 1}`); continue }
                const ni: GeneratedImage = { id: gd.asset.id, url: gd.asset.publicUrl, prompt: sfp, aspectRatio, createdAt: new Date() }
                setSlides(p => p.map((s, idx) => idx !== i ? s : { ...s, generations: [ni], selectedIndex: 0 }))
                setLatestImage(ni); setSelectedImage(ni)
            }
            mutateAssets(); showToastMsg('Carousel generated')
        } catch { showToastMsg('Failed to generate carousel') } finally { setGenerating(false) }
    }, [currentSpace, prompt, basePrompt, aspectRatio, referenceImages, generating, mode, slides, activeSlideIndex, mutateAssets])

    const handleApplyLogo = useCallback(async () => {
        if (!selectedImage || logos.length === 0) return
        setApplyingLogo(true)
        try {
            const lu = logos[selectedLogoIndex]?.url; if (!lu) throw new Error('No logo')
            const blob = await applyLogoToImage(selectedImage.url, lu, logoPosition)
            const bu = URL.createObjectURL(blob)
            const bi: GeneratedImage = { id: `branded-${Date.now()}`, url: bu, prompt: `${selectedImage.prompt} (branded)`, aspectRatio: selectedImage.aspectRatio, createdAt: new Date() }
            if (mode === 'carousel') { setSlides(p => p.map((s, i) => i !== activeSlideIndex ? s : { ...s, generations: [...s.generations, bi], selectedIndex: s.generations.length })) } else { setGenerations(p => [...p, bi]) }
            setConfirmedImage(selectedImage); setLatestImage(bi); setSelectedImage(bi); setShowLogoPanel(false); showToastMsg('Logo applied')
        } catch (e) { showToastMsg(e instanceof Error ? e.message : 'Failed') } finally { setApplyingLogo(false) }
    }, [selectedImage, logos, selectedLogoIndex, logoPosition, mode, activeSlideIndex])

    const handleReset = useCallback(() => { setPrompt(''); setBasePrompt(''); setGenerations([]); setConfirmedImage(null); setLatestImage(null); setSelectedImage(null); setReferenceImages([]); setShowLogoPanel(false); setSlides([{ id: crypto.randomUUID(), prompt: '', generations: [], selectedIndex: -1 }]); setActiveSlideIndex(0); setShowAllSlides(false); setRefinement('') }, [])

    const handleSaveToLibrary = async () => {
        if (!selectedImage || !currentSpace) return
        if (selectedImage.url.startsWith('blob:')) {
            try {
                const res = await fetch(selectedImage.url); const blob = await res.blob()
                const ts = Date.now(), rnd = Math.random().toString(36).substring(2, 10), sp = `image-studio/${currentSpace.id}/branded/${ts}-${rnd}.png`
                await supabase.storage.from('generated-images').upload(sp, blob, { contentType: 'image/png', upsert: true })
                const { data: { publicUrl } } = supabase.storage.from('generated-images').getPublicUrl(sp)
                await supabase.from('content_assets').insert({ space_id: currentSpace.id, filename: `branded-${ts}.png`, storage_path: sp, public_url: publicUrl, mime_type: 'image/png', file_size: blob.size, tags: ['image-studio', 'branded'] })
                mutateAssets(); showToastMsg('Saved')
            } catch { showToastMsg('Failed to save') }
            return
        }
        mutateAssets(); showToastMsg('Image saved')
    }

    const handleSaveCarousel = async () => {
        if (!currentSpace) return
        const cid = `carousel:${crypto.randomUUID().slice(0, 8)}`
        const imgs = slides.map(s => s.selectedIndex >= 0 ? s.generations[s.selectedIndex] : s.generations[s.generations.length - 1]).filter(Boolean) as GeneratedImage[]
        if (!imgs.length) { showToastMsg('No slides'); return }
        try {
            await Promise.all(imgs.map(async img => { if (!img.url.startsWith('blob:')) await supabase.from('content_assets').update({ tags: ['image-studio', cid, `ratio:${img.aspectRatio}`] }).eq('id', img.id) }))
            mutateAssets(); showToastMsg(`Carousel saved (${imgs.length} slides)`)
        } catch { showToastMsg('Failed') }
    }

    const handleDownload = () => { if (!selectedImage) return; const a = document.createElement('a'); a.href = selectedImage.url; a.download = `image-${selectedImage.id}.png`; document.body.appendChild(a); a.click(); document.body.removeChild(a) }
    const handleDownloadAll = () => { const imgs = mode === 'carousel' ? slides.flatMap(s => { const img = s.selectedIndex >= 0 ? s.generations[s.selectedIndex] : null; return img ? [img] : [] }) : generations; imgs.forEach((img, i) => { const a = document.createElement('a'); a.href = img.url; a.download = `slide-${i + 1}.png`; document.body.appendChild(a); a.click(); document.body.removeChild(a) }) }
    const handleCreatePost = async () => {
        if (!selectedImage || !currentSpace || !user || !createPostTitle.trim()) return
        setCreatingPost(true)
        try {
            // If the image is a blob URL (branded), upload it first
            let imagePath = ''
            if (selectedImage.url.startsWith('blob:')) {
                const res = await fetch(selectedImage.url)
                const blob = await res.blob()
                const ts = Date.now(), rnd = Math.random().toString(36).substring(2, 10)
                imagePath = `image-studio/${currentSpace.id}/posts/${ts}-${rnd}.png`
                await supabase.storage.from('generated-images').upload(imagePath, blob, { contentType: 'image/png', upsert: true })
            } else {
                // Find the storage path from content_assets
                const { data: asset } = await supabase.from('content_assets').select('storage_path').eq('id', selectedImage.id).single()
                imagePath = asset?.storage_path || ''
            }

            const { error } = await supabase.from('posts').insert({
                space_id: currentSpace.id,
                title: createPostTitle.trim(),
                body: selectedImage.prompt || '',
                status: 'ready_to_publish',
                author_id: user.id,
                generated_image_path: imagePath,
                content_layer: createPostLayer || null,
            })
            if (error) throw error

            setShowCreatePostModal(false)
            setCreatePostTitle('')
            setCreatePostLayer('')
            showToastMsg('Post created — find it in the Calendar')
        } catch (err) {
            showToastMsg(err instanceof Error ? err.message : 'Failed to create post')
        } finally {
            setCreatingPost(false)
        }
    }

    const handleAddSlide = () => { setSlides(p => [...p, { id: crypto.randomUUID(), prompt: '', generations: [], selectedIndex: -1 }]); setActiveSlideIndex(slides.length); setConfirmedImage(null); setLatestImage(null); setSelectedImage(null) }
    const handleSelectSlide = (idx: number) => { setActiveSlideIndex(idx); const s = slides[idx]; if (s) { const lg = s.generations.length > 0 ? s.generations[s.generations.length - 1] : null; setLatestImage(lg); setConfirmedImage(s.generations.length > 1 ? s.generations[s.generations.length - 2] : null); setSelectedImage(s.selectedIndex >= 0 ? s.generations[s.selectedIndex] : lg) } }

    if (!currentSpace) return <div className="p-8 text-center text-[var(--color-gray-400)]">Select a workspace</div>
    const selectedLogoUrl = logos[selectedLogoIndex]?.url || ''

    return (
        <div className="h-screen flex flex-col">
            <div className="bg-white border-b border-[var(--color-gray-200)] px-6 py-3 flex items-center shrink-0">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-lg bg-[var(--color-primary)]/10"><ImageIcon className="w-4 h-4 text-[var(--color-primary)]" /></div>
                    <div><h1 className="text-sm font-semibold text-[var(--color-gray-900)]">Image Studio</h1><p className="text-[10px] text-[var(--color-gray-400)]">Generate, refine, and brand images with AI</p></div>
                </div>
            </div>
            <div className="flex-1 flex overflow-hidden">
                <AssetBrowser referenceImages={referenceImages} onToggleReference={a => { setReferenceImages(p => { const e = p.findIndex(r => r.url === a.url); if (e >= 0) return p.filter((_, i) => i !== e); if (p.length >= 3) return p; return [...p, a] }) }} spaceId={currentSpace.id} refreshKey={refreshKey} onCreatePostFromAsset={(asset) => {
                    // Set up a GeneratedImage from the asset so Create Post modal can use it
                    const img: GeneratedImage = { id: asset.id, url: asset.public_url || '', prompt: asset.filename, aspectRatio: '1:1', createdAt: new Date(asset.created_at) }
                    setSelectedImage(img)
                    setCreatePostTitle(asset.filename.replace(/\.\w+$/, '').replace(/^\d+-\w+$/, 'Untitled'))
                    setShowCreatePostModal(true)
                }} onLoadToWorkbench={(asset) => {
                    // Load library image into the workbench so user can add logo, download, etc.
                    const ratio = asset.tags?.find(t => t.startsWith('ratio:'))?.replace('ratio:', '') || '1:1'
                    const img: GeneratedImage = { id: asset.id, url: asset.public_url || '', prompt: asset.filename, aspectRatio: ratio, createdAt: new Date(asset.created_at) }
                    setLatestImage(img)
                    setSelectedImage(img)
                    setConfirmedImage(null)
                }} />
                <div className="flex-1 flex flex-col overflow-y-auto bg-[var(--color-gray-50)]">
                    <div className="px-6 py-6 space-y-6 flex-1">
                        <div className="flex items-center gap-1 border-b border-[var(--color-gray-200)] pb-3">
                            {(['single', 'carousel'] as const).map(m => (
                                <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 text-xs font-medium transition-colors relative ${mode === m ? 'text-[var(--color-primary)]' : 'text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)]'}`}>
                                    {m === 'single' ? <ImageIcon className="w-3.5 h-3.5 inline mr-1.5" /> : <Layers className="w-3.5 h-3.5 inline mr-1.5" />}
                                    {m === 'single' ? 'Single Image' : 'Carousel'}
                                    {mode === m && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--color-primary)] rounded-full" />}
                                </button>
                            ))}
                        </div>
                        {mode === 'carousel' && (
                            <div className="space-y-3">
                                <div>
                                    <label className="text-[10px] uppercase tracking-wider text-[var(--color-gray-400)] block mb-1.5">Style Direction <span className="text-[var(--color-gray-300)]">(prepended to all slides)</span></label>
                                    <textarea value={basePrompt} onChange={e => setBasePrompt(e.target.value)} placeholder="e.g. Professional photography, natural lighting..." rows={2} className="w-full rounded-lg bg-white border border-[var(--color-gray-300)] px-3 py-2 text-sm text-[var(--color-gray-900)] placeholder:text-[var(--color-gray-400)] focus:outline-none focus:border-[var(--color-primary)] resize-none" />
                                </div>
                                <SlideStrip slides={slides} activeIndex={activeSlideIndex} onSelectSlide={i => { setShowAllSlides(false); handleSelectSlide(i) }} onAddSlide={() => { setShowAllSlides(false); handleAddSlide() }} showAll={showAllSlides} onToggleAll={() => setShowAllSlides(!showAllSlides)} />
                            </div>
                        )}
                        {mode === 'carousel' && showAllSlides ? (
                            <div className="space-y-2">
                                <p className="text-[10px] uppercase tracking-wider text-[var(--color-gray-400)]">All Slides</p>
                                <div className="flex gap-3 overflow-x-auto pb-2">{slides.map((sl, i) => { const img = sl.selectedIndex >= 0 ? sl.generations[sl.selectedIndex] : sl.generations[sl.generations.length - 1]; return (
                                    <button key={sl.id} onClick={() => { setShowAllSlides(false); handleSelectSlide(i) }} className="shrink-0 flex flex-col items-center gap-1.5 group">
                                        <div className="relative border border-[var(--color-gray-200)] overflow-hidden hover:border-[var(--color-primary)]/40 rounded-lg" style={{ width: 180 }}>{img ? <img src={img.url} alt="" className={`w-full ${aspectRatioToClass(aspectRatio)} object-cover`} /> : <div className={`w-full ${aspectRatioToClass(aspectRatio)} bg-[var(--color-gray-100)] flex items-center justify-center`}><Sparkles className="w-5 h-5 text-[var(--color-gray-300)]" /></div>}<div className="absolute top-1.5 left-1.5 bg-black/60 text-white text-[9px] font-medium px-1.5 py-0.5 rounded">{i + 1}</div></div>
                                        <p className="text-[10px] text-[var(--color-gray-400)] truncate max-w-[180px]">{sl.prompt ? sl.prompt.slice(0, 40) + (sl.prompt.length > 40 ? '...' : '') : 'No prompt'}</p>
                                    </button>
                                ) })}</div>
                            </div>
                        ) : null}
                        {!(mode === 'carousel' && showAllSlides) && <ComparisonView previous={confirmedImage} latest={latestImage} generations={activeGenerations} aspectRatio={aspectRatio} generating={generating} selectedId={selectedImage?.id ?? null} showLogo={showLogoPanel} logoUrl={selectedLogoUrl} logoPosition={logoPosition}
                            onRevert={() => { if (confirmedImage) { setLatestImage(confirmedImage); setConfirmedImage(null); setSelectedImage(confirmedImage); if (mode === 'carousel') setSlides(p => p.map((s, i) => { if (i !== activeSlideIndex) return s; const gi = s.generations.findIndex(g => g.id === confirmedImage.id); return { ...s, selectedIndex: gi >= 0 ? gi : s.selectedIndex } })) } }}
                            onSelect={() => { if (latestImage) { setSelectedImage(latestImage); if (mode === 'carousel') setSlides(p => p.map((s, i) => { if (i !== activeSlideIndex) return s; const gi = s.generations.findIndex(g => g.id === latestImage.id); return { ...s, selectedIndex: gi >= 0 ? gi : s.selectedIndex } })) } }}
                            onSelectGeneration={g => { setConfirmedImage(latestImage); setLatestImage(g); setSelectedImage(g) }}
                        />}
                        <PromptBar prompt={activePrompt} onPromptChange={setActivePrompt} aspectRatio={aspectRatio} onAspectRatioChange={setAspectRatio} imageModel={imageModel} onImageModelChange={setImageModel} referenceImages={referenceImages} onRemoveReference={i => setReferenceImages(p => p.filter((_, j) => j !== i))} generating={generating} onGenerate={mode === 'carousel' && slides.every(s => s.generations.length === 0) ? handleGenerateCarousel : handleGenerate} mode={mode} hasGenerations={activeGenerations.length > 0} refinement={refinement} onRefinementChange={setRefinement} />
                    </div>
                    <div className="shrink-0 px-6 py-3 border-t border-[var(--color-gray-200)] flex items-center gap-2 bg-white">
                        <Button variant="secondary" size="sm" disabled={!selectedImage} onClick={async () => { if (selectedImage) { const av = await detectVariant(selectedImage.url); const vi = logos.findIndex(l => l.label.toLowerCase().includes(av)); if (vi >= 0) setSelectedLogoIndex(vi) }; setShowLogoPanel(true) }}><ImageIcon className="w-3.5 h-3.5 mr-1.5" />Add Logo</Button>
                        {mode === 'carousel' ? (
                            <div className="relative">
                                <Button variant="secondary" size="sm" disabled={!selectedImage && slides.every(s => s.generations.length === 0)} onClick={() => setShowSaveMenu(!showSaveMenu)}><Save className="w-3.5 h-3.5 mr-1.5" />Save<ChevronDown className="w-3 h-3 ml-1" /></Button>
                                {showSaveMenu && <><div className="fixed inset-0 z-40" onClick={() => setShowSaveMenu(false)} /><div className="absolute bottom-full left-0 mb-1 bg-white border border-[var(--color-gray-200)] rounded-lg shadow-xl z-50 min-w-[200px] py-1"><button className="w-full text-left px-3 py-2 text-xs text-[var(--color-gray-600)] hover:bg-[var(--color-gray-50)] disabled:opacity-40" disabled={!selectedImage} onClick={() => { handleSaveToLibrary(); setShowSaveMenu(false) }}>Save this image</button><button className="w-full text-left px-3 py-2 text-xs text-[var(--color-gray-600)] hover:bg-[var(--color-gray-50)] disabled:opacity-40" disabled={slides.every(s => s.generations.length === 0)} onClick={() => { handleSaveCarousel(); setShowSaveMenu(false) }}>Save all slides as set</button></div></>}
                            </div>
                        ) : <Button variant="secondary" size="sm" disabled={!selectedImage} onClick={handleSaveToLibrary}><Save className="w-3.5 h-3.5 mr-1.5" />Save to Library</Button>}
                        <Button variant="secondary" size="sm" disabled={!selectedImage} onClick={handleDownload}><Download className="w-3.5 h-3.5 mr-1.5" />Download</Button>
                        <div className="w-px h-5 bg-[var(--color-gray-200)] mx-1" />
                        <Button variant="primary" size="sm" disabled={!selectedImage} onClick={() => { setCreatePostTitle(selectedImage?.prompt?.slice(0, 80) || ''); setShowCreatePostModal(true) }}><FileText className="w-3.5 h-3.5 mr-1.5" />Create Post</Button>
                        <div className="w-px h-5 bg-[var(--color-gray-200)] mx-1" />
                        <button className="px-3 py-1.5 rounded-lg border border-[var(--color-gray-200)] text-xs text-red-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 flex items-center gap-1.5" disabled={generations.length === 0 && slides[0]?.generations.length === 0} onClick={handleReset}><RotateCcw className="w-3.5 h-3.5" />Start Over</button>
                        {mode === 'carousel' && <><div className="w-px h-5 bg-[var(--color-gray-200)] mx-1" /><Button variant="secondary" size="sm" disabled={generating || !prompt.trim()} onClick={handleGenerateCarousel}><Sparkles className="w-3.5 h-3.5 mr-1.5" />Regenerate All</Button><Button variant="secondary" size="sm" disabled={slides.every(s => s.generations.length === 0)} onClick={handleDownloadAll}><Download className="w-3.5 h-3.5 mr-1.5" />Download All</Button></>}
                    </div>
                </div>
                {showLogoPanel && <LogoPanel logos={logos} selectedLogoIndex={selectedLogoIndex} onSelectLogo={setSelectedLogoIndex} logoPosition={logoPosition} onPositionChange={setLogoPosition} onApply={handleApplyLogo} onCancel={() => setShowLogoPanel(false)} applying={applyingLogo} />}
            </div>
            {/* Create Post Modal */}
            {showCreatePostModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
                        <div className="px-6 py-4 border-b border-[var(--color-gray-200)]">
                            <h3 className="text-sm font-semibold text-[var(--color-gray-900)]">Create Post from Image</h3>
                            <p className="text-xs text-[var(--color-gray-500)] mt-0.5">This will create a new post that can be scheduled on the calendar.</p>
                        </div>
                        <div className="px-6 py-4 space-y-4">
                            {selectedImage && (
                                <div className="flex items-center gap-3">
                                    <img src={selectedImage.url} alt="" className="w-16 h-16 rounded-lg object-cover border border-[var(--color-gray-200)]" />
                                    <p className="text-xs text-[var(--color-gray-500)] flex-1 line-clamp-3">{selectedImage.prompt}</p>
                                </div>
                            )}
                            <div>
                                <label className="block text-xs font-medium text-[var(--color-gray-700)] mb-1">Post Title</label>
                                <input
                                    type="text"
                                    value={createPostTitle}
                                    onChange={e => setCreatePostTitle(e.target.value)}
                                    placeholder="Enter a title for this post..."
                                    className="w-full px-3 py-2 text-sm border border-[var(--color-gray-300)] rounded-lg focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]/20"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-[var(--color-gray-700)] mb-1">Content Layer</label>
                                <select
                                    value={createPostLayer}
                                    onChange={e => setCreatePostLayer(e.target.value as ContentLayer | '')}
                                    className="w-full px-3 py-2 text-sm border border-[var(--color-gray-300)] rounded-lg focus:outline-none focus:border-[var(--color-primary)] bg-white"
                                >
                                    <option value="">Select a layer...</option>
                                    {CONTENT_LAYERS.map(l => (
                                        <option key={l.value} value={l.value}>{l.label} — {l.description}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-[var(--color-gray-200)] flex items-center justify-end gap-3">
                            <Button variant="secondary" size="sm" onClick={() => setShowCreatePostModal(false)}>Cancel</Button>
                            <Button variant="primary" size="sm" disabled={!createPostTitle.trim() || creatingPost} isLoading={creatingPost} onClick={handleCreatePost}>
                                <FileText className="w-3.5 h-3.5 mr-1.5" />Create Post
                            </Button>
                        </div>
                    </div>
                </div>
            )}
            {toast && <div className="fixed bottom-6 right-6 bg-white border border-[var(--color-gray-200)] rounded-lg px-4 py-2.5 text-xs text-[var(--color-gray-700)] shadow-xl z-50">{toast}</div>}
        </div>
    )
}
