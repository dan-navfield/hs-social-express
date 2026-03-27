import { useState, useEffect, useCallback, useMemo } from 'react'
import {
    DndContext,
    DragOverlay,
    useDraggable,
    useDroppable,
    type DragEndEvent,
    type DragStartEvent,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { ChevronLeft, ChevronRight, Calendar, GripVertical, Search, X, Clock, Share2 } from 'lucide-react'
import { Button } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useSpaceStore } from '@/stores/spaceStore'
import { getLayerColor, LAYER_LABELS } from '@/lib/content-layers'
import { CONTENT_LAYERS, CONTENT_CATEGORIES, type ContentLayer, type ContentCategory } from '@/types/database'

// ── Types ────────────────────────────────────────────

interface CalendarPost {
    id: string
    title: string
    body: string | null
    status: string
    content_layer: ContentLayer | null
    content_category: string | null
    scheduled_at: string | null
    campaign: { name: string } | null
    image_status: string
    generated_image_path: string | null
    final_image_path: string | null
}

const CHANNELS = [
    { id: 'linkedin', label: 'LinkedIn', icon: 'in' },
    { id: 'facebook', label: 'Facebook', icon: 'fb' },
    { id: 'instagram', label: 'Instagram', icon: 'ig' },
    { id: 'x', label: 'X / Twitter', icon: 'X' },
] as const

// ── Date Helpers ─────────────────────────────────────

function getMonthDays(year: number, month: number) {
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const startPad = (firstDay.getDay() + 6) % 7 // Monday start
    const days: { date: Date; isCurrentMonth: boolean }[] = []

    for (let i = startPad - 1; i >= 0; i--) {
        days.push({ date: new Date(year, month, -i), isCurrentMonth: false })
    }
    for (let i = 1; i <= lastDay.getDate(); i++) {
        days.push({ date: new Date(year, month, i), isCurrentMonth: true })
    }
    const target = days.length <= 35 ? 35 : 42
    let nextDay = 1
    while (days.length < target) {
        days.push({ date: new Date(year, month + 1, nextDay++), isCurrentMonth: false })
    }
    return days
}

function dateToKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ── PostCard (Draggable) ─────────────────────────────

