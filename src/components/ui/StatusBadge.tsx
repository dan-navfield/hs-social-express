import type { PostStatus, CampaignStatus } from '@/types/database'

interface BadgeProps {
    status: PostStatus | CampaignStatus | string
    className?: string
}

const statusConfig: Record<string, { label: string; className: string }> = {
    // Post statuses
    generating_text: {
        label: 'Generating',
        className: 'bg-amber-100 text-amber-800 animate-pulse-slow',
    },
    generating_image: {
        label: 'Generating Image',
        className: 'bg-amber-100 text-amber-800 animate-pulse-slow',
    },
    draft: {
        label: 'Draft',
        className: 'bg-blue-100 text-blue-800',
    },
    ready_to_publish: {
        label: 'Ready',
        className: 'bg-purple-100 text-purple-800',
    },
    scheduled: {
        label: 'Scheduled',
        className: 'bg-indigo-100 text-indigo-800',
    },
    published: {
        label: 'Published',
        className: 'bg-green-100 text-green-800',
    },
    selected_to_publish: {
        label: 'Selected',
        className: 'bg-purple-100 text-purple-800',
    },
    sent_to_hubspot: {
        label: 'Sent',
        className: 'bg-green-100 text-green-800',
    },
    failed: {
        label: 'Failed',
        className: 'bg-red-100 text-red-800',
    },
    // Campaign statuses
    running: {
        label: 'Running',
        className: 'bg-blue-100 text-blue-800 animate-pulse-slow',
    },
    completed: {
        label: 'Completed',
        className: 'bg-green-100 text-green-800',
    },
    // Image statuses
    none: {
        label: 'None',
        className: 'bg-gray-100 text-gray-800',
    },
    generating: {
        label: 'Generating',
        className: 'bg-amber-100 text-amber-800 animate-pulse-slow',
    },
    ready: {
        label: 'Ready',
        className: 'bg-green-100 text-green-800',
    },
    compositing: {
        label: 'Compositing',
        className: 'bg-amber-100 text-amber-800 animate-pulse-slow',
    },
}

export function StatusBadge({ status, className = '' }: BadgeProps) {
    const config = statusConfig[status] || {
        label: status,
        className: 'bg-gray-100 text-gray-800',
    }

    return (
        <span
            className={`
        inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium
        ${config.className}
        ${className}
      `}
        >
            {config.label}
        </span>
    )
}
