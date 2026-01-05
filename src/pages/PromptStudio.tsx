import { useState, useEffect, useCallback } from 'react'
import { Plus, Save, Check, Wand2, Image as ImageIcon } from 'lucide-react'
import { Button, Input, Textarea, Modal } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useSpaceStore } from '@/stores/spaceStore'
import { useAuthStore } from '@/stores/authStore'
import type { Database, PromptType } from '@/types/database'

type PromptTemplate = Database['public']['Tables']['prompt_templates']['Row']

export function PromptStudio() {
    const { currentSpace } = useSpaceStore()
    const { user } = useAuthStore()
    const [templates, setTemplates] = useState<PromptTemplate[]>([])
    const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [showNewModal, setShowNewModal] = useState(false)

    // Editing state
    const [editName, setEditName] = useState('')
    const [editTemplate, setEditTemplate] = useState('')
    const [editType, setEditType] = useState<PromptType>('linkedin_text')

    const fetchTemplates = useCallback(async () => {
        if (!currentSpace) return

        setIsLoading(true)
        try {
            const { data, error } = await supabase
                .from('prompt_templates')
                .select('*')
                .eq('space_id', currentSpace.id)
                .order('created_at', { ascending: false })

            if (error) throw error
            setTemplates(data || [])

            // Select first template if available
            if (data && data.length > 0 && !selectedTemplate) {
                selectTemplate(data[0])
            }
        } catch (error) {
            console.error('Error fetching templates:', error)
        } finally {
            setIsLoading(false)
        }
    }, [currentSpace])

    useEffect(() => {
        fetchTemplates()
    }, [fetchTemplates])

    const selectTemplate = (template: PromptTemplate) => {
        setSelectedTemplate(template)
        setEditName(template.name)
        setEditTemplate(template.template)
        setEditType(template.type)
    }

    const handleSave = async () => {
        if (!selectedTemplate || !currentSpace) return

        setIsSaving(true)
        try {
            const { error } = await supabase
                .from('prompt_templates')
                .update({
                    name: editName,
                    template: editTemplate,
                    version: selectedTemplate.version + 1,
                })
                .eq('id', selectedTemplate.id)

            if (error) throw error
            await fetchTemplates()
        } catch (error) {
            console.error('Error saving template:', error)
        } finally {
            setIsSaving(false)
        }
    }

    const handleSetActive = async (templateId: string) => {
        if (!currentSpace) return

        try {
            // Find the template type
            const template = templates.find(t => t.id === templateId)
            if (!template) return

            // Deactivate all templates of the same type
            await supabase
                .from('prompt_templates')
                .update({ is_active: false })
                .eq('space_id', currentSpace.id)
                .eq('type', template.type)

            // Activate the selected template
            const { error } = await supabase
                .from('prompt_templates')
                .update({ is_active: true })
                .eq('id', templateId)

            if (error) throw error
            await fetchTemplates()
        } catch (error) {
            console.error('Error setting active template:', error)
        }
    }

    const handleCreate = async (name: string, type: PromptType) => {
        if (!currentSpace || !user) return

        try {
            const defaultTemplate = type === 'linkedin_text'
                ? `Write a LinkedIn post about {topic}.

Target audience: {audience}
Tone: {tone_notes}
Additional constraints: {constraints}

The post should be engaging, professional, and include a call to action.`
                : `Create a professional image for a LinkedIn post about {topic}.

Style: Modern, clean, corporate
Colors: Professional blues and whites
Include: Relevant iconography and subtle branding elements`

            const { error } = await supabase
                .from('prompt_templates')
                .insert({
                    space_id: currentSpace.id,
                    name,
                    type,
                    template: defaultTemplate,
                    created_by: user.id,
                    is_active: false,
                    version: 1,
                })

            if (error) throw error
            await fetchTemplates()
            setShowNewModal(false)
        } catch (error) {
            console.error('Error creating template:', error)
        }
    }

    const textTemplates = templates.filter(t => t.type === 'linkedin_text')
    const imageTemplates = templates.filter(t => t.type === 'image_prompt')

    return (
        <div className="p-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--color-gray-900)]">Prompt Studio</h1>
                    <p className="text-[var(--color-gray-500)]">
                        Create and manage your LinkedIn post prompts and image generation templates
                    </p>
                </div>
                <Button onClick={() => setShowNewModal(true)}>
                    <Plus className="w-4 h-4" />
                    New Template
                </Button>
            </div>

            <div className="grid grid-cols-12 gap-6">
                {/* Template List */}
                <div className="col-span-4">
                    <div className="bg-white rounded-xl shadow-sm border border-[var(--color-gray-200)] overflow-hidden">
                        {/* LinkedIn Text Templates */}
                        <div className="border-b border-[var(--color-gray-200)]">
                            <div className="px-4 py-3 bg-[var(--color-gray-50)] flex items-center gap-2">
                                <Wand2 className="w-4 h-4 text-[var(--color-primary)]" />
                                <span className="font-medium text-sm">LinkedIn Text Prompts</span>
                            </div>
                            {textTemplates.length === 0 ? (
                                <div className="px-4 py-8 text-center text-[var(--color-gray-500)] text-sm">
                                    No text templates yet
                                </div>
                            ) : (
                                <div className="divide-y divide-[var(--color-gray-100)]">
                                    {textTemplates.map((template) => (
                                        <TemplateListItem
                                            key={template.id}
                                            template={template}
                                            isSelected={selectedTemplate?.id === template.id}
                                            onSelect={() => selectTemplate(template)}
                                            onSetActive={() => handleSetActive(template.id)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Image Templates */}
                        <div>
                            <div className="px-4 py-3 bg-[var(--color-gray-50)] flex items-center gap-2">
                                <ImageIcon className="w-4 h-4 text-[var(--color-secondary)]" />
                                <span className="font-medium text-sm">Image Prompts</span>
                            </div>
                            {imageTemplates.length === 0 ? (
                                <div className="px-4 py-8 text-center text-[var(--color-gray-500)] text-sm">
                                    No image templates yet
                                </div>
                            ) : (
                                <div className="divide-y divide-[var(--color-gray-100)]">
                                    {imageTemplates.map((template) => (
                                        <TemplateListItem
                                            key={template.id}
                                            template={template}
                                            isSelected={selectedTemplate?.id === template.id}
                                            onSelect={() => selectTemplate(template)}
                                            onSetActive={() => handleSetActive(template.id)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Template Editor */}
                <div className="col-span-8">
                    {selectedTemplate ? (
                        <div className="bg-white rounded-xl shadow-sm border border-[var(--color-gray-200)] p-6">
                            <div className="flex items-center justify-between mb-6">
                                <div>
                                    <h2 className="text-lg font-semibold text-[var(--color-gray-900)]">
                                        Edit Template
                                    </h2>
                                    <p className="text-sm text-[var(--color-gray-500)]">
                                        Version {selectedTemplate.version}
                                    </p>
                                </div>
                                <Button onClick={handleSave} isLoading={isSaving}>
                                    <Save className="w-4 h-4" />
                                    Save Changes
                                </Button>
                            </div>

                            <div className="space-y-4">
                                <Input
                                    label="Template Name"
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                />

                                <Textarea
                                    label="Prompt Template"
                                    value={editTemplate}
                                    onChange={(e) => setEditTemplate(e.target.value)}
                                    className="min-h-[300px] font-mono text-sm"
                                />

                                <div className="bg-[var(--color-gray-50)] rounded-lg p-4">
                                    <h3 className="font-medium text-sm text-[var(--color-gray-700)] mb-2">
                                        Available Variables
                                    </h3>
                                    <div className="flex flex-wrap gap-2">
                                        {['{topic}', '{audience}', '{tone_notes}', '{constraints}', '{post_body}'].map((v) => (
                                            <code
                                                key={v}
                                                className="px-2 py-1 bg-white rounded text-xs text-[var(--color-primary)] border border-[var(--color-gray-200)]"
                                            >
                                                {v}
                                            </code>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-white rounded-xl shadow-sm border border-[var(--color-gray-200)] p-8 text-center">
                            <Wand2 className="w-12 h-12 text-[var(--color-gray-300)] mx-auto mb-4" />
                            <p className="text-[var(--color-gray-500)]">
                                {isLoading ? 'Loading templates...' : 'Select a template to edit or create a new one'}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* New Template Modal */}
            <Modal
                isOpen={showNewModal}
                onClose={() => setShowNewModal(false)}
                title="Create New Template"
            >
                <NewTemplateForm
                    onCreate={handleCreate}
                    onClose={() => setShowNewModal(false)}
                />
            </Modal>
        </div>
    )
}

function TemplateListItem({
    template,
    isSelected,
    onSelect,
    onSetActive,
}: {
    template: PromptTemplate
    isSelected: boolean
    onSelect: () => void
    onSetActive: () => void
}) {
    return (
        <button
            onClick={onSelect}
            className={`
        w-full px-4 py-3 text-left hover:bg-[var(--color-gray-50)] transition-colors
        ${isSelected ? 'bg-blue-50' : ''}
      `}
        >
            <div className="flex items-center justify-between">
                <div>
                    <p className="font-medium text-sm text-[var(--color-gray-900)]">
                        {template.name}
                    </p>
                    <p className="text-xs text-[var(--color-gray-500)]">
                        v{template.version}
                    </p>
                </div>
                {template.is_active ? (
                    <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full font-medium">
                        Active
                    </span>
                ) : (
                    <button
                        onClick={(e) => {
                            e.stopPropagation()
                            onSetActive()
                        }}
                        className="px-2 py-1 text-xs text-[var(--color-gray-500)] hover:text-[var(--color-primary)]"
                    >
                        Set Active
                    </button>
                )}
            </div>
        </button>
    )
}

function NewTemplateForm({
    onCreate,
    onClose,
}: {
    onCreate: (name: string, type: PromptType) => void
    onClose: () => void
}) {
    const [name, setName] = useState('')
    const [type, setType] = useState<PromptType>('linkedin_text')

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim()) return
        onCreate(name, type)
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <Input
                label="Template Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Professional LinkedIn Post"
                required
            />

            <div>
                <label className="block text-sm font-medium text-[var(--color-gray-700)] mb-2">
                    Template Type
                </label>
                <div className="flex gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="radio"
                            value="linkedin_text"
                            checked={type === 'linkedin_text'}
                            onChange={() => setType('linkedin_text')}
                            className="text-[var(--color-primary)]"
                        />
                        <span className="text-sm">LinkedIn Text</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="radio"
                            value="image_prompt"
                            checked={type === 'image_prompt'}
                            onChange={() => setType('image_prompt')}
                            className="text-[var(--color-primary)]"
                        />
                        <span className="text-sm">Image Prompt</span>
                    </label>
                </div>
            </div>

            <div className="flex justify-end gap-3 pt-4">
                <Button variant="secondary" type="button" onClick={onClose}>
                    Cancel
                </Button>
                <Button type="submit" disabled={!name.trim()}>
                    Create Template
                </Button>
            </div>
        </form>
    )
}
