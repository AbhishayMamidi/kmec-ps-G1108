'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'

const TOUR_STEPS = [
  {
    route: '/dashboard',
    targetId: 'tour-step-upload',
    message: "This is where you upload EEG files. I'll analyze the incoming signals and instantly detect potential seizure patterns.",
  },
  {
    route: '/dashboard/eeg-reports',
    targetId: 'nav-eeg-reports',
    message: "Here you can access your entire analysis history and track neurological results over time.",
  },
  {
    route: '/dashboard/eeg-reports',
    targetId: 'tour-step-compare',
    message: "Use the Compare feature to select any two completed EEG reports side-by-side to track clinical progress, compare risk levels, and evaluate changes.",
  },
  {
    route: '/dashboard',
    targetId: 'tour-step-latest',
    message: "After processing, I automatically generate a highly structured clinical report equipped with insights for review.",
  },
  {
    route: '/dashboard/settings',
    targetId: 'nav-settings',
    message: "Here in Settings, you can configure your clinical preferences, manage data access securely, and update your profile.",
  },
  {
    route: '/dashboard',
    targetId: 'scout-floating-trigger',
    message: "This is where I stay, and yeah this is how I look. You can click here to ask me questions about your EEG data anytime.",
  },
  {
    route: '/dashboard',
    targetId: null, // Center screen
    message: "You're all set. Upload your first EEG to begin.",
    isFinal: true
  }
]

// Compute highlight rect from a DOM element with padding
function computeHighlight(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  return {
    top: rect.top - 10,
    left: rect.left - 10,
    width: rect.width + 20,
    height: rect.height + 20,
  }
}

export function ScoutTour() {
  const router = useRouter()
  const pathname = usePathname()

  const [tourState, setTourState] = useState({
    isActive: false,
    currentStep: 0
  })

  const [highlightStyle, setHighlightStyle] = useState<Record<string, number>>({})
  const [isNavigating, setIsNavigating] = useState(false)

  // Ref to the currently highlighted DOM element — persists across renders
  const activeTargetRef = useRef<HTMLElement | null>(null)

  // Initialization & Manual trigger
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const pendingTour = window.sessionStorage.getItem('ns-pending-tour')
      if (pendingTour === 'true') {
        setTourState({ isActive: true, currentStep: 0 })
        window.sessionStorage.removeItem('ns-pending-tour')
        window.sessionStorage.setItem('ns-scout-tour-complete', 'true')
        window.localStorage.setItem('hasCompletedTour', 'true')
      }
    }
  }, [])

  useEffect(() => {
    const handleRestart = () => {
      setTourState({ isActive: true, currentStep: 0 })
    }
    window.addEventListener('ns-restart-tour', handleRestart)
    return () => window.removeEventListener('ns-restart-tour', handleRestart)
  }, [])

  // ── Resize & Scroll: recalculate highlight position dynamically ──────────────
  // Runs whenever step changes or tour becomes active.
  // Attaches to resize (viewport changes) and scroll (capture: catches any
  // nested scrollable container, not just window).
  useEffect(() => {
    if (!tourState.isActive) return

    const recalc = () => {
      const el = activeTargetRef.current
      if (!el) return
      setHighlightStyle(computeHighlight(el))
    }

    window.addEventListener('resize', recalc)
    window.addEventListener('scroll', recalc, true) // capture phase

    return () => {
      window.removeEventListener('resize', recalc)
      window.removeEventListener('scroll', recalc, true)
    }
  }, [tourState.isActive, tourState.currentStep])

  // ── Main State Machine: Navigation & Element Targeting ───────────────────────
  useEffect(() => {
    if (!tourState.isActive) {
      document.body.style.overflow = ''
      document.querySelectorAll('.tour-highlight').forEach(el => {
        el.classList.remove('tour-highlight')
        ;(el as HTMLElement).style.zIndex = ''
        ;(el as HTMLElement).style.position = ''
        ;(el as HTMLElement).style.pointerEvents = ''
      })
      activeTargetRef.current = null
      return
    }

    const step = TOUR_STEPS[tourState.currentStep]
    if (!step) return

    // 1. Handle cross-page navigation
    const normalizedPath = pathname === '/' ? '/' : pathname.replace(/\/$/, '')
    const targetRoute = step.route === '/' ? '/' : step.route.replace(/\/$/, '')

    if (normalizedPath !== targetRoute) {
      setIsNavigating(true)
      router.push(targetRoute)
      return
    }

    setIsNavigating(false)
    document.body.style.overflow = 'hidden'

    let checkTimer: ReturnType<typeof setTimeout>
    let attempts = 0

    const cleanupTarget = () => {
      document.querySelectorAll('.tour-highlight').forEach(el => {
        el.classList.remove('tour-highlight')
        ;(el as HTMLElement).style.zIndex = ''
        ;(el as HTMLElement).style.position = ''
        ;(el as HTMLElement).style.pointerEvents = ''
      })
      activeTargetRef.current = null
    }

    const findTarget = () => {
      cleanupTarget()

      if (!step.targetId) {
        setHighlightStyle({})
        return
      }

      const target = document.getElementById(step.targetId)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })

        // Wait for scroll to settle, then measure and store element
        setTimeout(() => {
          target.classList.add('tour-highlight')
          target.style.zIndex = '51'
          const currentPos = window.getComputedStyle(target).position
          if (currentPos === 'static') target.style.position = 'relative'
          target.style.pointerEvents = 'none'

          // Store ref for dynamic recalculation on resize/scroll
          activeTargetRef.current = target
          setHighlightStyle(computeHighlight(target))
        }, 50)
      } else {
        attempts++
        if (attempts < 50) {
          checkTimer = setTimeout(findTarget, 100)
        } else {
          setHighlightStyle({}) // Safe fallback if element never renders
        }
      }
    }

    findTarget()

    return () => {
      clearTimeout(checkTimer)
    }
  }, [tourState.isActive, tourState.currentStep, pathname, router])

  if (!tourState.isActive) return null

  const handleFinish = () => {
    setTourState({ ...tourState, isActive: false })
    window.localStorage.setItem('hasCompletedTour', 'true')
    document.body.style.overflow = ''
    document.querySelectorAll('.tour-highlight').forEach(el => {
      el.classList.remove('tour-highlight')
      ;(el as HTMLElement).style.zIndex = ''
      ;(el as HTMLElement).style.position = ''
      ;(el as HTMLElement).style.pointerEvents = ''
    })
    activeTargetRef.current = null
  }

  const step = TOUR_STEPS[tourState.currentStep]
  const highlightHasBounds = Object.keys(highlightStyle).length > 0

  return (
    <>
      {/* Hide scout widget unless we are showing it off */}
      {step?.targetId !== 'scout-floating-trigger' && (
        <style dangerouslySetInnerHTML={{ __html: `
          #scout-floating-trigger {
            opacity: 0 !important;
            pointer-events: none !important;
            transform: scale(0.8) !important;
            transition: all 0.3s ease !important;
          }
        `}} />
      )}

      {/* Dim Overlay */}
      <div className="fixed inset-0 z-50 pointer-events-auto" />

      {/* Dynamic highlight box — position recalculates on resize/scroll */}
      {highlightHasBounds ? (
        <div
          className="fixed z-[52] rounded-2xl border-[3px] border-[#10B981] shadow-[0_0_0_9999px_rgba(0,0,0,0.6),0_0_20px_rgba(16,185,129,0.5)] pointer-events-none"
          style={{
            ...highlightStyle,
            transition: 'top 0.15s ease, left 0.15s ease, width 0.15s ease, height 0.15s ease',
          }}
        />
      ) : (
        <div className="fixed inset-0 z-[52] bg-[rgba(0,0,0,0.6)] pointer-events-none transition-all duration-300" />
      )}

      {/* Scout Guide Panel */}
      <ScoutGuide
        tourState={tourState}
        setTourState={setTourState}
        handleFinish={handleFinish}
        isNavigating={isNavigating}
      />
    </>
  )
}

