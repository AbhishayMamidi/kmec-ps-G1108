import type { ScoutRole } from '@/lib/scout-guide'

type UserLike = {
  id: string
  email?: string | null
  user_metadata?: {
    role?: unknown
    scout_role?: unknown
    full_name?: unknown
  } | null
}

export type UserProfile = {
  role: ScoutRole
  onboarding_complete: boolean
  full_name: string | null
}

type DatabaseUserRole = 'user' | 'admin' | 'doctor' | 'clinician' | 'researcher' | 'patient'

const DEFAULT_PROFILE: UserProfile = {
  role: null,
  onboarding_complete: false,
  full_name: null,
}

function normalizeDatabaseRole(role: unknown): DatabaseUserRole | null {
  if (typeof role !== 'string') return null

  const normalized = role.trim().toLowerCase()
  if (
    normalized === 'user' ||
    normalized === 'admin' ||
    normalized === 'doctor' ||
    normalized === 'clinician' ||
    normalized === 'researcher' ||
    normalized === 'patient'
  ) {
    return normalized
  }

  return null
}

function normalizeRole(role: unknown): ScoutRole {
  const normalized = normalizeDatabaseRole(role)
  if (normalized === 'doctor' || normalized === 'clinician') return 'clinician'
  if (normalized === 'researcher' || normalized === 'patient') return normalized
  return null
}

export function toDatabaseRole(role: unknown): DatabaseUserRole | null {
  const normalizedRole = normalizeRole(role)
  if (normalizedRole === 'clinician' || normalizedRole === 'researcher' || normalizedRole === 'patient') {
    return normalizedRole
  }

  return null
}

function getRoleFromUser(user: UserLike): ScoutRole {
  return normalizeRole(user.user_metadata?.scout_role ?? user.user_metadata?.role)
}

export async function ensureUserProfile(supabase: any, user: UserLike): Promise<UserProfile> {
  const metadataRole = getRoleFromUser(user)
  const { data: existing, error: existingError } = await supabase
    .from('users')
    .select('role, onboarding_complete, full_name')
    .eq('id', user.id)
    .maybeSingle()

  if (existingError) {
    throw existingError
  }

  if (existing) {
    const normalizedRole = normalizeRole(existing.role) ?? metadataRole
    if (!normalizeRole(existing.role) && metadataRole) {
      const databaseRole = toDatabaseRole(metadataRole)
      const { error: repairError } = await supabase
        .from('users')
        .update({ role: databaseRole })
        .eq('id', user.id)

      if (repairError) {
        throw repairError
      }
    }

    return {
      role: normalizedRole,
      onboarding_complete: Boolean(existing.onboarding_complete),
      full_name: typeof existing.full_name === 'string' ? existing.full_name : null,
    }
  }

  const createPayload: { id: string; email: string; onboarding_complete: boolean; role: DatabaseUserRole; full_name: string | null } = {
    id: user.id,
    email: user.email ?? '',
    onboarding_complete: false,
    role: 'user',
    full_name: typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null,
  }

  const databaseRole = toDatabaseRole(metadataRole)
  if (databaseRole) {
    createPayload.role = databaseRole
  }

  const { data: created, error: createError } = await supabase
    .from('users')
    .upsert(
      createPayload,
      { onConflict: 'id' }
    )
    .select('role, onboarding_complete, full_name')
    .single()

  if (createError) {
    throw createError
  }

  return {
    role: normalizeRole(created?.role) ?? metadataRole ?? DEFAULT_PROFILE.role,
    onboarding_complete: Boolean(created?.onboarding_complete),
    full_name: typeof created?.full_name === 'string' ? created.full_name : null,
  }
}
