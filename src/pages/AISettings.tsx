// src/pages/AISettings.tsx
import { useState, useEffect } from 'react'
import { Check, AlertCircle, Brain, Image, Key } from 'lucide-react'
import { Button } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useSpaceStore } from '@/stores/spaceStore'

const TEXT_MODELS: Record<string, { label: string; models: { value: string; label: string }[] }> = {
    openai: {
        label: 'OpenAI',
        models: [
            { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
            { value: 'gpt-4o', label: 'GPT-4o' },
            { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
        ],
    },
    claude: {
        label: 'Claude',
        models: [
            { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
            { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
            { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
        ],
    },
}

const IMAGE_MODELS = [
    { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash (Image)' },
    { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash Exp' },
    { value: 'gemini-2.5-pro-image', label: 'Gemini 2.5 Pro (Image)' },
]

const IMAGE_PROMPT_MODELS = [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash Exp' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
]

interface AISettingsData {
    text_provider: string
    text_model: string
    image_model: string
    image_prompt_model: string
}

const DEFAULTS: AISettingsData = {
    text_provider: 'openai',
    text_model: 'gpt-4o-mini',
    image_model: 'gemini-2.5-flash-image',
    image_prompt_model: 'gemini-2.0-flash-exp',
}

export function AISettings() {
    const { currentSpace } = useSpaceStore()
    const [settings, setSettings] = useState<AISettingsData>(DEFAULTS)
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)

    useEffect(() => {
        if (currentSpace) loadSettings()
    }, [currentSpace])

    const loadSettings = async () => {
        if (!currentSpace) return
        setIsLoading(true)
        try {
            const { data } = await supabase
                .from('ai_settings')
                .select('*')
                .eq('space_id', currentSpace.id)
                .single()

            if (data) {
                setSettings({
                    text_provider: data.text_provider,
                    text_model: data.text_model,
                    image_model: data.image_model,
                    image_prompt_model: data.image_prompt_model,
                })
            }
        } catch {
            // No settings yet, use defaults
        }
        setIsLoading(false)
    }

    const handleProviderChange = (provider: string) => {
        const firstModel = TEXT_MODELS[provider].models[0].value
        setSettings(prev => ({ ...prev, text_provider: provider, text_model: firstModel }))
    }

    const handleSave = async () => {
        if (!currentSpace) return
        setIsSaving(true)
        setError(null)
        setSuccess(null)

        try {
            const { data: existing } = await supabase
                .from('ai_settings')
                .select('id')
                .eq('space_id', currentSpace.id)
                .single()

            let saveError
            if (existing) {
                const { error } = await supabase
                    .from('ai_settings')
                    .update({
                        ...settings,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('space_id', currentSpace.id)
                saveError = error
            } else {
                const { error } = await supabase
                    .from('ai_settings')
                    .insert({
                        space_id: currentSpace.id,
                        ...settings,
                    })
                saveError = error
            }

            if (saveError) throw saveError
            setSuccess('AI settings saved successfully')
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save settings')
        }
        setIsSaving(false)
    }

    const requiredKeys = () => {
        const keys: string[] = []
        if (settings.text_provider === 'openai') keys.push('OPENAI_API_KEY')
        if (settings.text_provider === 'claude') keys.push('ANTHROPIC_API_KEY')
        keys.push('GEMINI_API_KEY')
        return [...new Set(keys)]
    }

    if (isLoading) {
        return <div className="p-8 text-center text-[var(--color-gray-400)]">Loading...</div>
    }

    return (
        <div className="max-w-2xl mx-auto p-8">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-[var(--color-gray-900)]">AI Settings</h1>
                <p className="text-[var(--color-gray-500)] mt-1">
                    Configure the AI models used for text and image generation in this workspace.
                </p>
            </div>

            {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-red-700">{error}</p>
                </div>
            )}

            {success && (
                <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
                    <Check className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
                    <p className="text-sm text-green-700">{success}</p>
                </div>
            )}

            {/* Text Generation Card */}
            <div className="bg-white border border-[var(--color-gray-200)] rounded-xl p-6 mb-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Brain className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                        <h2 className="font-semibold text-[var(--color-gray-900)]">Text Generation</h2>
                        <p className="text-xs text-[var(--color-gray-500)]">Model used for generating post copy</p>
                    </div>
                </div>

                <label className="block text-sm font-medium text-[var(--color-gray-700)] mb-2">Provider</label>
                <div className="flex gap-2 mb-4">
                    {Object.entries(TEXT_MODELS).map(([key, { label }]) => (
                        <button
                            key={key}
                            onClick={() => handleProviderChange(key)}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                settings.text_provider === key
                                    ? 'bg-[var(--color-primary)] text-white'
                                    : 'bg-[var(--color-gray-100)] text-[var(--color-gray-600)] hover:bg-[var(--color-gray-200)]'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                <label className="block text-sm font-medium text-[var(--color-gray-700)] mb-2">Model</label>
                <select
                    value={settings.text_model}
                    onChange={(e) => setSettings(prev => ({ ...prev, text_model: e.target.value }))}
                    className="w-full px-3 py-2 border border-[var(--color-gray-300)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                >
                    {TEXT_MODELS[settings.text_provider].models.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                </select>
            </div>

            {/* Image Generation Card */}
            <div className="bg-white border border-[var(--color-gray-200)] rounded-xl p-6 mb-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                        <Image className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                        <h2 className="font-semibold text-[var(--color-gray-900)]">Image Generation</h2>
                        <p className="text-xs text-[var(--color-gray-500)]">Models used for creating post images</p>
                    </div>
                </div>

                <label className="block text-sm font-medium text-[var(--color-gray-700)] mb-2">Image Model</label>
                <select
                    value={settings.image_model}
                    onChange={(e) => setSettings(prev => ({ ...prev, image_model: e.target.value }))}
                    className="w-full px-3 py-2 border border-[var(--color-gray-300)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)] mb-4"
                >
                    {IMAGE_MODELS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                </select>

                <label className="block text-sm font-medium text-[var(--color-gray-700)] mb-2">Image Prompt Model</label>
                <select
                    value={settings.image_prompt_model}
                    onChange={(e) => setSettings(prev => ({ ...prev, image_prompt_model: e.target.value }))}
                    className="w-full px-3 py-2 border border-[var(--color-gray-300)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 focus:border-[var(--color-primary)]"
                >
                    {IMAGE_PROMPT_MODELS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                </select>
            </div>

            {/* API Keys Card */}
            <div className="bg-white border border-[var(--color-gray-200)] rounded-xl p-6 mb-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                        <Key className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                        <h2 className="font-semibold text-[var(--color-gray-900)]">API Keys Required</h2>
                        <p className="text-xs text-[var(--color-gray-500)]">Based on your current model selections</p>
                    </div>
                </div>

                <div className="space-y-2 mb-4">
                    {requiredKeys().map((key) => (
                        <div
                            key={key}
                            className="flex items-center gap-2 px-3 py-2 bg-[var(--color-gray-50)] rounded-lg"
                        >
                            <code className="text-sm font-mono text-[var(--color-gray-700)]">{key}</code>
                        </div>
                    ))}
                </div>

                <p className="text-xs text-[var(--color-gray-500)]">
                    API keys are configured as server secrets — contact admin to update.
                </p>
            </div>

            {/* Save Button */}
            <div className="flex justify-end">
                <Button onClick={handleSave} disabled={isSaving}>
                    {isSaving ? 'Saving...' : 'Save Settings'}
                </Button>
            </div>
        </div>
    )
}
