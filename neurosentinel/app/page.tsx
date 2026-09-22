'use client'

import { useEffect, useRef, useState, useMemo, useCallback, type ReactNode, type KeyboardEvent, type ClipboardEvent } from 'react'
import { HelpSupportButton } from '@/components/help-support-button'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ensureUserProfile } from '@/lib/user-profile'

type Step = 'signup' | 'otp' | 'success'

const OTP_LENGTH = 6
const RESEND_SECONDS = 60

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
          <pattern id="neural-wave" x="0" y="0" width="120" height="60" patternUnits="userSpaceOnUse">
            <path
              d="M0 30 Q10 15 20 30 Q30 45 40 30 Q50 15 60 30 Q70 45 80 30 Q90 15 100 30 Q110 45 120 30"
              stroke="#0EA5A4"
              strokeWidth="1.2"
              fill="none"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#neural-wave)" />
      </svg>
    </div>
  )
}

/* ─────────────────────────────────────────────────
   Brand Header
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
function InputField({
  id,
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  disabled,
  icon,
  suffix,
}: {
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
}) {
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
   OTP Input — 6 segmented boxes
───────────────────────────────────────────────── */
function OtpInput({ digits, onChange, disabled }: { digits: string[]; onChange: (digits: string[]) => void; disabled?: boolean }) {
  const refs = useRef<Array<HTMLInputElement | null>>([])

  const focus = (index: number) => refs.current[index]?.focus()

  const handleInput = (index: number, raw: string) => {
    const char = raw.replace(/\D/g, '').slice(-1)
    if (!char) return
    const next = [...digits]
    next[index] = char
    onChange(next)
    if (index < OTP_LENGTH - 1) focus(index + 1)
  }

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault()
      const next = [...digits]
      if (next[index]) {
        next[index] = ''
        onChange(next)
      } else if (index > 0) {
        next[index - 1] = ''
        onChange(next)
        focus(index - 1)
      }
    }
    if (event.key === 'ArrowLeft' && index > 0) focus(index - 1)
    if (event.key === 'ArrowRight' && index < OTP_LENGTH - 1) focus(index + 1)
  }

  const handlePaste = (event: ClipboardEvent) => {
    event.preventDefault()
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
    if (!pasted) return
    const next = Array(OTP_LENGTH).fill('')
    pasted.split('').forEach((char, i) => { next[i] = char })
    onChange(next)
    focus(Math.min(pasted.length, OTP_LENGTH - 1))
  }

  return (
    <div className="flex justify-center gap-4" onPaste={handlePaste}>
      {digits.map((digit, index) => {
        const filled = digit !== ''
        return (
          <input
            key={index}
            autoFocus={index === 0}
            ref={(el) => { refs.current[index] = el }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={digit}
            disabled={disabled}
            onChange={(e) => handleInput(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onFocus={(e) => e.target.select()}
            aria-label={`OTP digit ${index + 1}`}
            className="h-14 w-12 rounded-xl text-center text-xl font-bold transition-all duration-300 outline-none focus:border-[#10B981] focus:ring-4 focus:ring-[#10B981]/15 focus:-translate-y-0.5 focus:shadow-md"
            style={{
              background: filled ? '#F8FAFC' : '#FFFFFF',
              border: `1.5px solid ${filled ? '#10B981' : 'rgba(0,0,0,0.08)'}`,
              color: '#0F172A',
              boxShadow: filled
                ? 'inset 0 1px 2px rgba(0,0,0,0.02)'
                : '0 1px 2px rgba(0,0,0,0.03)',
              fontFamily: "'Outfit', monospace",
              caretColor: '#10B981',
            }}
          />
        )
      })}
    </div>
  )
}

/* ─────────────────────────────────────────────────
   Primary Button — teal → green gradient
───────────────────────────────────────────────── */
function PrimaryButton({
  id,
  loading,
  disabled,
  onClick,
  children,
}: {
  id: string
  loading?: boolean
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  const inactive = disabled || loading
  
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      disabled={inactive}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => !inactive && setPressed(true)}
      onMouseUp={() => !inactive && setPressed(false)}
      className="relative w-full overflow-hidden rounded-xl text-sm font-semibold tracking-wide transition-all duration-200 disabled:cursor-not-allowed"
      style={{
        background: inactive ? '#94A3B8' : hovered ? 'linear-gradient(135deg, #059669 0%, #047857 100%)' : 'linear-gradient(135deg, #10B981 0%, #059669 50%, #047857 100%)',
        color: '#FFFFFF',
        opacity: inactive ? 0.6 : 1,
        height: '46px',
        fontFamily: "'Outfit', sans-serif",
        textShadow: '0 1px 2px rgba(0,0,0,0.15)',
        boxShadow: !inactive && hovered && !pressed
          ? '0 12px 24px -6px rgba(16,185,129,0.35)'
          : inactive ? 'none' : '0 8px 16px -4px rgba(16,185,129,0.25)',
        transform: !inactive && pressed ? 'scale(0.98)' : !inactive && hovered ? 'translateY(-1px)' : 'translateY(0) scale(1)',
        filter: !inactive && hovered && !pressed ? 'brightness(1.12)' : 'brightness(1)',
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
            Processing…
          </>
        ) : (
          children
        )}
      </span>
    </button>
  )
}

/* ─────────────────────────────────────────────────
   Error Banner
───────────────────────────────────────────────── */
function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm"
      role="alert"
      style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#DC2626' }}
    >
      <svg className="mt-0.5 shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span style={{ fontFamily: "'Outfit', sans-serif" }}>{message}</span>
    </div>
  )
}

