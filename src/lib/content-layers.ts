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
