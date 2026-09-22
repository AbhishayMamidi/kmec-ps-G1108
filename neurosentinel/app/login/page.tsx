'use client'

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { HelpSupportButton } from '@/components/help-support-button'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ensureUserProfile } from '@/lib/user-profile'

/* ─────────────────────────────────────────────────
   Background — premium soft gradient + ambient glow + neural hint
───────────────────────────────────────────────── */
function PageBackground() {
  return (
    <div
      className="pointer-events-none fixed inset-0"
      aria-hidden="true"
      style={{
        background: `
          radial-gradient(circle at top left, rgba(16, 185, 129, 0.08), transparent 40%),
          radial-gradient(circle at bottom right, rgba(59, 130, 246, 0.06), transparent 50%),
          url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.5' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)' opacity='0.03'/%3E%3C/svg%3E\"),
          linear-gradient(135deg, #F8FAFC, #E2E8F0)
        `,
      }}
    >
      {/* Soft blurred blobs behind the form for subtle depth layer */}
      <div
        className="absolute left-[35%] top-[30%] h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'rgba(14,165,164,0.05)', filter: 'blur(80px)' }}
      />
      <div
        className="absolute left-[65%] top-[60%] h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: 'rgba(59,130,246,0.04)', filter: 'blur(80px)' }}
      />
      {/* Ultra-subtle neural waveform pattern — 2.5% opacity */}
      <svg
        className="absolute inset-0 h-full w-full"
        style={{ opacity: 0.025 }}
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <pattern id="neural-wave-login" x="0" y="0" width="120" height="60" patternUnits="userSpaceOnUse">
            <path
              d="M0 30 Q10 15 20 30 Q30 45 40 30 Q50 15 60 30 Q70 45 80 30 Q90 15 100 30 Q110 45 120 30"
              stroke="#0EA5A4"
              strokeWidth="1.2"
              fill="none"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#neural-wave-login)" />
      </svg>
    </div>
  )
}

/* ─────────────────────────────────────────────────
   Brand Header (same as sign-up page)
───────────────────────────────────────────────── */
function BrandHeader() {
  return (
    <Link href="/dashboard" className="mb-10 flex items-center justify-center gap-5 transition-opacity hover:opacity-90">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
        <img src="/logo.jpeg" alt="NeuroSentinel AI Logo" className="h-full w-full object-contain" />
      </div>
      <div className="text-left">
        <h1
          className="text-[28px] font-bold tracking-tight"
          style={{ color: '#0F172A', fontFamily: "'Outfit', sans-serif", letterSpacing: '-0.5px' }}
        >
          NeuroSentinel AI
        </h1>
        <p className="mt-1 text-[13px] font-medium tracking-wide" style={{ color: '#0EA5A4' }}>
          AI-Powered Seizure Intelligence
        </p>
      </div>
    </Link>
  )
}