/* ─────────────────────────────────────────────────
   Divider
───────────────────────────────────────────────── */
function Divider({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1" style={{ background: '#E2E8F0' }} />
      {label && <span className="text-[11px] font-medium tracking-wide" style={{ color: '#94A3B8' }}>{label}</span>}
      <div className="h-px flex-1" style={{ background: '#E2E8F0' }} />
    </div>
  )
}

/* ─────────────────────────────────────────────────
   Success Screen
───────────────────────────────────────────────── */
function SuccessScreen({ email }: { email: string }) {
  return (
    <div
      className="flex flex-col items-center gap-6 py-4 text-center"
      style={{ animation: 'fadeInScale 0.4s ease forwards' }}
    >
      <div
        className="flex h-20 w-20 items-center justify-center rounded-full"
        style={{ background: '#F0FDF4', border: '1.5px solid #6EE7B7' }}
      >
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
          <path d="M5 13l4 4L19 7" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div>
        <h2 className="text-xl font-semibold" style={{ color: '#059669', fontFamily: "'Outfit', sans-serif" }}>
          Identity Verified
        </h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: '#64748B' }}>
          Welcome to NeuroSentinel AI.<br />
          <span style={{ color: '#94A3B8' }}>{email}</span>
        </p>
      </div>
      <p className="text-xs" style={{ color: '#94A3B8' }}>
        Preparing your SCOUT onboarding session…
      </p>
    </div>
  )
}

