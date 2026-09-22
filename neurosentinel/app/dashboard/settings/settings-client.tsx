'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'

// ─── Password strength helpers ──────────────────────────────────────────────

interface PasswordRequirement {
  label: string
  test: (pw: string) => boolean
}

const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  { label: '8+ characters',   test: (pw) => pw.length >= 8 },
  { label: 'Uppercase letter', test: (pw) => /[A-Z]/.test(pw) },
  { label: 'Number',           test: (pw) => /[0-9]/.test(pw) },
  { label: 'Symbol (!@#…)',    test: (pw) => /[^A-Za-z0-9]/.test(pw) },
]

function getStrengthScore(pw: string): number {
  return PASSWORD_REQUIREMENTS.filter(r => r.test(pw)).length
}

const STRENGTH_CONFIG = [
  { label: 'Weak',      color: 'var(--accent-danger)' },
  { label: 'Fair',      color: '#f59e0b' },
  { label: 'Good',      color: '#3b82f6' },
  { label: 'Strong',    color: 'var(--accent-primary)' },
  { label: 'Very Strong', color: '#10b981' },
]

// ─── Eye toggle icon ─────────────────────────────────────────────────────────

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

// ─── Shared input wrapper with eye toggle ────────────────────────────────────

function PasswordInput({
  id,
  label,
  value,
  placeholder,
  show,
  onToggleShow,
  onChange,
}: {
  id: string
  label: string
  value: string
  placeholder: string
  show: boolean
  onToggleShow: () => void
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="new-password"
          className="w-full rounded-xl border px-4 py-3 pr-11 text-sm outline-none transition-all placeholder:text-slate-400"
          style={{
            borderColor: 'var(--border-default)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
          }}
          onFocus={(e) => {
            e.target.style.borderColor = 'var(--accent-primary)'
            e.target.style.boxShadow = '0 0 0 3px rgba(14, 116, 144, 0.1)'
          }}
          onBlur={(e) => {
            e.target.style.borderColor = 'var(--border-default)'
            e.target.style.boxShadow = 'none'
          }}
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute right-3 top-1/2 -translate-y-1/2 transition-opacity hover:opacity-70"
          style={{ color: 'var(--text-muted)' }}
          tabIndex={-1}
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          <EyeIcon open={show} />
        </button>
      </div>
    </div>
  )
}

// ─── Editable Name Field ──────────────────────────────────────────────────────

