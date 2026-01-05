import { create } from 'zustand'
import type { Database } from '@/types/database'

type Space = Database['public']['Tables']['spaces']['Row']

interface SpaceState {
    currentSpace: Space | null
    spaces: Space[]
    setCurrentSpace: (space: Space | null) => void
    setSpaces: (spaces: Space[]) => void
}

export const useSpaceStore = create<SpaceState>((set) => ({
    currentSpace: null,
    spaces: [],
    setCurrentSpace: (space) => set({ currentSpace: space }),
    setSpaces: (spaces) => set({ spaces }),
}))
