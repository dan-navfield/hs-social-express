import { forwardRef, type TextareaHTMLAttributes } from 'react'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    label?: string
    error?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ label, error, className = '', id, ...props }, ref) => {
        const textareaId = id || label?.toLowerCase().replace(/\s+/g, '-')

        return (
            <div className="w-full">
                {label && (
                    <label
                        htmlFor={textareaId}
                        className="block text-sm font-medium text-[var(--color-gray-700)] mb-1"
                    >
                        {label}
                    </label>
                )}
                <textarea
                    ref={ref}
                    id={textareaId}
                    className={`
            w-full px-3 py-2 rounded-lg border
            text-[var(--color-gray-900)] placeholder-[var(--color-gray-400)]
            transition-colors duration-200 resize-y min-h-[100px]
            focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent
            ${error
                            ? 'border-[var(--color-error)] focus:ring-[var(--color-error)]'
                            : 'border-[var(--color-gray-300)]'
                        }
            ${className}
          `}
                    {...props}
                />
                {error && (
                    <p className="mt-1 text-sm text-[var(--color-error)]">{error}</p>
                )}
            </div>
        )
    }
)

Textarea.displayName = 'Textarea'