function DraggablePostCard({ post, isOverlay = false, onClick }: { post: CalendarPost; isOverlay?: boolean; onClick?: () => void }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: post.id })
    const layerColor = getLayerColor(post.content_layer)

    const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined

    if (isOverlay) {
        return (
            <div className={`px-2 py-1.5 rounded-md border text-xs cursor-grabbing shadow-lg ${layerColor.bg} ${layerColor.border}`}>
                <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${layerColor.dot}`} />
                    <span className={`font-medium truncate ${layerColor.text}`}>{post.title}</span>
                </div>
            </div>
        )
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`px-2 py-1.5 rounded-md border text-xs cursor-grab active:cursor-grabbing transition-opacity ${layerColor.bg} ${layerColor.border} ${isDragging ? 'opacity-30' : 'hover:shadow-sm'}`}
            {...listeners}
            {...attributes}
            onPointerUp={(e) => {
                // Only fire click if pointer hasn't moved much (not a drag)
                if (!isDragging && onClick) { e.stopPropagation(); onClick() }
            }}
        >
            <div className="flex items-center gap-1.5">
                <GripVertical className="w-3 h-3 shrink-0 text-[var(--color-gray-400)]" />
                <div className={`w-2 h-2 rounded-full shrink-0 ${layerColor.dot}`} />
                <span className={`font-medium truncate ${layerColor.text}`}>{post.title}</span>
            </div>
            {post.content_layer && (
                <p className="text-[10px] text-[var(--color-gray-400)] mt-0.5 ml-[26px] truncate">
                    {LAYER_LABELS[post.content_layer] || post.content_layer}
                </p>
            )}
        </div>
    )
}

// ── Sidebar Post Card (for the list) ─────────────────

function SidebarPostCard({ post, onClick }: { post: CalendarPost; onClick?: () => void }) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: post.id })
    const layerColor = getLayerColor(post.content_layer)

    const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`px-3 py-2.5 rounded-lg border text-sm cursor-grab active:cursor-grabbing transition-all ${layerColor.bg} ${layerColor.border} ${isDragging ? 'opacity-30' : 'hover:shadow-sm'}`}
            {...listeners}
            {...attributes}
            onPointerUp={(e) => { if (!isDragging && onClick) { e.stopPropagation(); onClick() } }}
        >
            <div className="flex items-start gap-2">
                <GripVertical className="w-3.5 h-3.5 shrink-0 text-[var(--color-gray-400)] mt-0.5" />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${layerColor.dot}`} />
                        <span className={`font-medium truncate ${layerColor.text}`}>{post.title}</span>
                    </div>
                    {post.body && (
                        <p className="text-xs text-[var(--color-gray-500)] line-clamp-2">{post.body.slice(0, 100)}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                        {post.content_layer && (
                            <span className="text-[10px] text-[var(--color-gray-400)]">{LAYER_LABELS[post.content_layer]}</span>
                        )}
                        {post.campaign?.name && (
                            <span className="text-[10px] text-[var(--color-gray-400)]">{post.campaign.name}</span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

// ── CalendarDay (Droppable) ──────────────────────────

function CalendarDay({ date, isCurrentMonth, isToday, posts, onPostClick }: {
    date: Date; isCurrentMonth: boolean; isToday: boolean; posts: CalendarPost[]; onPostClick: (post: CalendarPost) => void
}) {
    const dayKey = dateToKey(date)
    const { setNodeRef, isOver } = useDroppable({ id: dayKey })

    return (
        <div
            ref={setNodeRef}
            className={`min-h-[100px] p-1.5 rounded-lg border transition-colors ${
                isOver
                    ? 'bg-[var(--color-primary)]/5 border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/20'
                    : isToday
                      ? 'bg-white border-[var(--color-primary)]/30 ring-2 ring-[var(--color-primary)]/20'
                      : isCurrentMonth
                        ? 'bg-white border-[var(--color-gray-200)]'
                        : 'bg-[var(--color-gray-50)] border-[var(--color-gray-100)]'
            }`}
        >
            <div className={`text-xs font-medium mb-1 ${
                isToday
                    ? 'text-[var(--color-primary)]'
                    : isCurrentMonth
                      ? 'text-[var(--color-gray-700)]'
                      : 'text-[var(--color-gray-400)]'
            }`}>
                {isToday ? (
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-primary)] text-white text-xs">
                        {date.getDate()}
                    </span>
                ) : date.getDate()}
            </div>
            <div className="space-y-1">
                {posts.map(post => (
                    <DraggablePostCard key={post.id} post={post} onClick={() => onPostClick(post)} />
                ))}
            </div>
        </div>
    )
}

// ── Unscheduled Sidebar (Droppable) ──────────────────

function UnscheduledSidebar({ posts, layerFilter, onLayerFilterChange, search, onSearchChange, onPostClick }: {
    posts: CalendarPost[]
    layerFilter: string
    onLayerFilterChange: (v: string) => void
    search: string
    onSearchChange: (v: string) => void
    onPostClick: (post: CalendarPost) => void
}) {
    const { setNodeRef, isOver } = useDroppable({ id: 'unscheduled-sidebar' })

    const filtered = posts.filter(p => {
        if (layerFilter && p.content_layer !== layerFilter) return false
        if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false
        return true
    })

    return (
        <div
            ref={setNodeRef}
            className={`w-72 shrink-0 border-r flex flex-col h-full bg-white transition-colors ${
                isOver ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-gray-200)]'
            }`}
        >
            <div className="px-4 py-3 border-b border-[var(--color-gray-200)]">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-[var(--color-gray-900)]">
                        Unscheduled
                        <span className="ml-1.5 text-[var(--color-gray-400)] font-normal">({filtered.length})</span>
                    </h2>
                </div>

                <div className="relative mb-2">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--color-gray-400)]" />
                    <input
                        type="text"
                        value={search}
                        onChange={e => onSearchChange(e.target.value)}
                        placeholder="Search posts..."
                        className="w-full pl-8 pr-3 py-1.5 text-xs border border-[var(--color-gray-300)] rounded-lg focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]/20"
                    />
                </div>

                <select
                    value={layerFilter}
                    onChange={e => onLayerFilterChange(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-[var(--color-gray-300)] rounded-lg focus:outline-none focus:border-[var(--color-primary)] bg-white"
                >
                    <option value="">All Layers</option>
                    {CONTENT_LAYERS.map(l => (
                        <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                </select>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {filtered.length === 0 ? (
                    <p className="text-xs text-[var(--color-gray-400)] text-center py-8">
                        {posts.length === 0 ? 'No unscheduled posts' : 'No posts match filters'}
                    </p>
                ) : (
                    filtered.map(post => <SidebarPostCard key={post.id} post={post} onClick={() => onPostClick(post)} />)
                )}
            </div>

            {isOver && (
                <div className="px-4 py-2 border-t border-[var(--color-primary)]/20 bg-[var(--color-primary)]/5 text-center">
                    <p className="text-xs text-[var(--color-primary)] font-medium">Drop to unschedule</p>
                </div>
            )}
        </div>
    )
}

// ── Main Component ───────────────────────────────────

export function SocialCalendar() {
    const { currentSpace } = useSpaceStore()
    const today = new Date()
    const [currentMonth, setCurrentMonth] = useState(today.getMonth())
    const [currentYear, setCurrentYear] = useState(today.getFullYear())
    const [posts, setPosts] = useState<CalendarPost[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [activeId, setActiveId] = useState<string | null>(null)
    const [layerFilter, setLayerFilter] = useState('')
    const [search, setSearch] = useState('')
    const [selectedPost, setSelectedPost] = useState<CalendarPost | null>(null)
    const [modalTime, setModalTime] = useState('09:00')
    const [modalChannels, setModalChannels] = useState<string[]>([])
    const [modalLayer, setModalLayer] = useState<ContentLayer | ''>('')
    const [modalCategory, setModalCategory] = useState<ContentCategory | ''>('')
    const [modalDate, setModalDate] = useState('')
    const [isSavingModal, setIsSavingModal] = useState(false)

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
    )

    const fetchPosts = useCallback(async () => {
        if (!currentSpace) return
        setIsLoading(true)
        const { data } = await supabase
            .from('posts')
            .select('id, title, body, status, content_layer, content_category, scheduled_at, campaign:campaigns(name), image_status, generated_image_path, final_image_path')
            .eq('space_id', currentSpace.id)
            .in('status', ['draft', 'ready_to_publish', 'scheduled', 'published', 'sent_to_hubspot'])
            .order('created_at', { ascending: false })
        // Supabase returns campaign as array for FK join — flatten to single object
        const normalized = (data || []).map((p: any) => ({
            ...p,
            campaign: Array.isArray(p.campaign) ? p.campaign[0] || null : p.campaign,
        }))
        setPosts(normalized)
        setIsLoading(false)
    }, [currentSpace])

    useEffect(() => { fetchPosts() }, [fetchPosts])

    const unscheduledPosts = useMemo(() => posts.filter(p => !p.scheduled_at), [posts])
    const scheduledPosts = useMemo(() => posts.filter(p => p.scheduled_at), [posts])

    const days = useMemo(() => getMonthDays(currentYear, currentMonth), [currentYear, currentMonth])

    const postsByDay = useMemo(() => {
        const map = new Map<string, CalendarPost[]>()
        for (const post of scheduledPosts) {
            if (!post.scheduled_at) continue
            const key = dateToKey(new Date(post.scheduled_at))
            const existing = map.get(key) || []
            existing.push(post)
            map.set(key, existing)
        }
        return map
    }, [scheduledPosts])

    const activePost = activeId ? posts.find(p => p.id === activeId) : null

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string)
    }

    const handleDragEnd = async (event: DragEndEvent) => {
        setActiveId(null)
        const { active, over } = event
        if (!over) return

        const postId = active.id as string

        if (over.id === 'unscheduled-sidebar') {
            // Unschedule
            setPosts(prev => prev.map(p => p.id === postId ? { ...p, scheduled_at: null, status: 'ready_to_publish' } : p))
            await supabase.from('posts').update({ scheduled_at: null, status: 'ready_to_publish', updated_at: new Date().toISOString() }).eq('id', postId)
        } else {
            // Schedule to a specific day
            const dateStr = over.id as string
            const scheduledAt = new Date(`${dateStr}T09:00:00`).toISOString()
            setPosts(prev => prev.map(p => p.id === postId ? { ...p, scheduled_at: scheduledAt, status: 'scheduled' } : p))
            await supabase.from('posts').update({ scheduled_at: scheduledAt, status: 'scheduled', updated_at: new Date().toISOString() }).eq('id', postId)
        }
    }

    const openPostModal = (post: CalendarPost) => {
        setSelectedPost(post)
        setModalLayer((post.content_layer || '') as ContentLayer | '')
        setModalCategory((post.content_category || '') as ContentCategory | '')
        if (post.scheduled_at) {
            const d = new Date(post.scheduled_at)
            setModalDate(dateToKey(d))
            setModalTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
        } else {
            setModalDate('')
            setModalTime('09:00')
        }
        setModalChannels([]) // TODO: load from post metadata if stored
    }

    const handleSavePostDetails = async () => {
        if (!selectedPost) return
        setIsSavingModal(true)
        try {
            const updates: Record<string, any> = {
                content_layer: modalLayer || null,
                content_category: modalCategory || null,
                updated_at: new Date().toISOString(),
            }

            if (modalDate) {
                const [h, m] = modalTime.split(':').map(Number)
                const scheduled = new Date(`${modalDate}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`)
                updates.scheduled_at = scheduled.toISOString()
                updates.status = 'scheduled'
            }

            // Store channels in hubspot_meta for now (can be moved to a dedicated field later)
            if (modalChannels.length > 0) {
                updates.hubspot_meta = { channels: modalChannels }
            }

            await supabase.from('posts').update(updates).eq('id', selectedPost.id)

            // Optimistic update
            setPosts(prev => prev.map(p => p.id === selectedPost.id ? { ...p, ...updates } : p))
            setSelectedPost(null)
        } catch {
            alert('Failed to save')
        } finally {
            setIsSavingModal(false)
        }
    }

    const toggleChannel = (ch: string) => {
        setModalChannels(prev => prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch])
    }

    const goToPrevMonth = () => {
        if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1) }
        else { setCurrentMonth(m => m - 1) }
    }

    const goToNextMonth = () => {
        if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1) }
        else { setCurrentMonth(m => m + 1) }
    }

    const goToToday = () => {
        setCurrentMonth(today.getMonth())
        setCurrentYear(today.getFullYear())
    }

    if (!currentSpace) return <div className="p-8 text-center text-[var(--color-gray-400)]">Select a workspace</div>

    return (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="h-[calc(100vh-4rem)] flex flex-col">
                {/* Header */}
                <div className="bg-white border-b border-[var(--color-gray-200)] px-6 py-3 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-1.5 rounded-lg bg-[var(--color-primary)]/10">
                            <Calendar className="w-4 h-4 text-[var(--color-primary)]" />
                        </div>
                        <div>
                            <h1 className="text-sm font-semibold text-[var(--color-gray-900)]">Social Calendar</h1>
                            <p className="text-[10px] text-[var(--color-gray-400)]">Drag posts to schedule them</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={goToPrevMonth}>
                            <ChevronLeft className="w-4 h-4" />
                        </Button>
                        <span className="text-sm font-medium text-[var(--color-gray-900)] min-w-[140px] text-center">
                            {MONTH_NAMES[currentMonth]} {currentYear}
                        </span>
                        <Button variant="ghost" size="sm" onClick={goToNextMonth}>
                            <ChevronRight className="w-4 h-4" />
                        </Button>
                        <Button variant="secondary" size="sm" onClick={goToToday}>
                            Today
                        </Button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Left sidebar */}
                    <UnscheduledSidebar
                        posts={unscheduledPosts}
                        layerFilter={layerFilter}
                        onLayerFilterChange={setLayerFilter}
                        search={search}
                        onSearchChange={setSearch}
                        onPostClick={openPostModal}
                    />

                    {/* Calendar grid */}
                    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-gray-50)] p-4">
                        {isLoading ? (
                            <div className="flex-1 flex items-center justify-center">
                                <p className="text-sm text-[var(--color-gray-400)]">Loading...</p>
                            </div>
                        ) : (
                            <>
                                {/* Day headers */}
                                <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                                    {DAY_NAMES.map(day => (
                                        <div key={day} className="text-center text-[10px] font-medium text-[var(--color-gray-400)] uppercase tracking-wider py-1">
                                            {day}
                                        </div>
                                    ))}
                                </div>

                                {/* Day cells */}
                                <div className="grid grid-cols-7 gap-1.5 flex-1 auto-rows-fr">
                                    {days.map(({ date, isCurrentMonth }) => {
                                        const key = dateToKey(date)
                                        const dayPosts = postsByDay.get(key) || []
                                        const isToday_ = isSameDay(date, today)
                                        return (
                                            <CalendarDay
                                                key={key}
                                                date={date}
                                                isCurrentMonth={isCurrentMonth}
                                                isToday={isToday_}
                                                posts={dayPosts}
                                                onPostClick={openPostModal}
                                            />
                                        )
                                    })}
                                </div>

                                {/* Legend */}
                                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[var(--color-gray-200)]">
                                    {Object.entries(LAYER_LABELS).map(([key, label]) => {
                                        const color = getLayerColor(key)
                                        return (
                                            <div key={key} className="flex items-center gap-1.5">
                                                <div className={`w-2.5 h-2.5 rounded-full ${color.dot}`} />
                                                <span className="text-[10px] text-[var(--color-gray-500)]">{label}</span>
                                            </div>
                                        )
                                    })}
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />
                                        <span className="text-[10px] text-[var(--color-gray-500)]">Uncategorised</span>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Drag overlay — follows cursor */}
            {/* Post Detail Modal */}
            {selectedPost && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedPost(null)}>
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div className="px-6 py-4 border-b border-[var(--color-gray-200)] flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-[var(--color-gray-900)] truncate pr-4">{selectedPost.title}</h3>
                            <button onClick={() => setSelectedPost(null)} className="p-1 rounded hover:bg-[var(--color-gray-100)]">
                                <X className="w-4 h-4 text-[var(--color-gray-400)]" />
                            </button>
                        </div>

                        <div className="px-6 py-4 space-y-5">
                            {/* Image preview */}
                            {(selectedPost.final_image_path || selectedPost.generated_image_path) && (
                                <div className="rounded-lg overflow-hidden border border-[var(--color-gray-200)]">
                                    <img
                                        src={supabase.storage.from('generated-images').getPublicUrl(selectedPost.final_image_path || selectedPost.generated_image_path || '').data.publicUrl}
                                        alt=""
                                        className="w-full max-h-48 object-cover"
                                    />
                                </div>
                            )}

                            {/* Body text */}
                            {selectedPost.body && (
                                <div>
                                    <label className="block text-[10px] font-medium text-[var(--color-gray-400)] uppercase tracking-wider mb-1">Post Content</label>
                                    <p className="text-sm text-[var(--color-gray-700)] whitespace-pre-wrap line-clamp-6">{selectedPost.body}</p>
                                </div>
                            )}

                            {/* Schedule: Date + Time */}
                            <div>
                                <label className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--color-gray-400)] uppercase tracking-wider mb-2">
                                    <Clock className="w-3 h-3" /> Schedule
                                </label>
                                <div className="flex gap-3">
                                    <input
                                        type="date"
                                        value={modalDate}
                                        onChange={e => setModalDate(e.target.value)}
                                        className="flex-1 px-3 py-2 text-sm border border-[var(--color-gray-300)] rounded-lg focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]/20"
                                    />
                                    <input
                                        type="time"
                                        value={modalTime}
                                        onChange={e => setModalTime(e.target.value)}
                                        className="w-28 px-3 py-2 text-sm border border-[var(--color-gray-300)] rounded-lg focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]/20"
                                    />
                                </div>
                            </div>

                            {/* Channels */}
                            <div>
                                <label className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--color-gray-400)] uppercase tracking-wider mb-2">
                                    <Share2 className="w-3 h-3" /> Channels
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    {CHANNELS.map(ch => (
                                        <button
                                            key={ch.id}
                                            onClick={() => toggleChannel(ch.id)}
                                            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                                                modalChannels.includes(ch.id)
                                                    ? 'bg-[var(--color-primary)]/10 border-[var(--color-primary)] text-[var(--color-primary)]'
                                                    : 'bg-white border-[var(--color-gray-200)] text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'
                                            }`}
                                        >
                                            <span className="w-5 h-5 rounded bg-[var(--color-gray-100)] flex items-center justify-center text-[10px] font-bold text-[var(--color-gray-600)]">{ch.icon}</span>
                                            {ch.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Content Layer */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[10px] font-medium text-[var(--color-gray-400)] uppercase tracking-wider mb-1">Content Layer</label>
                                    <select
                                        value={modalLayer}
                                        onChange={e => { setModalLayer(e.target.value as ContentLayer | ''); setModalCategory('') }}
                                        className="w-full px-3 py-2 text-sm border border-[var(--color-gray-300)] rounded-lg focus:outline-none focus:border-[var(--color-primary)] bg-white"
                                    >
                                        <option value="">None</option>
                                        {CONTENT_LAYERS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-medium text-[var(--color-gray-400)] uppercase tracking-wider mb-1">Category</label>
                                    <select
                                        value={modalCategory}
                                        onChange={e => setModalCategory(e.target.value as ContentCategory | '')}
                                        className="w-full px-3 py-2 text-sm border border-[var(--color-gray-300)] rounded-lg focus:outline-none focus:border-[var(--color-primary)] bg-white"
                                    >
                                        <option value="">None</option>
                                        {CONTENT_CATEGORIES.filter(c => !modalLayer || c.layer === modalLayer).map(c => (
                                            <option key={c.value} value={c.value}>{c.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 border-t border-[var(--color-gray-200)] flex items-center justify-end gap-3">
                            <Button variant="secondary" size="sm" onClick={() => setSelectedPost(null)}>Cancel</Button>
                            <Button variant="primary" size="sm" isLoading={isSavingModal} onClick={handleSavePostDetails}>
                                Save Changes
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <DragOverlay>
                {activePost ? <DraggablePostCard post={activePost} isOverlay /> : null}
            </DragOverlay>
        </DndContext>
    )
}
