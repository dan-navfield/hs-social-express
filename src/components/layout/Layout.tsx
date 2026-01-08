import { useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
    LayoutDashboard,
    FileText,
    Megaphone,
    Database,
    ChevronLeft,
    ChevronRight,
    LogOut,
    Binoculars,
} from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { useSpaceStore } from '@/stores/spaceStore'
import { supabase } from '@/lib/supabase'

interface LayoutProps {
    children: ReactNode
}

const navItems = [
    { path: '/', icon: LayoutDashboard, label: 'Dashboard', isGlobal: true },
    { path: '/buyict', icon: Binoculars, label: 'BuyICT Snoop', isGlobal: true },
    { path: '/brand-studio', icon: Database, label: 'Brand Studio', isGlobal: false },
    { path: '/campaigns', icon: Megaphone, label: 'Campaigns', isGlobal: false },
    { path: '/posts', icon: FileText, label: 'All Posts', isGlobal: false },
]


export function Layout({ children }: LayoutProps) {
    const location = useLocation()
    const { user } = useAuthStore()
    const { currentSpace, spaces } = useSpaceStore()
    const [collapsed, setCollapsed] = useState(false)

    const handleSignOut = async () => {
        await supabase.auth.signOut()
    }

    return (
        <div className="min-h-screen flex bg-[var(--color-gray-50)]">
            {/* Sidebar */}
            <aside
                className={`
          fixed left-0 top-0 h-full bg-white border-r border-[var(--color-gray-200)]
          transition-all duration-300 z-40
          ${collapsed ? 'w-16' : 'w-64'}
        `}
            >
                {/* Logo */}
                <div className="h-16 flex items-center justify-between px-4 border-b border-[var(--color-gray-200)]">
                    {!collapsed && (
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
                                <FileText className="w-5 h-5 text-white" />
                            </div>
                            <span className="font-bold text-lg text-[var(--color-gray-900)]">
                                SocialExpress
                            </span>
                        </div>
                    )}
                    <button
                        onClick={() => setCollapsed(!collapsed)}
                        className="p-2 rounded-lg hover:bg-[var(--color-gray-100)] text-[var(--color-gray-500)]"
                    >
                        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                    </button>
                </div>

                {/* Space Selector */}
                {!collapsed && currentSpace && (
                    <div className="p-4 border-b border-[var(--color-gray-200)]">
                        <label className="block text-xs font-medium text-[var(--color-gray-500)] mb-1">
                            Workspace
                        </label>
                        <select
                            value={currentSpace.id}
                            onChange={(e) => {
                                const selectedSpace = spaces.find(s => s.id === e.target.value)
                                if (selectedSpace) {
                                    useSpaceStore.getState().setCurrentSpace(selectedSpace)
                                }
                            }}
                            className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--color-gray-300)] focus:ring-2 focus:ring-[var(--color-primary)]"
                        >
                            {spaces.map((space) => (
                                <option key={space.id} value={space.id}>
                                    {space.name}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Navigation */}
                <nav className="p-2 flex-1">
                    {/* Global items first */}
                    {navItems.filter(item => item.isGlobal).map((item) => {
                        const isActive = location.pathname === item.path
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1
                  transition-colors duration-200
                  ${isActive
                                        ? 'bg-[var(--color-gray-100)] text-[var(--color-gray-900)] font-medium'
                                        : 'text-[var(--color-gray-600)] hover:bg-[var(--color-gray-50)]'
                                    }
                `}
                            >
                                <item.icon className={`w-5 h-5 ${collapsed ? 'mx-auto' : ''}`} />
                                {!collapsed && <span>{item.label}</span>}
                            </Link>
                        )
                    })}

                    {/* Workspace section divider */}
                    {!collapsed && currentSpace && (
                        <div className="mt-4 mb-2 px-3">
                            <span className="text-xs font-medium text-[var(--color-gray-400)] uppercase tracking-wider">
                                {currentSpace.name}
                            </span>
                        </div>
                    )}
                    {collapsed && <div className="my-2 mx-2 border-t border-[var(--color-gray-200)]" />}

                    {/* Workspace-specific items */}
                    {navItems.filter(item => !item.isGlobal).map((item) => {
                        const isActive = location.pathname === item.path
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1
                  transition-colors duration-200
                  ${isActive
                                        ? 'bg-[var(--color-gray-100)] text-[var(--color-gray-900)] font-medium'
                                        : 'text-[var(--color-gray-600)] hover:bg-[var(--color-gray-50)]'
                                    }
                `}
                            >
                                <item.icon className={`w-5 h-5 ${collapsed ? 'mx-auto' : ''}`} />
                                {!collapsed && <span>{item.label}</span>}
                            </Link>
                        )
                    })}
                </nav>

                {/* User section */}
                <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-[var(--color-gray-200)]">
                    {!collapsed && user && (
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-8 h-8 rounded-full bg-[var(--color-primary)] flex items-center justify-center text-white text-sm font-medium">
                                {user.email?.[0]?.toUpperCase() || 'U'}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-[var(--color-gray-900)] truncate">
                                    {user.email}
                                </p>
                            </div>
                        </div>
                    )}
                    <button
                        onClick={handleSignOut}
                        className={`
              flex items-center gap-3 w-full px-3 py-2 rounded-lg
              text-[var(--color-gray-600)] hover:bg-[var(--color-gray-100)]
              transition-colors
            `}
                    >
                        <LogOut className={`w-5 h-5 ${collapsed ? 'mx-auto' : ''}`} />
                        {!collapsed && <span>Sign Out</span>}
                    </button>
                </div>
            </aside>

            {/* Main content */}
            <main
                className={`
          flex-1 min-h-screen transition-all duration-300
          ${collapsed ? 'ml-16' : 'ml-64'}
        `}
            >
                {children}
            </main>
        </div>
    )
}
