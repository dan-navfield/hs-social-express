import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import type {
  BuyICTIntegration,
  BuyICTOpportunity,
  BuyICTOpportunityWithDepartment,
  BuyICTContact,
  BuyICTContactWithProvenance,
  BuyICTDepartmentMapping,
  BuyICTSyncJob,
  BuyICTOpportunityFilters,
  BuyICTContactFilters,
} from '@/types/buyict'

interface BuyICTState {
  // Integration state
  integration: BuyICTIntegration | null
  isLoadingIntegration: boolean

  // Opportunities
  opportunities: BuyICTOpportunityWithDepartment[]
  opportunitiesLoading: boolean
  opportunityFilters: BuyICTOpportunityFilters
  selectedOpportunity: BuyICTOpportunityWithDepartment | null

  // Contacts
  contacts: BuyICTContactWithProvenance[]
  contactsLoading: boolean
  contactFilters: BuyICTContactFilters

  // Department mappings
  departmentMappings: BuyICTDepartmentMapping[]
  mappingsLoading: boolean
  unmappedBuyerEntities: string[]

  // Sync jobs
  latestSyncJob: BuyICTSyncJob | null
  syncJobs: BuyICTSyncJob[]
  isSyncing: boolean

  // Stats
  stats: {
    totalOpportunities: number
    openOpportunities: number
    totalContacts: number
    uniqueDepartments: number
    unmappedDepartments: number
    closingThisWeek: number
  }

  // Actions
  setIntegration: (integration: BuyICTIntegration | null) => void
  fetchIntegration: (spaceId: string) => Promise<void>
  createIntegration: (spaceId: string, method: BuyICTIntegration['connection_method']) => Promise<BuyICTIntegration | null>
  
  fetchOpportunities: (spaceId: string) => Promise<void>
  setOpportunityFilters: (filters: Partial<BuyICTOpportunityFilters>) => void
  setSelectedOpportunity: (opportunity: BuyICTOpportunityWithDepartment | null) => void
  
  fetchContacts: (spaceId: string) => Promise<void>
  setContactFilters: (filters: Partial<BuyICTContactFilters>) => void
  
  fetchDepartmentMappings: (spaceId: string) => Promise<void>
  createDepartmentMapping: (spaceId: string, mapping: Partial<BuyICTDepartmentMapping>) => Promise<void>
  updateDepartmentMapping: (id: string, updates: Partial<BuyICTDepartmentMapping>) => Promise<void>
  deleteDepartmentMapping: (id: string) => Promise<void>
  
  fetchSyncJobs: (spaceId: string) => Promise<void>
  
  fetchStats: (spaceId: string) => Promise<void>
  
  reset: () => void
}

const initialState = {
  integration: null,
  isLoadingIntegration: false,
  opportunities: [],
  opportunitiesLoading: false,
  opportunityFilters: {},
  selectedOpportunity: null,
  contacts: [],
  contactsLoading: false,
  contactFilters: {},
  departmentMappings: [],
  mappingsLoading: false,
  unmappedBuyerEntities: [],
  latestSyncJob: null,
  syncJobs: [],
  isSyncing: false,
  stats: {
    totalOpportunities: 0,
    openOpportunities: 0,
    totalContacts: 0,
    uniqueDepartments: 0,
    unmappedDepartments: 0,
    closingThisWeek: 0,
  },
}

