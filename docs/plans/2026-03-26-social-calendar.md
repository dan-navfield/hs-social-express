# Social Calendar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a drag-and-drop social calendar where unscheduled posts appear in a sidebar list (filterable by content layer/category) and can be dragged onto calendar days to schedule them.

**Architecture:** A new `/calendar` page with a three-panel layout: left sidebar with unscheduled posts list, center monthly calendar grid showing scheduled posts on their days, and drag-and-drop powered by `@dnd-kit` (modern React DnD library). Dragging a post onto a day sets `scheduled_at` and updates status to `scheduled`. Posts are color-coded by content layer.

**Tech Stack:** React, @dnd-kit/core + @dnd-kit/sortable, Supabase client, Tailwind CSS

---

## Layout Overview

```
┌─────────────────────────────────────────────────────┐
│  Social Calendar                    ◄ Mar 2026 ►    │
├──────────┬──────────────────────────────────────────┤
│ UNSCHEDULED │  Mon  Tue  Wed  Thu  Fri  Sat  Sun   │
│ ─────────── │ ┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐ │
│ [Filter ▼]  │ │   ││   ││   ││ 1 ││ 2 ││ 3 ││ 4 │ │
│             │ │   ││   ││   ││   ││   ││   ││   │ │
│ ┌─────────┐ │ └───┘└───┘└───┘└───┘└───┘└───┘└───┘ │
│ │ Post A  │ │ ┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐ │
│ │ General │ │ │ 5 ││ 6 ││ 7 ││ 8 ││ 9 ││10 ││11 │ │
│ └─────────┘ │ │   ││▓▓▓││   ││   ││▓▓▓││   ││   │ │
│ ┌─────────┐ │ └───┘└───┘└───┘└───┘└───┘└───┘└───┘ │
│ │ Post B  │ │                                      │
│ │ Hot Top │ │  ... more weeks ...                  │
│ └─────────┘ │                                      │
│ ┌─────────┐ │                                      │
│ │ Post C  │ │                                      │
│ │ Mkt Ins │ │                                      │
│ └─────────┘ │                                      │
└──────────┴──────────────────────────────────────────┘
```

## Content Layer Colors

| Layer | Color | Tailwind |
|-------|-------|----------|
| General | Blue | `bg-blue-100 border-blue-300 text-blue-800` |
| Things We Sell | Emerald | `bg-emerald-100 border-emerald-300 text-emerald-800` |
| Market Insights | Purple | `bg-purple-100 border-purple-300 text-purple-800` |
| Hot Topics | Orange | `bg-orange-100 border-orange-300 text-orange-800` |
| Unset | Gray | `bg-gray-100 border-gray-300 text-gray-600` |

---

### Task 1: Install @dnd-kit

**Files:**
- Modify: `package.json`

**Step 1: Install the dependency**

```bash
npm install @dnd-kit/core @dnd-kit/utilities
```

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install @dnd-kit/core for drag-and-drop"
```

---

### Task 2: Create Content Layer Color Utilities

Shared color mapping for content layers, used by the calendar and eventually by other views.

**Files:**
- Create: `src/lib/content-layers.ts`

**Step 1: Write the utility**

```typescript
import type { ContentLayer } from '@/types/database'

export const LAYER_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
    general: {
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        text: 'text-blue-700',
        dot: 'bg-blue-400',
    },
    things_we_sell: {
        bg: 'bg-emerald-50',
        border: 'border-emerald-200',
        text: 'text-emerald-700',
        dot: 'bg-emerald-400',
    },
    market_insights: {
        bg: 'bg-purple-50',
        border: 'border-purple-200',
        text: 'text-purple-700',
        dot: 'bg-purple-400',
    },
    hot_topics: {
        bg: 'bg-orange-50',
        border: 'border-orange-200',
        text: 'text-orange-700',
        dot: 'bg-orange-400',
    },
}

export const DEFAULT_LAYER_COLOR = {
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    text: 'text-gray-600',
    dot: 'bg-gray-400',
}

export function getLayerColor(layer: ContentLayer | string | null) {
    if (!layer) return DEFAULT_LAYER_COLOR
    return LAYER_COLORS[layer] || DEFAULT_LAYER_COLOR
}

