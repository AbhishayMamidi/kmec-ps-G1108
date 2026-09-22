import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ensureUserProfile } from '@/lib/user-profile'
import { getRoleLabel } from '@/lib/scout-guide'
import Link from 'next/link'
import { SettingsClient } from './settings-client'

export const metadata = {
  title: 'Settings - NeuroSentinel AI',
}

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/')

  const profile = await ensureUserProfile(supabase, user)

  return (
    <>
      <header className="clinical-header">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="text-[12px] font-medium transition-colors hover:text-[var(--accent-primary)]"
            style={{ color: 'var(--text-muted)' }}
          >
            NeuroSentinel AI
          </Link>
          <span className="text-[10px]" style={{ color: 'var(--border-strong)' }}>&gt;</span>
          <span className="text-[14px] font-semibold" style={{ color: 'var(--text-heading)' }}>
            Settings
          </span>
        </div>
      </header>

      <SettingsClient email={user.email ?? ''} roleLabel={getRoleLabel(profile.role)} fullName={profile.full_name} />
    </>
  )
}