function ScoutGuide({ tourState, setTourState, handleFinish, isNavigating }: {
  tourState: { isActive: boolean; currentStep: number }
  setTourState: (s: { isActive: boolean; currentStep: number }) => void
  handleFinish: () => void
  isNavigating: boolean
}) {
  const step = TOUR_STEPS[tourState.currentStep]

  if (!step) {
    handleFinish()
    return null
  }

  const messageText = isNavigating ? "Moving across workspace..." : step.message

  return (
    <div
      className="fixed z-[60]"
      style={{
        bottom: '80px',
        right: '40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '20px'
      }}
    >
      <div
        className="w-[340px] rounded-2xl bg-white shadow-[0_15px_40px_rgba(0,0,0,0.25)] border border-gray-100 px-7 py-6 flex flex-col gap-4 animate-in fade-in zoom-in duration-300"
        style={{ transformOrigin: 'bottom right' }}
      >
        <div className="flex items-center gap-2.5 mb-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10" /><path d="M12 12 21 3" /><path d="M16 3h5v5" /></svg>
          <span className="text-[12px] font-bold tracking-[0.15em] text-[#10B981] uppercase">SCOUT Assistant</span>
        </div>

        <div className="text-[15px] text-[#334155] leading-relaxed font-medium">
          {messageText}
        </div>

        {/* Step counter */}
        <div className="text-[11px] text-gray-400 font-medium">
          Step {tourState.currentStep + 1} of {TOUR_STEPS.length}
        </div>

        <div className="mt-1 flex items-center justify-end">
          {!step.isFinal ? (
            <button
              onClick={() => setTourState({ ...tourState, currentStep: tourState.currentStep + 1 })}
              disabled={isNavigating}
              className="px-6 py-2.5 rounded-xl bg-[#0F172A] text-white text-[13.5px] font-bold shadow-sm hover:-translate-y-0.5 active:scale-95 disabled:opacity-50 transition-all"
            >
              Next &rarr;
            </button>
          ) : (
            <button
              onClick={handleFinish}
              className="w-full py-3 rounded-xl bg-[linear-gradient(180deg,#10B981,#059669)] text-white text-[14.5px] font-bold shadow-md hover:-translate-y-0.5 active:scale-95 text-center flex items-center justify-center gap-2 group transition-all"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:-translate-y-1 group-hover:translate-x-0.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              Get Started
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
