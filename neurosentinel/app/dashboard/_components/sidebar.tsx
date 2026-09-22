'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const NAV = [
  {
    id: 'dashboard', label: 'Dashboard', href: '/dashboard', exact: true,
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></svg>,
  },
  {
    id: 'eeg-reports', label: 'Analysis History', href: '/dashboard/eeg-reports',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>,
  },
  {
    id: 'settings', label: 'Settings', href: '/dashboard/settings',
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>,
  },
]

export function Sidebar({ userEmail, userRole, userName }: { userEmail: string; userRole: string; userName?: string | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)
  const [showSupport, setShowSupport] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <>
      {/* ── Mobile Header Bar — visible only on ≤768px ── */}
      <div className="mobile-header-bar">
        <button
          type="button"
          className="mobile-hamburger"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation menu"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <Link href="/dashboard" className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm border border-slate-200">
            <img src="/logo.jpeg" alt="NeuroSentinel AI" className="h-full w-full object-contain" />
          </div>
          <span className="text-[16px] font-bold tracking-tight truncate" style={{ color: '#0F172A', fontFamily: "'Outfit', sans-serif" }}>
            NeuroSentinel AI
          </span>
        </Link>
        <div className="ml-auto shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5" style={{ background: 'var(--accent-primary-light)', border: '1px solid rgba(14, 116, 144, 0.10)' }}>
          <span className="clinical-dot clinical-dot-primary" style={{ width: 5, height: 5, flexShrink: 0 }} />
          <span className="text-[11px] font-semibold whitespace-nowrap" style={{ color: 'var(--accent-primary)' }}>
            {userRole}
          </span>
        </div>
      </div>

      {/* ── Mobile Backdrop ── */}
      <div
        className={`mobile-sidebar-backdrop ${mobileOpen ? 'visible' : ''}`}
        onClick={() => setMobileOpen(false)}
      />
      <aside className={`clinical-sidebar flex h-full w-60 shrink-0 flex-col ${mobileOpen ? 'mobile-open' : ''}`}>
        {/* ── Logo / Branding Block ── */}
        <Link href="/dashboard" className="flex items-center gap-3 px-6 py-5 transition-opacity hover:opacity-80">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm border border-slate-200">
            <img src="/logo.jpeg" alt="" className="h-full w-full object-contain" />
          </div>
          <div className="text-[17px] font-bold tracking-tight" style={{ color: '#0F172A', fontFamily: "'Outfit', sans-serif" }}>
            NeuroSentinel AI
          </div>
        </Link>

        {/* Branding / Nav Divider */}
        <div style={{ height: '1px', background: 'var(--border-default)', margin: '0 16px 4px' }} />

        {/* ── Navigation Label ── */}
        <div className="clinical-sidebar-nav-label">Navigation</div>

        {/* ── Nav Items ── */}
        <nav className="flex-1 overflow-y-auto pb-2">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href)

            return (
              <Link
                key={item.id}
                href={item.href}
                id={`nav-${item.id}`}
                className={`clinical-nav-item ${active ? 'active' : ''}`}
                onClick={() => setMobileOpen(false)}
              >
                <span className="nav-icon" style={{ flexShrink: 0 }}>{item.icon}</span>
                <span>{item.label}</span>
                {active && <span className="clinical-nav-indicator" />}
              </Link>
            )
          })}
        </nav>

        {/* ── Footer: User + Help + Sign Out ── */}
        <div className="space-y-2 border-t px-0 py-3" style={{ borderColor: 'var(--border-default)' }}>
          <div className="clinical-user-card">
            <div className="clinical-user-avatar">
              {(userName || userEmail).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{userName || userEmail}</div>
              <div className="text-[11px] capitalize" style={{ color: 'var(--text-muted)' }}>{userRole}</div>
            </div>
          </div>

          {/* Help & Support */}
          <button
            type="button"
            onClick={() => setShowSupport(true)}
            className="flex w-full items-center gap-2.5 rounded-lg px-5 py-2 text-[13px] font-medium transition-colors hover:bg-[var(--bg-secondary)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Help &amp; Support
          </button>

          <button
            id="btn-sign-out"
            onClick={handleSignOut}
            disabled={signingOut}
            className="clinical-signout-btn"
          >
            {signingOut ? (
              <><div className="clinical-spinner-sm" />Signing out...</>
            ) : (
              <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>Sign Out</>
            )}
          </button>
        </div>
      </aside>

      {/* ── Help & Support Modal ── */}
      {showSupport && (
        <>
          <div
            className="fixed inset-0 z-[10000] bg-black/25 backdrop-blur-[2px] transition-opacity duration-200"
            onClick={() => setShowSupport(false)}
          />
          <div
            className="fixed z-[10001] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[460px] rounded-2xl border bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200"
            style={{ borderColor: '#E2E8F0' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-5" style={{ borderColor: '#F1F5F9' }}>
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{ background: 'linear-gradient(135deg, #10B981, #059669)' }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <div>
                  <div className="text-[16px] font-bold text-[#0F172A]" style={{ fontFamily: "'Inter', sans-serif" }}>Help &amp; Support</div>
                  <div className="text-[11px] font-medium text-[#94A3B8]">NeuroSentinel AI</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSupport(false)}
                className="rounded-lg p-1.5 text-[#94A3B8] transition-colors hover:bg-[#F1F5F9] hover:text-[#475569]"
                aria-label="Close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-6 space-y-5">
              <p className="text-[14px] leading-relaxed text-[#475569]">
                Whether you have a question about your EEG reports, need technical assistance, or are interested in research collaborations &mdash; we&apos;d love to hear from you.
              </p>

              {/* Contact Card */}
              <div className="rounded-xl border p-4" style={{ borderColor: '#E2E8F0', background: '#F8FAFC' }}>
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#94A3B8] mb-3">Get in Touch</div>

                <a
                  href="mailto:manikondaadwith6@gmail.com"
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 -mx-1 transition-colors hover:bg-white group"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: '#EEF2FF' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="20" height="16" x="2" y="4" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-[#0F172A] group-hover:text-[#6366F1] transition-colors">manikondaadwith6@gmail.com</div>
                    <div className="text-[11px] text-[#94A3B8]">Developer &amp; Lead Engineer</div>
                  </div>
                </a>
              </div>

              {/* Topics */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border px-3.5 py-3 text-center" style={{ borderColor: '#E2E8F0' }}>
                  <div className="text-[15px] mb-0.5">🐛</div>
                  <div className="text-[11px] font-semibold text-[#475569]">Bug Reports</div>
                </div>
                <div className="rounded-xl border px-3.5 py-3 text-center" style={{ borderColor: '#E2E8F0' }}>
                  <div className="text-[15px] mb-0.5">💡</div>
                  <div className="text-[11px] font-semibold text-[#475569]">Feature Requests</div>
                </div>
                <div className="rounded-xl border px-3.5 py-3 text-center" style={{ borderColor: '#E2E8F0' }}>
                  <div className="text-[15px] mb-0.5">🤝</div>
                  <div className="text-[11px] font-semibold text-[#475569]">Collaborations</div>
                </div>
                <div className="rounded-xl border px-3.5 py-3 text-center" style={{ borderColor: '#E2E8F0' }}>
                  <div className="text-[15px] mb-0.5">📋</div>
                  <div className="text-[11px] font-semibold text-[#475569]">General Queries</div>
                </div>
              </div>

              <p className="text-[12px] text-center text-[#94A3B8] leading-relaxed">
                We typically respond within 24 hours.<br />
                Built with ❤️ by the NeuroSentinel AI team.
              </p>
            </div>
          </div>
        </>
      )}
    </>
  )
}