/* ─────────────────────────────────────────────────
   Eye Toggle Button
───────────────────────────────────────────────── */
function EyeButton({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md p-1.5 transition-colors"
      style={{ color: '#94A3B8' }}
      aria-label={visible ? 'Hide password' : 'Show password'}
    >
      {visible ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.77 21.77 0 0 1 5.06-5.94" />
          <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.8 21.8 0 0 1-3.17 4.26" />
          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  )
}

/* ─────────────────────────────────────────────────
   Input Field
───────────────────────────────────────────────── */
type InputFieldProps = {
  id: string
  label: string
  type: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  autoComplete?: string
  disabled?: boolean
  icon: ReactNode
  suffix?: ReactNode
}

function InputField({ id, label, type, value, onChange, placeholder, autoComplete, disabled, icon, suffix }: InputFieldProps) {
  const [focused, setFocused] = useState(false)
  const [hovered, setHovered] = useState(false)

  const borderColor = focused ? '#10B981' : hovered ? '#94A3B8' : 'rgba(0,0,0,0.06)'
  const shadow = focused
    ? '0 0 0 3px rgba(16,185,129,0.15)'
    : hovered
    ? '0 1px 4px rgba(0,0,0,0.07)'
    : '0 1px 2px rgba(0,0,0,0.04)'

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[12px] font-medium tracking-wide"
        style={{ color: '#334155' }}
      >
        {label}
      </label>
      <div
        className="relative flex items-center rounded-xl transition-all duration-200"
        style={{ background: '#F1F5F9', border: `1.5px solid ${borderColor}`, boxShadow: shadow }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <span
          className="absolute left-3.5 flex items-center text-sm transition-colors duration-200"
          style={{ color: focused ? '#10B981' : '#64748B' }}
        >
          {icon}
        </span>
        <input
          id={id}
          type={type}
          value={value}
          autoComplete={autoComplete}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="w-full rounded-xl bg-transparent py-3.5 pl-10 pr-12 text-sm outline-none placeholder:text-[#94A3B8] disabled:opacity-60"
          style={{ color: '#0F172A', fontWeight: 500, caretColor: '#10B981', fontFamily: "'Outfit', sans-serif" }}
        />
        {suffix && <div className="absolute right-3 flex items-center">{suffix}</div>}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────
   Login Page
───────────────────────────────────────────────── */
export default function LoginPage() {
  const [view, setView] = useState<'signin' | 'forgot'>('signin')
  const [forgotStep, setForgotStep] = useState<'request' | 'verify' | 'success'>('request')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [verificationToken, setVerificationToken] = useState<string | null>(null)
  
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [hoveredBtn, setHoveredBtn] = useState(false)
  const [pressedBtn, setPressedBtn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setInfoMessage(params.get('message'))
  }, [])

  const handleSignIn = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setInfoMessage(null)

    if (view === 'forgot') {
      if (forgotStep === 'request') {
        if (!email) {
          setError('Please enter your email address.')
          return
        }
        setLoading(true)
        try {
          const res = await fetch('/api/auth/reset-password/request', {
            method: 'POST',
            body: JSON.stringify({ email }),
            headers: { 'Content-Type': 'application/json' },
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Unable to send recovery code.')
          
          setVerificationToken(data.verificationToken)
          setForgotStep('verify')
          setInfoMessage('Verification code sent to your email.')
        } catch (err: any) {
          setError(err.message)
        } finally {
          setLoading(false)
        }
        return
      }

      if (forgotStep === 'verify') {
        if (!otp || !newPassword || !confirmNewPassword) {
          setError('Please fill in all fields.')
          return
        }
        if (newPassword !== confirmNewPassword) {
          setError('Passwords do not match.')
          return
        }
        setLoading(true)
        try {
          const res = await fetch('/api/auth/reset-password/confirm', {
            method: 'POST',
            body: JSON.stringify({ email, otp, token: verificationToken, newPassword }),
            headers: { 'Content-Type': 'application/json' },
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Unable to reset password.')
          
          setForgotStep('success')
        } catch (err: any) {
          setError(err.message)
        } finally {
          setLoading(false)
        }
        return
      }

      if (forgotStep === 'success') {
        setView('signin')
        setForgotStep('request')
        setError(null)
        setInfoMessage(null)
        return
      }

      return
    }

    if (!email || !password) {
      setError('Email and password are required.')
      return
    }

    setLoading(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Session not available after sign in.')
      await ensureUserProfile(supabase, user)
      window.sessionStorage.removeItem('ns-pending-onboarding')
      window.location.href = '/dashboard'
    } catch (authError: any) {
      setError(authError.message || 'Unable to complete sign in.')
      setLoading(false)
    }
  }

  return (
    <main
      className="relative flex min-h-dvh items-center justify-center p-4"
      style={{ fontFamily: "'Outfit', sans-serif" }}
    >
      <PageBackground />
      <HelpSupportButton />

      {/* ── CARD ── */}
      <div
        className="relative z-10 w-full"
        style={{
          maxWidth: '440px',
          background: 'rgba(255, 255, 255, 0.7)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: '20px',
          border: '1px solid rgba(0,0,0,0.05)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
          padding: '40px 40px 36px',
          animation: 'fadeInUp 0.45s ease forwards',
        }}
      >
        <BrandHeader />

        <form onSubmit={handleSignIn} className="flex flex-col gap-5">
          {/* Section header */}
          <div className="text-center">
            <h2
              className="text-[20px] font-bold"
              style={{ color: '#0F172A', letterSpacing: '-0.2px' }}
            >
              {view === 'signin' ? 'Welcome back' : 
               forgotStep === 'request' ? 'Reset Password' :
               forgotStep === 'verify' ? 'Verify Code' : 'Password Reset'}
            </h2>
            <p className="mt-1.5 text-[14px] font-medium" style={{ color: '#334155' }}>
              {view === 'signin' ? 'Sign in to your NeuroSentinel AI account' :
               forgotStep === 'request' ? 'Enter your email to receive recovery instructions' :
               forgotStep === 'verify' ? 'Enter the code and your new password' : 'Your password has been updated'}
            </p>
          </div>

          {/* Thin teal accent rule */}
          <div className="mb-2" style={{ height: '2px', borderRadius: '1px', background: 'linear-gradient(90deg, #0EA5A4, #10B981, transparent)' }} />

          {/* Fields */}
          {forgotStep === 'success' ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div 
                className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-[32px]"
                style={{ border: '2px solid rgba(16, 185, 129, 0.1)' }}
              >
                ✅
              </div>
              <p className="text-[14px] font-medium text-emerald-800">
                Your password has been successfully updated. You can now sign in with your new credentials.
              </p>
            </div>
          ) : (
            <>
              {(view === 'signin' || forgotStep === 'request') && (
                <InputField
                  id="email"
                  label="Email Address"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="your@email.com"
                  autoComplete="email"
                  disabled={loading}
                  icon={
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                  }
                />
              )}

              {view === 'signin' && (
                <div className="flex flex-col gap-1">
                  <InputField
                    id="password"
                    label="Password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={setPassword}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    disabled={loading}
                    icon={
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    }
                    suffix={<EyeButton visible={showPassword} onClick={() => setShowPassword((v) => !v)} />}
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setView('forgot')
                        setForgotStep('request')
                        setError(null)
                      }}
                      className="text-[12px] font-semibold text-[#0EA5A4] hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                </div>
              )}

              {view === 'forgot' && forgotStep === 'verify' && (
                <div className="flex flex-col gap-5">
                  <InputField
                    id="otp"
                    label="Verification Code (6-digits)"
                    type="text"
                    value={otp}
                    onChange={setOtp}
                    placeholder="000000"
                    disabled={loading}
                    icon={
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                    }
                  />
                  <InputField
                    id="newPassword"
                    label="New Password"
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={setNewPassword}
                    placeholder="••••••••"
                    disabled={loading}
                    icon={
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    }
                    suffix={<EyeButton visible={showPassword} onClick={() => setShowPassword((v) => !v)} />}
                  />
                  <InputField
                    id="confirmNewPassword"
                    label="Confirm New Password"
                    type="password"
                    value={confirmNewPassword}
                    onChange={setConfirmNewPassword}
                    placeholder="••••••••"
                    disabled={loading}
                    icon={
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                    }
                  />
                </div>
              )}
            </>
          )}

          {/* Info / Error banners */}
          {infoMessage && (
            <div
              className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-[13px]"
              style={{ background: '#F0FAFA', border: '1px solid rgba(14,165,164,0.25)', color: '#0D7A7A' }}
            >
              <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              {infoMessage}
            </div>
          )}

          {error && (
            <div
              className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-[13px]"
              role="alert"
              style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626' }}
            >
              <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          {/* CTA */}
          <button
            type="submit"
            id="btn-signin"
            disabled={loading}
            onMouseEnter={() => setHoveredBtn(true)}
            onMouseLeave={() => { setHoveredBtn(false); setPressedBtn(false); }}
            onMouseDown={() => !loading && setPressedBtn(true)}
            onMouseUp={() => !loading && setPressedBtn(false)}
            className="relative w-full overflow-hidden rounded-xl text-sm font-semibold tracking-wide transition-all duration-200 disabled:cursor-not-allowed"
            style={{
              background: loading ? '#94A3B8' : 'linear-gradient(135deg, #0EA5A4 0%, #0B857A 50%, #059669 100%)',
              color: '#FFFFFF',
              opacity: loading ? 0.6 : 1,
              height: '46px',
              fontFamily: "'Outfit', sans-serif",
              textShadow: '0 1px 2px rgba(0,0,0,0.15)',
              boxShadow: !loading && hoveredBtn && !pressedBtn
                ? '0 12px 28px rgba(14,165,164,0.45), 0 4px 10px rgba(0,0,0,0.1)'
                : loading ? 'none' : '0 4px 14px rgba(14,165,164,0.25), 0 1px 3px rgba(0,0,0,0.07)',
              transform: !loading && pressedBtn ? 'scale(0.98)' : !loading && hoveredBtn ? 'translateY(-1px)' : 'translateY(0) scale(1)',
              filter: !loading && hoveredBtn && !pressedBtn ? 'brightness(1.12)' : 'brightness(1)',
              letterSpacing: '0.015em',
            }}
          >
            <span className="flex items-center justify-center gap-2">
              {loading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  {view === 'forgot' ? (forgotStep === 'request' ? 'Sending Code...' : 'Updating Password...') : 'Authenticating...'}
                </>
              ) : (
                view === 'forgot' ? (
                  forgotStep === 'request' ? 'Send Reset Code' : 
                  forgotStep === 'verify' ? 'Reset Password' : 'Go to Sign In'
                ) : 'Sign In →'
              )}
            </span>
          </button>

          {view === 'forgot' ? (
            <button
              type="button"
              onClick={() => {
                if (forgotStep === 'verify') {
                  setForgotStep('request')
                  setError(null)
                  return
                }
                setView('signin')
                setForgotStep('request')
                setError(null)
              }}
              className="text-center text-[13px] font-semibold transition-colors"
              style={{ color: '#64748B' }}
            >
              {forgotStep === 'success' ? '' : '← Back to Sign In'}
            </button>
          ) : (
            <>
              {/* Footer */}
              <div className="flex items-center gap-3">
                <div className="h-px flex-1" style={{ background: '#E2E8F0' }} />
                <span className="text-[11px] font-medium tracking-wide" style={{ color: '#94A3B8' }}>
                  New to NeuroSentinel AI?
                </span>
                <div className="h-px flex-1" style={{ background: '#E2E8F0' }} />
              </div>

              <a
                href="/"
                className="block text-center text-[13px] font-semibold transition-colors"
                style={{ color: '#0EA5A4' }}
              >
                Request an account →
              </a>
            </>
          )}
        </form>

      </div>
    </main>
  )
}
