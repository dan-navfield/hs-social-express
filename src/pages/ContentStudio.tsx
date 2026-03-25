import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
    FileText,
    Megaphone,
    Sparkles,
    Database,
    Mic2,
    BrainCircuit,
    Link2,
    ArrowRight,
    Image,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useSpaceStore } from '@/stores/spaceStore'

interface ContentAsset {
    id: string
    public_url: string | null
    filename: string
}

interface SectionItem {
    title: string
    description: string
    icon: React.ReactNode
    href: string
    count: number | null
}

export function ContentStudio() {
    const { currentSpace } = useSpaceStore()
    const [assets, setAssets] = useState<ContentAsset[]>([])

    useEffect(() => {
        if (!currentSpace) return

        const fetchAssets = async () => {
            const { data } = await supabase
                .from('content_assets')
                .select('*')
                .eq('space_id', currentSpace.id)
                .order('created_at', { ascending: false })
                .limit(6)

            if (data) setAssets(data)
        }

        fetchAssets()
    }, [currentSpace])

    const createSections: SectionItem[] = [
        {
            title: 'Posts',
            description: 'Create and manage social media posts',
            icon: <FileText className="size-5" />,
            href: '/posts',
            count: null,
        },
        {
            title: 'Campaigns',
            description: 'Organize posts into themed campaigns',
            icon: <Megaphone className="size-5" />,
            href: '/campaigns',
            count: null,
        },
        {
            title: 'Image Studio',
            description: 'Generate and brand images with AI',
            icon: <Sparkles className="size-5" />,
            href: '/image-studio',
            count: null,
        },
        {
            title: 'Brand Studio',
            description: 'Brand identity, voice, and visual assets',
            icon: <Database className="size-5" />,
            href: '/brand-studio',
            count: null,
        },
    ]

    const configureSections: SectionItem[] = [
        {
            title: 'Brand Settings',
            description: 'Brand profile and tone configuration',
            icon: <Mic2 className="size-5" />,
            href: '/brand',
            count: null,
        },
        {
            title: 'Prompts',
            description: 'AI prompt templates for content generation',
            icon: <BrainCircuit className="size-5" />,
            href: '/prompts',
            count: null,
        },
        {
            title: 'HubSpot',
            description: 'Connect social media accounts via HubSpot',
            icon: <Link2 className="size-5" />,
            href: '/hubspot',
            count: null,
        },
    ]

    return (
        <div className="max-w-5xl mx-auto p-8 space-y-8">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-[var(--color-gray-900)]">Content Studio</h1>
                <p className="text-[var(--color-gray-500)] mt-1">
                    Create and manage marketing content
                </p>
            </div>

            {/* Create */}
            <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-gray-400)] mb-3">
                    Create
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {createSections.map((section) => (
                        <SectionCard key={section.href} section={section} />
                    ))}
                </div>
            </div>

            {/* Configure */}
            <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-gray-400)] mb-3">
                    Configure
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {configureSections.map((section) => (
                        <SectionCard key={section.href} section={section} />
                    ))}
                </div>
            </div>

            {/* Recent Assets */}
            {assets.length > 0 && (
                <div className="bg-white rounded-xl border border-[var(--color-gray-200)]">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-gray-200)]">
                        <h2 className="text-sm font-medium text-[var(--color-gray-700)]">Recent Assets</h2>
                        <Link
                            to="/image-studio"
                            className="text-xs text-[var(--color-primary)] hover:underline"
                        >
                            View all &rarr;
                        </Link>
                    </div>
                    <div className="p-4 grid grid-cols-3 sm:grid-cols-6 gap-3">
                        {assets.map((asset) => (
                            <div
                                key={asset.id}
                                className="aspect-square rounded-lg bg-[var(--color-gray-100)] overflow-hidden"
                            >
                                {asset.public_url ? (
                                    <img
                                        src={asset.public_url}
                                        alt=""
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-[var(--color-gray-300)]">
                                        <Image className="size-6" />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

function SectionCard({ section }: { section: SectionItem }) {
    return (
        <Link
            to={section.href}
            className="bg-white rounded-xl border border-[var(--color-gray-200)] p-5 hover:border-[var(--color-primary)]/30 transition-colors group"
        >
            <div className="p-2 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)] w-fit mb-3">
                {section.icon}
            </div>
            <h3 className="text-sm font-medium text-[var(--color-gray-900)] mb-0.5">
                {section.title}
                {section.count !== null && (
                    <span className="ml-2 text-[var(--color-gray-400)]">({section.count})</span>
                )}
            </h3>
            <p className="text-xs text-[var(--color-gray-400)] mb-3">{section.description}</p>
            <span className="flex items-center gap-1 text-xs text-[var(--color-primary)] group-hover:gap-2 transition-all">
                Open <ArrowRight className="size-3" />
            </span>
        </Link>
    )
}
