import { type ReactNode } from 'react'

interface CheckboxProps {
    checked: boolean
    indeterminate?: boolean
    onChange: (checked: boolean) => void
    disabled?: boolean
    className?: string
}

export function Checkbox({
    checked,
    indeterminate,
    onChange,
    disabled,
    className = '',
}: CheckboxProps) {
    return (
        <input
            type="checkbox"
            checked={checked}
            ref={(el) => {
                if (el) el.indeterminate = indeterminate ?? false
            }}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className={`
        w-4 h-4 rounded border-[var(--color-gray-300)]
        text-[var(--color-primary)] focus:ring-[var(--color-primary)]
        cursor-pointer disabled:cursor-not-allowed disabled:opacity-50
        ${className}
      `}
        />
    )
}

interface TableColumn<T> {
    key: string
    header: string | ReactNode
    render: (row: T, index: number) => ReactNode
    className?: string
}

interface DataTableProps<T> {
    data: T[]
    columns: TableColumn<T>[]
    isLoading?: boolean
    emptyMessage?: string
    getRowId: (row: T) => string
    selectedIds?: Set<string>
    onSelectionChange?: (ids: Set<string>) => void
}

export function DataTable<T>({
    data,
    columns,
    isLoading,
    emptyMessage = 'No data found',
    getRowId,
    selectedIds,
    onSelectionChange,
}: DataTableProps<T>) {
    const hasSelection = selectedIds !== undefined && onSelectionChange !== undefined

    const allSelected = data.length > 0 && data.every((row) => selectedIds?.has(getRowId(row)))
    const someSelected = data.some((row) => selectedIds?.has(getRowId(row)))

    const toggleAll = () => {
        if (!onSelectionChange) return
        if (allSelected) {
            onSelectionChange(new Set())
        } else {
            onSelectionChange(new Set(data.map(getRowId)))
        }
    }

    const toggleRow = (id: string) => {
        if (!onSelectionChange || !selectedIds) return
        const next = new Set(selectedIds)
        if (next.has(id)) {
            next.delete(id)
        } else {
            next.add(id)
        }
        onSelectionChange(next)
    }

    if (isLoading) {
        return (
            <div className="bg-white rounded-xl shadow-sm border border-[var(--color-gray-200)] p-8">
                <div className="flex items-center justify-center gap-3 text-[var(--color-gray-500)]">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                            fill="none"
                        />
                        <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                    </svg>
                    <span>Loading...</span>
                </div>
            </div>
        )
    }

    return (
        <div className="bg-white rounded-xl shadow-sm border border-[var(--color-gray-200)] overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="bg-[var(--color-gray-50)] border-b border-[var(--color-gray-200)]">
                            {hasSelection && (
                                <th className="px-4 py-3 w-12">
                                    <Checkbox
                                        checked={allSelected}
                                        indeterminate={someSelected && !allSelected}
                                        onChange={toggleAll}
                                    />
                                </th>
                            )}
                            {columns.map((col) => (
                                <th
                                    key={col.key}
                                    className={`px-4 py-3 text-left text-xs font-medium text-[var(--color-gray-500)] uppercase tracking-wider ${col.className || ''}`}
                                >
                                    {col.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-gray-200)]">
                        {data.length === 0 ? (
                            <tr>
                                <td
                                    colSpan={columns.length + (hasSelection ? 1 : 0)}
                                    className="px-4 py-12 text-center text-[var(--color-gray-500)]"
                                >
                                    {emptyMessage}
                                </td>
                            </tr>
                        ) : (
                            data.map((row, index) => {
                                const id = getRowId(row)
                                const isSelected = selectedIds?.has(id)

                                return (
                                    <tr
                                        key={id}
                                        className={`
                      hover:bg-[var(--color-gray-50)] transition-colors
                      ${isSelected ? 'bg-blue-50' : ''}
                    `}
                                    >
                                        {hasSelection && (
                                            <td className="px-4 py-3">
                                                <Checkbox
                                                    checked={isSelected ?? false}
                                                    onChange={() => toggleRow(id)}
                                                />
                                            </td>
                                        )}
                                        {columns.map((col) => (
                                            <td
                                                key={col.key}
                                                className={`px-4 py-3 text-sm text-[var(--color-gray-900)] ${col.className || ''}`}
                                            >
                                                {col.render(row, index)}
                                            </td>
                                        ))}
                                    </tr>
                                )
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
