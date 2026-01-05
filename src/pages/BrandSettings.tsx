import { useState } from 'react'
import { Upload, Trash2, Plus, Save } from 'lucide-react'
import { Button, Input } from '@/components/ui'

export function BrandSettings() {
    const [logos, setLogos] = useState<{ id: string; label: string; url: string }[]>([])

    return (
        <div className="p-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-[var(--color-gray-900)]">Brand Settings</h1>
                    <p className="text-[var(--color-gray-500)]">
                        Configure your logos and branding rules for image composition
                    </p>
                </div>
                <Button>
                    <Save className="w-4 h-4" />
                    Save Changes
                </Button>
            </div>

            <div className="grid grid-cols-2 gap-6">
                {/* Logo Assets */}
                <div className="bg-white rounded-xl shadow-sm border border-[var(--color-gray-200)] p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-[var(--color-gray-900)]">
                            Logo Assets
                        </h2>
                        <Button variant="secondary" size="sm">
                            <Plus className="w-4 h-4" />
                            Add Logo
                        </Button>
                    </div>

                    {logos.length === 0 ? (
                        <div className="border-2 border-dashed border-[var(--color-gray-300)] rounded-lg p-8 text-center">
                            <Upload className="w-10 h-10 text-[var(--color-gray-400)] mx-auto mb-3" />
                            <p className="text-[var(--color-gray-500)] mb-2">
                                Upload your logo PNG files
                            </p>
                            <p className="text-sm text-[var(--color-gray-400)]">
                                Recommended: Transparent PNG, at least 200x200px
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-4">
                            {logos.map((logo) => (
                                <div
                                    key={logo.id}
                                    className="relative border border-[var(--color-gray-200)] rounded-lg p-4"
                                >
                                    <img
                                        src={logo.url}
                                        alt={logo.label}
                                        className="w-full h-24 object-contain"
                                    />
                                    <p className="text-sm text-center mt-2 text-[var(--color-gray-700)]">
                                        {logo.label}
                                    </p>
                                    <button className="absolute top-2 right-2 p-1 text-[var(--color-gray-400)] hover:text-[var(--color-error)]">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Placement Rules */}
                <div className="bg-white rounded-xl shadow-sm border border-[var(--color-gray-200)] p-6">
                    <h2 className="text-lg font-semibold text-[var(--color-gray-900)] mb-4">
                        Placement Rules
                    </h2>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-[var(--color-gray-700)] mb-2">
                                Logo Position
                            </label>
                            <select className="w-full px-3 py-2 rounded-lg border border-[var(--color-gray-300)] focus:ring-2 focus:ring-[var(--color-primary)]">
                                <option value="top-left">Top Left</option>
                                <option value="top-right">Top Right</option>
                                <option value="bottom-left">Bottom Left</option>
                                <option value="bottom-right">Bottom Right</option>
                            </select>
                        </div>

                        <Input
                            label="Padding (pixels)"
                            type="number"
                            defaultValue="20"
                        />

                        <Input
                            label="Max Logo Width (%)"
                            type="number"
                            defaultValue="15"
                        />

                        <div>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="rounded border-[var(--color-gray-300)] text-[var(--color-primary)]"
                                />
                                <span className="text-sm text-[var(--color-gray-700)]">
                                    Add contrast scrim behind logo
                                </span>
                            </label>
                        </div>

                        <Input
                            label="Scrim Opacity (%)"
                            type="number"
                            defaultValue="30"
                        />
                    </div>
                </div>
            </div>
        </div>
    )
}
