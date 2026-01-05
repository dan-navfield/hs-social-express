import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button, Input } from '@/components/ui'
import { FileText, Mail, Lock, LogIn } from 'lucide-react'

type AuthMode = 'signin' | 'magiclink'

export function Login() {
    const navigate = useNavigate()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [authMode, setAuthMode] = useState<AuthMode>('signin')
    const [isLoading, setIsLoading] = useState(false)
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

    useEffect(() => {
        // Check if already logged in
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) {
                navigate('/')
            }
        })
    }, [navigate])

    const handleEmailPasswordLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)
        setMessage(null)

        try {
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            })

            if (error) throw error

            navigate('/')
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Invalid email or password'
            setMessage({
                type: 'error',
                text: errorMessage,
            })
        } finally {
            setIsLoading(false)
        }
    }

    const handleMagicLinkLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setIsLoading(true)
        setMessage(null)

        try {
            const { error } = await supabase.auth.signInWithOtp({
                email,
                options: {
                    emailRedirectTo: window.location.origin,
                },
            })

            if (error) throw error

            setMessage({
                type: 'success',
                text: 'Check your email for the magic link!',
            })
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'An error occurred'
            setMessage({
                type: 'error',
                text: errorMessage,
            })
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-secondary)] p-4">
            <div className="w-full max-w-md">
                <div className="bg-white rounded-2xl shadow-2xl p-8">
                    {/* Logo */}
                    <div className="flex items-center justify-center gap-3 mb-8">
                        <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center">
                            <FileText className="w-7 h-7 text-white" />
                        </div>
                        <span className="font-bold text-2xl text-[var(--color-gray-900)]">
                            SocialExpress
                        </span>
                    </div>

                    <h1 className="text-xl font-semibold text-center text-[var(--color-gray-900)] mb-2">
                        Welcome back
                    </h1>
                    <p className="text-center text-[var(--color-gray-500)] mb-6">
                        Sign in to your account to continue
                    </p>

                    {/* Auth Mode Tabs */}
                    <div className="flex mb-6 border-b border-[var(--color-gray-200)]">
                        <button
                            onClick={() => setAuthMode('signin')}
                            className={`flex-1 pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${authMode === 'signin'
                                    ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                                    : 'border-transparent text-[var(--color-gray-500)]'
                                }`}
                        >
                            Email & Password
                        </button>
                        <button
                            onClick={() => setAuthMode('magiclink')}
                            className={`flex-1 pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${authMode === 'magiclink'
                                    ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                                    : 'border-transparent text-[var(--color-gray-500)]'
                                }`}
                        >
                            Magic Link
                        </button>
                    </div>

                    {authMode === 'signin' ? (
                        <form onSubmit={handleEmailPasswordLogin} className="space-y-4">
                            <Input
                                type="email"
                                label="Email address"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />

                            <Input
                                type="password"
                                label="Password"
                                placeholder="••••••••"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />

                            <Button
                                type="submit"
                                isLoading={isLoading}
                                className="w-full"
                            >
                                <LogIn className="w-4 h-4" />
                                Sign In
                            </Button>
                        </form>
                    ) : (
                        <form onSubmit={handleMagicLinkLogin} className="space-y-4">
                            <Input
                                type="email"
                                label="Email address"
                                placeholder="you@example.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                            />

                            <Button
                                type="submit"
                                isLoading={isLoading}
                                className="w-full"
                            >
                                <Mail className="w-4 h-4" />
                                Send Magic Link
                            </Button>
                        </form>
                    )}

                    {message && (
                        <div
                            className={`mt-4 p-4 rounded-lg text-sm ${message.type === 'success'
                                    ? 'bg-green-50 text-green-800'
                                    : 'bg-red-50 text-red-800'
                                }`}
                        >
                            {message.text}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