export const useBuyICTStore = create<BuyICTState>((set, get) => ({
  ...initialState,

  // ============================================================================
  // Integration Actions
  // ============================================================================

  setIntegration: (integration) => set({ integration }),

  fetchIntegration: async (spaceId: string) => {
    set({ isLoadingIntegration: true })
    try {
      const { data, error } = await supabase
        .from('buyict_integrations')
        .select('*')
        .eq('space_id', spaceId)
        .single()

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching BuyICT integration:', error)
      }
      set({ integration: data || null })
    } catch (err) {
      console.error('Error fetching BuyICT integration:', err)
    } finally {
      set({ isLoadingIntegration: false })
    }
  },

  createIntegration: async (spaceId: string, method: BuyICTIntegration['connection_method']) => {
    try {
      const { data, error } = await supabase
        .from('buyict_integrations')
        .insert({
          space_id: spaceId,
          connection_method: method,
          connection_status: 'disconnected',
        })
        .select()
        .single()

      if (error) throw error
      set({ integration: data })
      return data
    } catch (err) {
      console.error('Error creating BuyICT integration:', err)
      return null
    }
  },

  // ============================================================================
  // Opportunities Actions
  // ============================================================================

  fetchOpportunities: async (spaceId: string) => {
    set({ opportunitiesLoading: true })
    try {
      const filters = get().opportunityFilters

      // Build query
      let query = supabase
        .from('buyict_opportunities')
        .select(`
          *,
          buyict_opportunity_contacts(count)
        `)
        .eq('space_id', spaceId)
        .order('closing_date', { ascending: true, nullsFirst: false })

      // Apply filters
      if (filters.status) {
        query = query.eq('opportunity_status', filters.status)
      }
      if (filters.closingDateFrom) {
        query = query.gte('closing_date', filters.closingDateFrom.toISOString())
      }
      if (filters.closingDateTo) {
        query = query.lte('closing_date', filters.closingDateTo.toISOString())
      }
      if (filters.searchTerm) {
        query = query.or(`title.ilike.%${filters.searchTerm}%,buyer_entity_raw.ilike.%${filters.searchTerm}%,buyict_reference.ilike.%${filters.searchTerm}%`)
      }

      const { data, error } = await query

      if (error) throw error

      // Fetch department mappings to enrich opportunities
      const mappings = get().departmentMappings
      
      const enrichedOpportunities: BuyICTOpportunityWithDepartment[] = (data || []).map((opp: any) => {
        const buyerEntity = opp.buyer_entity_raw
        let mappingInfo: { 
          canonical_department: string | null
          canonical_agency: string | null
          confidence: number | null
          approved: boolean | null 
        } = { canonical_department: null, canonical_agency: null, confidence: null, approved: null }

        if (buyerEntity) {
          // Try exact match first
          const exactMatch = mappings.find(m => m.match_type === 'exact' && m.source_pattern === buyerEntity)
          if (exactMatch) {
            mappingInfo = {
              canonical_department: exactMatch.canonical_department,
              canonical_agency: exactMatch.canonical_agency,
              confidence: exactMatch.confidence,
              approved: exactMatch.is_approved,
            }
          } else {
            // Try contains match
            const containsMatch = mappings.find(m => 
              m.match_type === 'contains' && 
              buyerEntity.toLowerCase().includes(m.source_pattern.toLowerCase())
            )
            if (containsMatch) {
              mappingInfo = {
                canonical_department: containsMatch.canonical_department,
                canonical_agency: containsMatch.canonical_agency,
                confidence: containsMatch.confidence,
                approved: containsMatch.is_approved,
              }
            }
          }
        }

        return {
          ...opp,
          contacts_count: opp.buyict_opportunity_contacts?.[0]?.count || 0,
          canonical_department: mappingInfo.canonical_department,
          canonical_agency: mappingInfo.canonical_agency,
          mapping_confidence: mappingInfo.confidence,
          mapping_approved: mappingInfo.approved,
        }
      })

      // Apply department filter client-side (after mapping)
      let filteredOpportunities = enrichedOpportunities
      if (filters.department) {
        filteredOpportunities = enrichedOpportunities.filter(
          o => o.canonical_department === filters.department || o.buyer_entity_raw === filters.department
        )
      }
      if (filters.hasContacts !== undefined) {
        filteredOpportunities = filteredOpportunities.filter(
          o => filters.hasContacts ? (o.contacts_count ?? 0) > 0 : (o.contacts_count ?? 0) === 0
        )
      }

      set({ opportunities: filteredOpportunities })
    } catch (err) {
      console.error('Error fetching opportunities:', err)
    } finally {
      set({ opportunitiesLoading: false })
    }
  },

  setOpportunityFilters: (filters) => {
    set((state) => ({
      opportunityFilters: { ...state.opportunityFilters, ...filters },
    }))
  },

  setSelectedOpportunity: (opportunity) => set({ selectedOpportunity: opportunity }),

  // ============================================================================
  // Contacts Actions
  // ============================================================================

  fetchContacts: async (spaceId: string) => {
    set({ contactsLoading: true })
    try {
      const filters = get().contactFilters

      // Fetch contacts with their linked opportunities
      let query = supabase
        .from('buyict_contacts')
        .select(`
          *,
          buyict_opportunity_contacts(
            source_type,
            source_detail,
            role_label,
            extraction_confidence,
            buyict_opportunities(
              id,
              title,
              buyict_reference
            )
          )
        `)
        .eq('space_id', spaceId)
        .order('last_seen_at', { ascending: false })

      if (filters.searchTerm) {
        query = query.or(`email.ilike.%${filters.searchTerm}%,name.ilike.%${filters.searchTerm}%`)
      }
      if (filters.minOpportunities) {
        query = query.gte('opportunity_count', filters.minOpportunities)
      }

      const { data, error } = await query

      if (error) throw error

      const enrichedContacts: BuyICTContactWithProvenance[] = (data || []).map((contact: any) => ({
        ...contact,
        opportunities: (contact.buyict_opportunity_contacts || []).map((oc: any) => ({
          id: oc.buyict_opportunities?.id,
          title: oc.buyict_opportunities?.title,
          buyict_reference: oc.buyict_opportunities?.buyict_reference,
          source_type: oc.source_type,
          source_detail: oc.source_detail,
          role_label: oc.role_label,
          extraction_confidence: oc.extraction_confidence,
        })).filter((o: any) => o.id),
      }))

      set({ contacts: enrichedContacts })
    } catch (err) {
      console.error('Error fetching contacts:', err)
    } finally {
      set({ contactsLoading: false })
    }
  },

  setContactFilters: (filters) => {
    set((state) => ({
      contactFilters: { ...state.contactFilters, ...filters },
    }))
  },

  // ============================================================================
  // Department Mappings Actions
  // ============================================================================

  fetchDepartmentMappings: async (spaceId: string) => {
    set({ mappingsLoading: true })
    try {
      const { data: mappings, error: mappingsError } = await supabase
        .from('buyict_department_mappings')
        .select('*')
        .eq('space_id', spaceId)
        .order('canonical_department', { ascending: true })

      if (mappingsError) throw mappingsError

      // Also fetch unique buyer entities that don't have mappings
      const { data: opportunities } = await supabase
        .from('buyict_opportunities')
        .select('buyer_entity_raw')
        .eq('space_id', spaceId)
        .not('buyer_entity_raw', 'is', null)

      const allBuyerEntities = [...new Set((opportunities || []).map(o => o.buyer_entity_raw).filter(Boolean))]
      const mappedPatterns = (mappings || []).map(m => m.source_pattern)
      const unmapped = allBuyerEntities.filter(entity => 
        !mappedPatterns.some(pattern => entity === pattern || entity?.toLowerCase().includes(pattern.toLowerCase()))
      )

      set({ 
        departmentMappings: mappings || [],
        unmappedBuyerEntities: unmapped as string[],
      })
    } catch (err) {
      console.error('Error fetching department mappings:', err)
    } finally {
      set({ mappingsLoading: false })
    }
  },

  createDepartmentMapping: async (spaceId: string, mapping: Partial<BuyICTDepartmentMapping>) => {
    try {
      const { error } = await supabase
        .from('buyict_department_mappings')
        .insert({
          space_id: spaceId,
          source_pattern: mapping.source_pattern,
          match_type: mapping.match_type || 'exact',
          canonical_department: mapping.canonical_department,
          canonical_agency: mapping.canonical_agency,
          confidence: mapping.confidence ?? 1.0,
          is_approved: mapping.is_approved ?? true,
          is_auto_generated: mapping.is_auto_generated ?? false,
        })

      if (error) throw error
      
      // Refresh mappings
      await get().fetchDepartmentMappings(spaceId)
    } catch (err) {
      console.error('Error creating department mapping:', err)
      throw err
    }
  },

  updateDepartmentMapping: async (id: string, updates: Partial<BuyICTDepartmentMapping>) => {
    try {
      const { error } = await supabase
        .from('buyict_department_mappings')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)

      if (error) throw error
    } catch (err) {
      console.error('Error updating department mapping:', err)
      throw err
    }
  },

  deleteDepartmentMapping: async (id: string) => {
    try {
      const { error } = await supabase
        .from('buyict_department_mappings')
        .delete()
        .eq('id', id)

      if (error) throw error
    } catch (err) {
      console.error('Error deleting department mapping:', err)
      throw err
    }
  },

  // ============================================================================
  // Sync Jobs Actions
  // ============================================================================

  fetchSyncJobs: async (spaceId: string) => {
    try {
      const { data, error } = await supabase
        .from('buyict_sync_jobs')
        .select('*')
        .eq('space_id', spaceId)
        .order('created_at', { ascending: false })
        .limit(10)

      if (error) throw error

      const jobs = data || []
      set({ 
        syncJobs: jobs,
        latestSyncJob: jobs[0] || null,
        isSyncing: jobs.some(j => j.status === 'running' || j.status === 'pending'),
      })
    } catch (err) {
      console.error('Error fetching sync jobs:', err)
    }
  },

  // ============================================================================
  // Stats Actions
  // ============================================================================

  fetchStats: async (spaceId: string) => {
    try {
      // Get opportunity counts
      const { data: opportunities } = await supabase
        .from('buyict_opportunities')
        .select('id, opportunity_status, closing_date, buyer_entity_raw')
        .eq('space_id', spaceId)

      const { data: contacts } = await supabase
        .from('buyict_contacts')
        .select('id')
        .eq('space_id', spaceId)

      const { data: mappings } = await supabase
        .from('buyict_department_mappings')
        .select('canonical_department')
        .eq('space_id', spaceId)

      const now = new Date()
      const oneWeekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

      const opps = opportunities || []
      const uniqueBuyerEntities = [...new Set(opps.map(o => o.buyer_entity_raw).filter(Boolean))]
      const mappedDepartments = [...new Set((mappings || []).map(m => m.canonical_department))]

      set({
        stats: {
          totalOpportunities: opps.length,
          openOpportunities: opps.filter(o => o.opportunity_status?.toLowerCase() === 'open').length,
          totalContacts: (contacts || []).length,
          uniqueDepartments: mappedDepartments.length,
          unmappedDepartments: uniqueBuyerEntities.length - (mappings || []).length,
          closingThisWeek: opps.filter(o => {
            if (!o.closing_date) return false
            const closeDate = new Date(o.closing_date)
            return closeDate >= now && closeDate <= oneWeekLater
          }).length,
        },
      })
    } catch (err) {
      console.error('Error fetching stats:', err)
    }
  },

  // ============================================================================
  // Reset
  // ============================================================================

  reset: () => set(initialState),
}))
