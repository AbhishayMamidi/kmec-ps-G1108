'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const DISMISSED_KEY = 'ns-name-prompt-dismissed'

/**
 * A lightweight overlay that asks existing users (who have no full_name set)
 * to provide their name. Appears once on dashboard, can be dismissed.
 */
export function NamePrompt() {
  const supabase = createClient()
  const [show, setShow] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [closing, setClosing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Don't show if already dismissed this session
    if (typeof window !== 'undefined' && window.sessionStorage.getItem(DISMISSED_KEY)) return

    async function check() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data } = await supabase
          .from('users')
          .select('full_name')
          .eq('id', user.id)
          .maybeSingle()

        if (!data?.full_name) {
          setShow(true)
        }
      } catch {}
    }

    void check()
  }, [supabase])

  useEffect(() => {
    if (show && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 400)
    }
  }, [show])

  const dismiss = () => {
    setClosing(true)
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(DISMISSED_KEY, 'true')
    }
    setTimeout(() => setShow(false), 250)
  }

  const handleSubmit = async () => {
    const trimmed = nameValue.trim()
    if (!trimmed) return

    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('users').update({ full_name: trimmed }).eq('id', user.id)
        await supabase.auth.updateUser({ data: { full_name: trimmed } })
      }
    } catch {}

    setSaving(false)
    setClosing(true)
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(DISMISSED_KEY, 'true')
    }
    // Reload the page so sidebar picks up the new name
    setTimeout(() => window.location.reload(), 300)
  }

  if (!show) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[10000] bg-black/20 backdrop-blur-[2px] transition-opacity duration-300 ${closing ? 'opacity-0' : 'opacity-100'}`}
        onClick={dismiss}
      />

      {/* Card */}
      <div
        className={`fixed z-[10001] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[420px] rounded-2xl border bg-white shadow-2xl transition-all duration-300 ${closing ? 'opacity-0 scale-95' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95'}`}
        style={{ borderColor: '#E2E8F0' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-5" style={{ borderColor: '#F1F5F9' }}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg, #3B82F6, #06B6D4)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <div>
              <div className="text-[10px] font-bold tracking-[0.15em] text-[#10B981] uppercase">SCOUT</div>
              <div className="text-[15px] font-bold text-[#0F172A]" style={{ fontFamily: "'Inter', sans-serif" }}>Quick Profile Update</div>
            </div>
          </div>

          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg p-1.5 text-[#94A3B8] transition-colors hover:bg-[#F1F5F9] hover:text-[#475569]"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          <p className="text-[14px] leading-relaxed text-[#475569]" style={{ fontFamily: "'Inter', sans-serif" }}>
            Hey there! We&apos;ve added name personalization to NeuroSentinel AI. Could you let us know your name so we can make your experience more personal?
          </p>

          <form
            onSubmit={(e) => { e.preventDefault(); void handleSubmit() }}
            className="mt-5 flex items-center gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              placeholder="Enter your name…"
              className="flex-1 rounded-xl border px-4 py-3 text-[14px] text-[#0F172A] shadow-sm outline-none transition-all placeholder:text-[#94A3B8] focus:border-[#10B981] focus:ring-2 focus:ring-[#10B981]/20"
              style={{ borderColor: '#E2E8F0', background: '#FAFBFC' }}
            />
            <button
              type="submit"
              disabled={!nameValue.trim() || saving}
              className="shrink-0 rounded-xl px-5 py-3 text-[14px] font-bold text-white shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, #10B981, #059669)' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </form>

          <button
            type="button"
            onClick={dismiss}
            className="mt-3 w-full text-center text-[12px] font-medium text-[#94A3B8] transition-colors hover:text-[#64748B]"
          >
            Skip for now
          </button>
        </div>
      </div>
    </>
  )
}