function NameField({ initialName }: { initialName: string | null }) {
  const supabase = createClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initialName ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus()
  }, [editing])

  const handleSave = async () => {
    const trimmed = value.trim()
    if (!trimmed) return

    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('users').update({ full_name: trimmed }).eq('id', user.id)
        await supabase.auth.updateUser({ data: { full_name: trimmed } })
      }
      setSaved(true)
      setEditing(false)
      setTimeout(() => window.location.reload(), 800)
    } catch {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setValue(initialName ?? '')
    setEditing(false)
  }

  return (
    <div className="mb-5 pb-5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <div className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>
        Full Name
      </div>

      {!editing ? (
        <div className="mt-1 flex items-center gap-3">
          {initialName ? (
            <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>{saved ? value : initialName}</div>
          ) : (
            <div className="text-[14px] italic" style={{ color: 'var(--text-muted)' }}>Not set yet</div>
          )}
          {saved ? (
            <span className="flex items-center gap-1 text-[12px] font-medium" style={{ color: 'var(--accent-success)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              Saved
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-lg p-1.5 transition-colors hover:bg-[var(--bg-secondary)]"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Edit name"
              title={initialName ? 'Edit name' : 'Add your name'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                <path d="m15 5 4 4" />
              </svg>
            </button>
          )}
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Enter your name…"
            className="flex-1 max-w-[280px] rounded-xl border px-4 py-2.5 text-[14px] outline-none transition-all placeholder:text-slate-400"
            style={{
              borderColor: 'var(--border-default)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = 'var(--accent-primary)'
              e.target.style.boxShadow = '0 0 0 3px rgba(14, 116, 144, 0.1)'
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'var(--border-default)'
              e.target.style.boxShadow = 'none'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSave()
              if (e.key === 'Escape') handleCancel()
            }}
          />
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!value.trim() || saving}
            className="rounded-xl px-4 py-2.5 text-[13px] font-bold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent-primary)' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors hover:bg-[var(--bg-secondary)]"
            style={{ color: 'var(--text-muted)' }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SettingsClient({ email, roleLabel, fullName }: { email: string; roleLabel: string; fullName: string | null }) {
  const supabase = createClient()

  // Password state
  const [newPassword, setNewPassword]         = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew]                 = useState(false)
  const [showConfirm, setShowConfirm]         = useState(false)
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
  const [passwordError, setPasswordError]     = useState<string | null>(null)

  // Delete state
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError]     = useState<string | null>(null)

  // Live derived values
  const strengthScore  = useMemo(() => getStrengthScore(newPassword), [newPassword])
  const requirements   = useMemo(() => PASSWORD_REQUIREMENTS.map(r => ({ ...r, met: r.test(newPassword) })), [newPassword])
  const passwordsMatch = confirmPassword.length > 0 && newPassword === confirmPassword
  const mismatch       = confirmPassword.length > 0 && newPassword !== confirmPassword
  const strengthCfg    = newPassword.length > 0 ? STRENGTH_CONFIG[strengthScore] : null

  const handlePasswordChange = async () => {
    setPasswordError(null)
    setPasswordMessage(null)

    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters long.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.')
      return
    }

    setPasswordLoading(true)
    try {
      const response = await fetch('/api/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Unable to change password.')
      setPasswordMessage('Password updated successfully.')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error: any) {
      setPasswordError(error.message || 'Unable to change password.')
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm('This will permanently delete your account and all data. This cannot be undone.')
    if (!confirmed) return

    setDeleteLoading(true)
    setDeleteError(null)
    try {
      const response = await fetch('/api/account/delete', { method: 'DELETE' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Unable to delete your account.')
      await supabase.auth.signOut()
      window.location.href = '/'
    } catch (error: any) {
      setDeleteError(error.message || 'Unable to delete your account.')
      setDeleteLoading(false)
    }
  }

  // Icons
  const IconUser  = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
  const IconLock  = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
  const IconTrash = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>

  return (
    <div
      className="w-full max-w-[1400px] flex-1 space-y-10 overflow-y-auto p-10 xl:p-12"
      style={{ background: 'var(--bg-primary)', minHeight: '100%', animation: 'clinicalFadeIn 0.4s ease forwards' }}
    >
      {/* Page header */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--text-faint)' }}>
          General Settings
        </div>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight" style={{ color: 'var(--text-heading)', fontFamily: "'Inter', sans-serif" }}>
          Account &amp; Security Settings
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--text-secondary)', maxWidth: '640px' }}>
          Configure your clinical authentication details and manage your account status with professional-grade security controls.
        </p>
      </div>

      <div className="space-y-10">

        {/* ── 1. USER PROFILE ── */}
        <section
          className="clinical-card p-1 transition-all duration-300"
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
        >
          <div className="border-b px-8 py-5" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center gap-3">
              <div style={{ color: 'var(--text-muted)' }}><IconUser /></div>
              <div>
                <h2 className="text-[15px] font-bold" style={{ color: 'var(--text-heading)' }}>User Profile</h2>
                <p className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Your registered authentication details</p>
              </div>
            </div>
          </div>
          <div className="p-8">
            {/* Editable Full Name */}
            <NameField initialName={fullName} />
            <div className="grid gap-0 sm:grid-cols-2">
              {/* Email block */}
              <div className="space-y-1.5 py-2 pr-8">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>Registered Email</div>
                <div className="text-[15px] font-semibold break-all" style={{ color: 'var(--text-primary)' }}>{email}</div>
              </div>
              {/* Role block — left border on sm+ to clearly separate the two info blocks */}
              <div
                className="space-y-1.5 py-2 sm:pl-8"
                style={{ borderLeft: '1px solid var(--border-subtle)' }}
              >
                <div className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>Assigned Role</div>
                <div className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>{roleLabel}</div>
              </div>
            </div>
          </div>

        </section>

        {/* ── 1.5 SCOUT ASSISTANT ── */}
        <section
          className="clinical-card p-1 transition-all duration-300"
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
        >
          <div className="border-b px-8 py-5" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center gap-3">
              <div style={{ color: 'var(--accent-primary)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </div>
              <div>
                <h2 className="text-[15px] font-bold" style={{ color: 'var(--text-heading)' }}>SCOUT Assistant</h2>
                <p className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>Manage assistant tutorials and preferences</p>
              </div>
            </div>
          </div>
          <div className="p-8">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>Dashboard Guided Tour</div>
                <div className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>Replay the interactive walkthrough of the clinical workspace.</div>
              </div>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event('ns-restart-tour'))}
                className="rounded-xl px-5 py-2.5 text-[13px] font-bold shadow-sm transition-all hover:-translate-y-0.5 active:scale-95"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
              >
                Restart Tour
              </button>
            </div>
          </div>
        </section>

        {/* ── 2. SECURITY ── */}
        <section
          className="clinical-card p-1 transition-all duration-300"
          style={{ boxShadow: 'var(--shadow-md)', border: '1px solid var(--border-strong)' }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
        >
          <div className="border-b px-8 py-6" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: 'var(--accent-primary-light)', color: 'var(--accent-primary)' }}>
                <IconLock />
              </div>
              <div>
                <h2 className="text-[16px] font-bold" style={{ color: 'var(--text-heading)' }}>Security &amp; Authentication</h2>
                <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>Secure your account access credentials</p>
              </div>
            </div>
          </div>

          <div className="p-8">
            <div className="grid gap-10 xl:grid-cols-[1fr_320px]">

              {/* Left: password fields */}
              <div className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                  {/* New password */}
                  <div className="space-y-3">
                    <PasswordInput
                      id="new-password"
                      label="New Security Password"
                      value={newPassword}
                      placeholder="Enter new password"
                      show={showNew}
                      onToggleShow={() => setShowNew(v => !v)}
                      onChange={setNewPassword}
                    />

                    {/* Strength bar */}
                    {newPassword.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex gap-1">
                          {[0, 1, 2, 3].map(i => (
                            <div
                              key={i}
                              className="h-1.5 flex-1 rounded-full transition-all duration-300"
                              style={{
                                background: i < strengthScore
                                  ? (strengthCfg?.color ?? 'var(--accent-primary)')
                                  : 'var(--border-default)',
                              }}
                            />
                          ))}
                        </div>
                        <div className="text-[11px] font-semibold" style={{ color: strengthCfg?.color }}>
                          {strengthCfg?.label}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Confirm password */}
                  <div className="space-y-3">
                    <PasswordInput
                      id="confirm-password"
                      label="Confirm New Password"
                      value={confirmPassword}
                      placeholder="Re-enter password"
                      show={showConfirm}
                      onToggleShow={() => setShowConfirm(v => !v)}
                      onChange={setConfirmPassword}
                    />

                    {/* Live match indicator */}
                    {confirmPassword.length > 0 && (
                      <div className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: passwordsMatch ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
                        {passwordsMatch ? (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                            Passwords match
                          </>
                        ) : (
                          <>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            Passwords do not match
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Feedback messages */}
                {passwordError && (
                  <div className="rounded-xl border px-4 py-3 text-[13px] font-medium" style={{ borderColor: 'rgba(220,38,38,0.15)', background: 'var(--accent-danger-light)', color: 'var(--accent-danger)' }}>
                    {passwordError}
                  </div>
                )}
                {passwordMessage && (
                  <div className="rounded-xl border px-4 py-3 text-[13px] font-medium" style={{ borderColor: 'rgba(22,163,74,0.15)', background: 'var(--accent-success-light)', color: 'var(--accent-success)' }}>
                    {passwordMessage}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void handlePasswordChange()}
                  disabled={passwordLoading || mismatch}
                  className="clinical-btn-primary"
                  style={{ height: 46, padding: '0 32px', borderRadius: '12px', fontSize: '14px', boxShadow: '0 4px 12px rgba(14, 116, 144, 0.2)' }}
                >
                  {passwordLoading ? 'Updating...' : 'Change Security Password'}
                </button>
              </div>

              {/* Right: requirements checklist */}
              <div
                className="rounded-xl p-5 space-y-3 self-start"
                style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)' }}
              >
                <div className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-faint)' }}>
                  Requirements
                </div>
                {requirements.map(req => (
                  <div key={req.label} className="flex items-center gap-2.5 text-[13px]">
                    <div
                      className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full transition-all duration-200"
                      style={{
                        background: req.met ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                        border: req.met ? 'none' : '1.5px solid var(--border-strong)',
                      }}
                    >
                      {req.met && (
                        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                    <span style={{ color: req.met ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {req.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── 3. DANGER ZONE ── */}
        <section
          className="clinical-card p-1 transition-all duration-300"
          style={{ background: '#fffafa', borderColor: 'rgba(220, 38, 38, 0.1)' }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
        >
          <div className="border-b px-8 py-6" style={{ borderColor: 'rgba(220, 38, 38, 0.06)' }}>
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: 'var(--accent-danger-light)', color: 'var(--accent-danger)' }}>
                <IconTrash />
              </div>
              <div>
                <h2 className="text-[16px] font-bold" style={{ color: 'var(--accent-danger)' }}>Permanent Account Removal</h2>
                <p className="text-[13px]" style={{ color: 'var(--accent-danger)', opacity: 0.7 }}>Critical action area — exercise caution</p>
              </div>
            </div>
          </div>
          <div className="p-8">
            <p className="text-[14.5px] font-medium leading-relaxed" style={{ color: 'var(--text-secondary)', maxWidth: '640px' }}>
              Executing an account deletion will permanently purge your clinical profile, historical reports, scout sessions, and authentication metadata.
              <span className="mt-2 block font-bold text-red-600">This action is medically irreversible.</span>
            </p>
            {deleteError && (
              <div className="mt-6 rounded-xl border px-4 py-3 text-[13px] font-medium" style={{ borderColor: 'rgba(220,38,38,0.25)', background: 'white', color: 'var(--accent-danger)' }}>
                {deleteError}
              </div>
            )}
            <button
              type="button"
              onClick={() => void handleDeleteAccount()}
              disabled={deleteLoading}
              className="mt-8 clinical-btn-danger-outline"
              style={{ height: 44, padding: '0 28px', borderRadius: '12px', fontWeight: 700, transition: 'all 0.2s ease' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-danger-light)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {deleteLoading ? 'Processing Purge...' : 'Purge Clinical Account'}
            </button>
          </div>
        </section>

      </div>
    </div>
  )
}
