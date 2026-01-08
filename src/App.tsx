import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { useSpaceStore } from '@/stores/spaceStore'
import { Layout } from '@/components/layout'
import { Dashboard, Login, Posts, PromptStudio, BrandSettings, BrandStudio, Campaigns } from '@/pages'
import { CampaignSettings } from '@/pages/CampaignSettings'
import {
  BuyICTDashboard,
  Opportunities as BuyICTOpportunities,
  Contacts as BuyICTContacts,
  DepartmentMappings as BuyICTDepartmentMappings,
  Settings as BuyICTSettings
} from '@/pages/buyict'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-gray-50)]">
        <div className="flex items-center gap-3 text-[var(--color-gray-500)]">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Loading...</span>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <Layout>{children}</Layout>
}

export default function App() {
  const { setUser, setSession, setIsLoading } = useAuthStore()
  const { setCurrentSpace, setSpaces } = useSpaceStore()
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    let mounted = true

    const initializeAuth = async () => {
      try {
        // Get initial session
        const { data: { session } } = await supabase.auth.getSession()

        if (!mounted) return

        if (session?.user) {
          setSession(session)
          setUser(session.user)

          // Try to fetch user's spaces
          try {
            const { data: memberships } = await supabase
              .from('space_members')
              .select('space_id, role, spaces(*)')
              .eq('user_id', session.user.id)

            if (memberships && memberships.length > 0) {
              const spaces = memberships.map((m: any) => m.spaces).filter(Boolean)
              if (spaces.length > 0) {
                setSpaces(spaces)
                setCurrentSpace(spaces[0])
              }
            } else {
              // Create a default space for the user
              const { data: newSpace } = await supabase
                .from('spaces')
                .insert({
                  name: 'My Workspace',
                  created_by: session.user.id
                })
                .select()
                .single()

              if (newSpace) {
                await supabase.from('space_members').insert({
                  space_id: newSpace.id,
                  user_id: session.user.id,
                  role: 'owner',
                })

                setSpaces([newSpace])
                setCurrentSpace(newSpace)
              }
            }
          } catch (spaceError) {
            console.error('Error setting up spaces:', spaceError)
            // Continue anyway - user is still logged in
          }
        } else {
          setSession(null)
          setUser(null)
        }
      } catch (error) {
        console.error('Auth initialization error:', error)
      } finally {
        if (mounted) {
          setIsLoading(false)
          setInitialized(true)
        }
      }
    }

    initializeAuth()

    // Set up auth listener for changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return

        setSession(session)
        setUser(session?.user ?? null)

        if (event === 'SIGNED_OUT') {
          setSpaces([])
          setCurrentSpace(null)
        }
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [setUser, setSession, setIsLoading, setSpaces, setCurrentSpace])

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-gray-50)]">
        <div className="flex items-center gap-3 text-[var(--color-gray-500)]">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Initializing...</span>
        </div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/campaigns" element={<ProtectedRoute><Campaigns /></ProtectedRoute>} />
        <Route path="/campaign/:id" element={<ProtectedRoute><CampaignSettings /></ProtectedRoute>} />
        <Route path="/posts" element={<ProtectedRoute><Posts /></ProtectedRoute>} />
        <Route path="/prompts" element={<ProtectedRoute><PromptStudio /></ProtectedRoute>} />
        <Route path="/brand-studio" element={<ProtectedRoute><BrandStudio /></ProtectedRoute>} />
        <Route path="/brand" element={<ProtectedRoute><BrandSettings /></ProtectedRoute>} />

        {/* BuyICT Snoop Routes */}
        <Route path="/buyict" element={<ProtectedRoute><BuyICTDashboard /></ProtectedRoute>} />
        <Route path="/buyict/opportunities" element={<ProtectedRoute><BuyICTOpportunities /></ProtectedRoute>} />
        <Route path="/buyict/contacts" element={<ProtectedRoute><BuyICTContacts /></ProtectedRoute>} />
        <Route path="/buyict/departments" element={<ProtectedRoute><BuyICTDepartmentMappings /></ProtectedRoute>} />
        <Route path="/buyict/settings" element={<ProtectedRoute><BuyICTSettings /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  )
}
