import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from './_components/sidebar'
import { ensureUserProfile } from '@/lib/user-profile'
import { getRoleLabel } from '@/lib/scout-guide'
import { ScoutTour } from './_components/scout-tour'
import { NamePrompt } from './_components/name-prompt'
import './dashboard.css'

import { AnalysisProvider } from '@/lib/context/analysis-context'

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  let userRole = 'Role not set'
  let userName: string | null = null
  try {
    const profile = await ensureUserProfile(supabase, user)
    userRole = getRoleLabel(profile.role)
    userName = profile.full_name
  } catch {}

  return (
    <AnalysisProvider>
      <div className="clinical-dashboard flex flex-col md:flex-row h-screen overflow-hidden">
        {/* ── Left: Sidebar ── */}
        <Sidebar userEmail={user.email ?? ''} userRole={userRole} userName={userName} />

        {/* ── Center: page content ── */}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
          {children}
          <ScoutTour />
          <NamePrompt />
        </main>
      </div>
    </AnalysisProvider>
  )
}