/* ─────────────────────────────────────────────────
   Main Page
───────────────────────────────────────────────── */
export default function SignUpPage() {
  const supabase = createClient()
  const [step, setStep] = useState<Step>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [verificationToken, setVerificationToken] = useState('')
  const [resendIn, setResendIn] = useState(RESEND_SECONDS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasAutoSubmitted = useRef(false)

  const allFilled = useMemo(() => digits.every((d) => d !== ''), [digits])

  // Resend countdown
  useEffect(() => {
    if (step !== 'otp') return undefined
    setResendIn(RESEND_SECONDS)
    const interval = window.setInterval(() => {
      setResendIn((cur) => {
        if (cur <= 1) { window.clearInterval(interval); return 0 }
        return cur - 1
      })
    }, 1000)
    return () => window.clearInterval(interval)
  }, [step, verificationToken])

  const handleDigitChange = useCallback((next: string[]) => {
    if (!next.every((d) => d !== '')) hasAutoSubmitted.current = false
    setDigits(next)
    setError(null)
  }, [])

  const requestOtp = async () => {
    const response = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    })
    const result = await response.json()
    if (!response.ok) {
      if (response.status === 409 && result?.redirectTo) {
        window.location.href = result.redirectTo
        // Throw so handleSignUp's catch block runs and setStep('otp') is never called.
        // The browser is already navigating away so this error won't be visible.
        throw new Error(result.error || 'An account with this email already exists.')
      }
      throw new Error(result.error || 'Unable to send verification code.')
    }
    setVerificationToken(result.verificationToken || '')
  }

  const handleSignUp = async () => {
    setError(null)
    if (!email.trim()) { setError('Please enter your email address.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    if (!acceptedTerms) { setError('You must accept the Terms and Privacy Policy to continue.'); return }

    setLoading(true)
    try {
      await requestOtp()
      setDigits(Array(OTP_LENGTH).fill(''))
      hasAutoSubmitted.current = false
      setStep('otp')
    } catch (err: any) {
      setError(err.message || 'Unable to send verification code.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = useCallback(async () => {
    const otp = digits.join('')
    if (otp.length < OTP_LENGTH) { setError(`Please enter all ${OTP_LENGTH} digits.`); return }
    if (!verificationToken) { setError('Verification session expired. Please request a new code.'); hasAutoSubmitted.current = false; return }

    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/complete-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, otp, verificationToken }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to complete sign up.')

      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (signInError) throw new Error(signInError.message)

      const { data: { user } } = await supabase.auth.getUser()
      if (user) await ensureUserProfile(supabase, user)

      window.sessionStorage.setItem('ns-pending-onboarding', 'true')
      setStep('success')
      window.setTimeout(() => { window.location.href = '/onboarding' }, 1400)
    } catch (err: any) {
      setError(err.message || 'Unable to verify code.')
      hasAutoSubmitted.current = false
    } finally {
      setLoading(false)
    }
  }, [digits, email, password, supabase, verificationToken])

  // Auto-submit when all OTP digits filled
  useEffect(() => {
    if (step === 'otp' && allFilled && !hasAutoSubmitted.current) {
      hasAutoSubmitted.current = true
      void handleVerifyOtp()
    }
  }, [allFilled, handleVerifyOtp, step])

  const handleResend = async () => {
    if (resendIn > 0) return
    setLoading(true)
    setError(null)
    try {
      await requestOtp()
      setDigits(Array(OTP_LENGTH).fill(''))
      hasAutoSubmitted.current = false
    } catch (err: any) {
      setError(err.message || 'Unable to resend verification code.')
    } finally {
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

        {/* ── STEP: SIGNUP ── */}
        {step === 'signup' && (
          <div className="flex flex-col gap-5" style={{ animation: 'fadeInScale 0.35s ease forwards' }}>
            {/* Section header */}
            <div className="text-center">
              <h2
                className="text-[20px] font-bold"
                style={{ color: '#0F172A', letterSpacing: '-0.2px' }}
              >
                Create your account
              </h2>
              <p className="mt-1.5 text-[14px] font-medium" style={{ color: '#334155' }}>
                Join NeuroSentinel AI to access clinical EEG intelligence
              </p>
            </div>

            {/* Thin teal accent rule */}
            <div className="mb-2" style={{ height: '2px', borderRadius: '1px', background: 'linear-gradient(90deg, #0EA5A4, #10B981, transparent)' }} />

            {/* Fields */}
            <InputField
              id="email"
              label="Email Address"
              type="email"
              value={email}
              onChange={(v) => { setEmail(v); setError(null) }}
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

            <InputField
              id="password"
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(v) => { setPassword(v); setError(null) }}
              placeholder="Minimum 8 characters"
              autoComplete="new-password"
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
              id="confirm-password"
              label="Confirm Password"
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(v) => { setConfirmPassword(v); setError(null) }}
              placeholder="Re-enter your password"
              autoComplete="new-password"
              disabled={loading}
              icon={
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 11V7a3 3 0 0 1 6 0v4" />
                  <rect x="4" y="11" width="16" height="9" rx="2" />
                  <path d="M12 15h.01" />
                </svg>
              }
              suffix={<EyeButton visible={showConfirmPassword} onClick={() => setShowConfirmPassword((v) => !v)} />}
            />

            {/* Terms checkbox */}
            <label
              className="flex cursor-pointer items-start gap-3.5 rounded-xl px-4 py-3.5 text-[13px] transition-colors"
              style={{
                background: '#F8FAFC',
                border: `1.5px solid ${acceptedTerms ? 'rgba(14,165,164,0.25)' : '#E2E8F0'}`,
                color: '#475569',
                userSelect: 'none',
              }}
            >
              <div className="relative mt-[2.5px] flex-shrink-0">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(e) => { setAcceptedTerms(e.target.checked); setError(null) }}
                  className="peer sr-only"
                  id="terms-checkbox"
                />
                <div
                  className="h-4 w-4 rounded flex items-center justify-center transition-all"
                  style={{
                    background: acceptedTerms ? '#0EA5A4' : '#FFFFFF',
                    border: `1.5px solid ${acceptedTerms ? '#0EA5A4' : '#CBD5E1'}`,
                  }}
                >
                  {acceptedTerms && (
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5l2.5 2.5L8 2.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              </div>
              <span className="leading-snug">
                I agree to the{' '}
                <Link href="/terms" target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2" style={{ color: '#0EA5A4' }}>
                  Terms of Use
                </Link>{' '}
                and{' '}
                <Link href="/privacy" target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2" style={{ color: '#0EA5A4' }}>
                  Privacy Policy
                </Link>
              </span>
            </label>

            {error && <ErrorBanner message={error} />}

            <PrimaryButton id="btn-signup" onClick={handleSignUp} loading={loading}>
              Send Verification Code
            </PrimaryButton>

            <p className="text-center text-[11.5px]" style={{ color: '#64748B' }}>
              A 6-digit code will be sent to your email address.
            </p>

            <Divider label="Already have an account?" />

            <a
              href="/login"
              className="block text-center text-[13px] font-semibold transition-colors"
              style={{ color: '#0EA5A4' }}
            >
              Sign in instead →
            </a>
          </div>
        )}

        {/* ── STEP: OTP ── */}
        {step === 'otp' && (
          <div className="flex flex-col gap-6" style={{ animation: 'fadeInScale 0.35s ease forwards' }}>
            {/* Header */}
            <div className="text-center mt-2">
              <h2
                className="text-[20px] font-bold"
                style={{ color: '#0F172A', letterSpacing: '-0.2px' }}
              >
                Verify your email
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed" style={{ color: '#334155' }}>
                We sent a 6-digit code to{' '}
                <span className="font-semibold text-[#0F172A] bg-slate-100 px-2 py-0.5 rounded-md">{email}</span>
              </p>
            </div>

            {/* Thin teal accent rule */}
            <div className="mb-2" style={{ height: '2px', borderRadius: '1px', background: 'linear-gradient(90deg, #0EA5A4, #10B981, transparent)' }} />

            {/* OTP digits label */}
            <div>
              <p className="mb-3 text-center text-[11px] font-semibold uppercase tracking-widest" style={{ color: '#94A3B8' }}>
                Enter verification code
              </p>
              <OtpInput digits={digits} onChange={handleDigitChange} disabled={loading} />
            </div>

            {error && <ErrorBanner message={error} />}

            <PrimaryButton
              id="btn-verify"
              onClick={() => void handleVerifyOtp()}
              loading={loading}
              disabled={!allFilled}
            >
              Verify Code
            </PrimaryButton>

            {/* Resend + change email */}
            <div className="flex flex-col items-center gap-2.5 text-center">
              <button
                type="button"
                onClick={handleResend}
                disabled={loading || resendIn > 0}
                className="text-[13px] font-medium transition-all disabled:cursor-not-allowed"
                style={{ color: resendIn > 0 ? '#94A3B8' : '#64748B' }}
              >
                {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
              </button>

              <Divider />

              <button
                type="button"
                onClick={() => {
                  setStep('signup')
                  setDigits(Array(OTP_LENGTH).fill(''))
                  setVerificationToken('')
                  setError(null)
                }}
                className="flex items-center gap-1 text-[13px] font-medium transition-colors"
                style={{ color: '#64748B' }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 5l-7 7 7 7" />
                </svg>
                Change email address
              </button>
            </div>
          </div>
        )}

        {/* ── STEP: SUCCESS ── */}
        {step === 'success' && <SuccessScreen email={email} />}

      </div>
    </main>
  )
}