export const LAYER_LABELS: Record<string, string> = {
    general: 'General',
    things_we_sell: 'Things We Sell',
    market_insights: 'Market Insights',
    hot_topics: 'Hot Topics',
}
```

**Step 2: Commit**

```bash
git add src/lib/content-layers.ts
git commit -m "feat: add content layer color utilities"
```

---

### Task 3: Create the Social Calendar Page

This is the main task. One file containing all the components for the calendar view.

**Files:**
- Create: `src/pages/SocialCalendar.tsx`
- Modify: `src/App.tsx` (add route)
- Modify: `src/components/layout/Layout.tsx` (add nav item)

**Step 1: Write the calendar page**

The page has these internal components:

1. **PostCard** — Draggable post card used in both the sidebar list and on calendar days. Shows title (truncated), content layer color dot, and status badge. Small and compact.

2. **UnscheduledSidebar** — Left panel (280px) with:
   - Header: "Unscheduled" with count
   - Filter dropdown: by content layer (All / General / Things We Sell / Market Insights / Hot Topics)
   - Search input: filter by title
   - Scrollable list of PostCard components for posts where `scheduled_at IS NULL`
   - Each PostCard is draggable via `useDraggable` from @dnd-kit

3. **CalendarDay** — A single day cell in the calendar grid:
   - Day number in corner
   - Droppable zone via `useDroppable` from @dnd-kit
   - Shows compact PostCards for posts scheduled on that day
   - Highlights on drag-over
   - Today highlighted with accent border
   - Greyed out if not current month

4. **CalendarGrid** — The monthly grid:
   - 7-column grid (Mon-Sun)
   - 5-6 rows depending on month
   - Header row with day names
   - Navigation: previous/next month buttons, "Today" button
   - Current month/year display

5. **SocialCalendar (main)** — Wraps everything in `DndContext`:
   - Fetches all posts for current space
   - Splits into `unscheduledPosts` and `scheduledPosts`
   - Handles `onDragEnd`: when a post is dropped on a day, update `scheduled_at` and `status`
   - Handles unscheduling: dragging from calendar back to sidebar (drop on sidebar)
   - `DragOverlay` shows a ghost PostCard while dragging

**Key interactions:**
- Drag post from sidebar → drop on calendar day → sets `scheduled_at` to that day at 09:00, sets status to `scheduled`
- Drag post from one calendar day → drop on another → updates `scheduled_at`
- Drag post from calendar → drop on sidebar → clears `scheduled_at`, sets status back to `ready_to_publish`
- Click a post → opens a popover/tooltip showing full body text preview

**Data fetching:**
```typescript
const fetchPosts = async () => {
    const { data } = await supabase
        .from('posts')
        .select('id, title, body, status, content_layer, content_category, scheduled_at, campaign:campaigns(name), image_status')
        .eq('space_id', currentSpace.id)
        .in('status', ['draft', 'ready_to_publish', 'scheduled', 'sent_to_hubspot'])
        .order('created_at', { ascending: false })
    setPosts(data || [])
}
```

**Drop handler:**
```typescript
const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return

    const postId = active.id as string

    if (over.id === 'unscheduled-sidebar') {
        // Unschedule: drag back to sidebar
        await supabase.from('posts')
            .update({ scheduled_at: null, status: 'ready_to_publish', updated_at: new Date().toISOString() })
            .eq('id', postId)
    } else {
        // Schedule: over.id is a date string like "2026-03-15"
        const dateStr = over.id as string
        const scheduledAt = new Date(`${dateStr}T09:00:00`)
        await supabase.from('posts')
            .update({ scheduled_at: scheduledAt.toISOString(), status: 'scheduled', updated_at: new Date().toISOString() })
            .eq('id', postId)
    }

    // Optimistic update
    setPosts(prev => prev.map(p => {
        if (p.id !== postId) return p
        if (over.id === 'unscheduled-sidebar') return { ...p, scheduled_at: null, status: 'ready_to_publish' }
        return { ...p, scheduled_at: new Date(`${over.id}T09:00:00`).toISOString(), status: 'scheduled' }
    }))
}
```

**Calendar date helpers (inline, no library needed):**
```typescript
function getMonthDays(year: number, month: number) {
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const startPad = (firstDay.getDay() + 6) % 7 // Monday start
    const days: { date: Date; isCurrentMonth: boolean }[] = []

    // Previous month padding
    for (let i = startPad - 1; i >= 0; i--) {
        const d = new Date(year, month, -i)
        days.push({ date: d, isCurrentMonth: false })
    }
    // Current month
    for (let i = 1; i <= lastDay.getDate(); i++) {
        days.push({ date: new Date(year, month, i), isCurrentMonth: true })
    }
    // Next month padding (fill to 35 or 42)
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
```

**Theme — matches existing HS Social Express light theme:**
- Sidebar: `bg-white border-r border-[var(--color-gray-200)]`
- Calendar cells: `bg-white border border-[var(--color-gray-200)] rounded-lg`
- Drag over highlight: `bg-[var(--color-primary)]/5 border-[var(--color-primary)]`
- Today: `ring-2 ring-[var(--color-primary)]/30`
- Post cards use layer colors from Task 2

**Step 2: Add route in App.tsx**

```typescript
import { SocialCalendar } from '@/pages/SocialCalendar'
// Add route:
<Route path="/calendar" element={<ProtectedRoute><SocialCalendar /></ProtectedRoute>} />
```

**Step 3: Add nav item in Layout.tsx**

```typescript
import { Calendar } from 'lucide-react'
// Add to navItems:
{ path: '/calendar', icon: Calendar, label: 'Calendar', isGlobal: false },
```

**Step 4: Verify build**

```bash
npm run build
```

**Step 5: Commit**

```bash
git add src/pages/SocialCalendar.tsx src/App.tsx src/components/layout/Layout.tsx
git commit -m "feat: add social calendar with drag-and-drop scheduling"
```

---

### Task 4: Deploy

**Step 1: Build and deploy**

```bash
npm run build
vercel --prod --yes
```

**Step 2: Test end-to-end**

1. Navigate to Calendar in sidebar
2. Verify unscheduled posts appear in left sidebar
3. Filter by content layer — verify filtering works
4. Drag a post from sidebar onto a calendar day
5. Verify post moves to the calendar and `scheduled_at` is set in DB
6. Drag a post from one day to another — verify date updates
7. Drag a post from calendar back to sidebar — verify it unschedules
8. Navigate months with arrows — verify grid updates
9. Click "Today" — verify it returns to current month

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: deploy social calendar"
```

---

## Dependency Notes

- **@dnd-kit/core** — Modern React drag-and-drop. Lightweight (~12KB gzipped), accessible, works with React 19. Better than react-beautiful-dnd (deprecated) or react-dnd (complex).
- **@dnd-kit/utilities** — Helper for CSS transforms on draggable items.
- No date library needed — the calendar math is simple enough with native `Date`.
