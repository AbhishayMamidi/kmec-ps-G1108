'use client'

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ScoutAvatar } from './scout-avatar'
import { ScoutConversation } from './scout-conversation'
import { ensureUserProfile } from '@/lib/user-profile'
import { useAnalysis } from '@/lib/context/analysis-context'
import { useScoutFloatingConversation, useScoutConversation } from './scout-provider'
import {
  SCOUT_FULL_NAME,
  getQuickPrompts,
  getScoutInitialMessage,
  normalizeScoutRole,
  type ScoutPageContext,
  type ScoutRole,
} from '@/lib/scout-guide'
import { normalizeReport, type ReportRecord, type ScoutPageData } from '@/lib/neurosentinel/types'

const STORAGE_KEY = 'ns-scout-floating-layout'
const HINT_KEY = 'ns-scout-hint-shown-v1'
const MIN_WIDTH = 320
const MIN_HEIGHT = 420
const DEFAULT_WIDTH = 380
const DEFAULT_HEIGHT = 520
const MAX_WIDTH = 600

type FloatingLayout = {
  left: number
  top: number
  width: number
  height: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getDefaultLayout(): FloatingLayout {
  if (typeof window === 'undefined') {
    return { left: 0, top: 0, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
  }

  const width = DEFAULT_WIDTH
  const height = Math.min(DEFAULT_HEIGHT, Math.floor(window.innerHeight * 0.8))
  return {
    left: window.innerWidth - width - 24,
    top: window.innerHeight - height - 24,
    width,
    height,
  }
}

function normalizeLayout(layout: FloatingLayout): FloatingLayout {
  if (typeof window === 'undefined') return layout

  const maxHeight = Math.floor(window.innerHeight * 0.8)
  const width = clamp(layout.width, MIN_WIDTH, MAX_WIDTH)
  const height = clamp(layout.height, MIN_HEIGHT, maxHeight)
  
  const minVisible = 60
  const left = clamp(layout.left, -width + minVisible, window.innerWidth - minVisible)
  const top = clamp(layout.top, -minVisible, window.innerHeight - minVisible)

  return { left, top, width, height }
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

export function ScoutFloating() {
  const pathname = usePathname()
  const supabase = createClient()
  const { floatingConversation } = useScoutFloatingConversation()
  const [open, setOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [role, setRole] = useState<ScoutRole>(null)
  const [layout, setLayout] = useState<FloatingLayout>(() => getDefaultLayout())
  const [isDragging, setIsDragging] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [session, setSession] = useState<{
    page: ScoutPageContext
    role?: ScoutRole
    reportId?: string | null
    currentReport?: ReportRecord | null
    pageData?: ScoutPageData | null
    initialMessage: string
  } | null>(null)
  const [pageData, setPageData] = useState<ScoutPageData | null>(null)
  const { currentAnalysis } = useAnalysis()
  const resizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null)
  const userIdRef = useRef<string | null>(null)

  const hidden = pathname === '/' || pathname === '/login' || pathname === '/onboarding' || pathname === '/terms' || pathname === '/privacy' || pathname.startsWith('/report/') || pathname === '/dashboard/eeg-reports/compare'

  const pageContext = useMemo<ScoutPageContext>(() => {
    if (pathname === '/dashboard/settings') return 'settings'
    if (pathname === '/dashboard/eeg-reports') return 'history'
    if (pathname.startsWith('/dashboard')) return 'dashboard'
    return 'general'
  }, [pathname])

  const reportIdFromPath = pathname.startsWith('/dashboard/report/') ? pathname.split('/').pop() : null

  const activeSessionInput = session ?? {
    page: pageContext,
    role,
    reportId: reportIdFromPath,
    currentReport: null,
    pageData,
    initialMessage: getScoutInitialMessage(role, pageContext),
  }

  // Use the hook to get collective loading/unread status
  // We use a constant stateKey to ensure the chat is persistent across page changes
  const { loading, hasUnread, markRead } = useScoutConversation({
    page: activeSessionInput.page,
    role: activeSessionInput.role,
    reportId: activeSessionInput.reportId,
    currentReport: activeSessionInput.currentReport ?? null,
    pageData: activeSessionInput.pageData ?? null,
    initialMessage: activeSessionInput.initialMessage,
    stateKey: 'persistent-scout',
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as FloatingLayout
      setLayout(normalizeLayout(parsed))
    } catch {}

    const hintShown = window.localStorage.getItem(HINT_KEY)
    if (!hintShown) {
      setTimeout(() => setShowHint(true), 1500)
      setTimeout(() => setShowHint(false), 8000)
      window.localStorage.setItem(HINT_KEY, 'true')
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeLayout(layout)))
  }, [layout])

  useEffect(() => {
    if (hidden) return

    async function loadRole() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user || (pageContext !== 'dashboard' && pageContext !== 'settings' && pageContext !== 'history')) {
          setRole(null)
          return
        }

        const profile = await ensureUserProfile(supabase, user)
        setRole(normalizeScoutRole(profile.role))
      } catch (error) {
        console.error('[ScoutFloating] Failed to load role:', error)
        setRole(null)
      }
    }

    void loadRole()
  }, [hidden, pageContext, supabase])

  useEffect(() => {
    if (!floatingConversation) return

    setSession({
      page: floatingConversation.page,
      role: floatingConversation.role ?? null,
      reportId: floatingConversation.reportId ?? null,
      currentReport: floatingConversation.currentReport ?? null,
      pageData: floatingConversation.pageData ?? null,
      initialMessage: floatingConversation.initialMessage,
    })
    setOpen(true)
    setIsClosing(false)
  }, [floatingConversation])

  useEffect(() => {
    if (hidden) return

    async function loadPageData() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user || (pageContext !== 'dashboard' && pageContext !== 'history' && pageContext !== 'settings')) {
          setPageData(null)
          return
        }

        const { data, error } = await supabase
          .from('reports')
          .select('id, user_id, filename, status, storage_path, error_message, summary, result_label, event_count, confidence_score, risk_level, quality_grade, duration_minutes, report_json, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(pageContext === 'history' ? 8 : 5)

        if (error) throw error

        const reports = Array.isArray(data) ? data.map((report) => normalizeReport(report)) : []
        const stats = {
          totalReports: reports.length,
          completedReports: reports.filter((report) => report.status === 'completed').length,
          processingReports: reports.filter((report) => report.status === 'processing' || report.status === 'pending').length,
          failedReports: reports.filter((report) => report.status === 'failed').length,
        }

        const activeJobSummary = currentAnalysis
          ? ` An EEG file "${currentAnalysis.filename}" is currently ${currentAnalysis.stage === 'uploading' ? `uploading (${currentAnalysis.uploadProgress || 0}% complete)` : 'being processed by the AI backend'}.`
          : ''

        const summary =
          pageContext === 'history'
            ? reports.length
              ? `Analysis history is open with ${reports.length} recent report${reports.length === 1 ? '' : 's'} available for review.${activeJobSummary}`
              : `Analysis history is open, but no reports are available yet.${activeJobSummary}`
            : pageContext === 'settings'
              ? 'Settings page is open. SCOUT should answer with awareness of the user role and recent report state.'
              : reports[0]
                ? `Latest dashboard analysis is ${reports[0].result_label || reports[0].status} for ${reports[0].filename}.${activeJobSummary}`
                : `Dashboard is open and waiting for the first EEG upload.${activeJobSummary}`

        setPageData({
          latestReport: reports[0] ?? null,
          recentReports: reports,
          stats,
          summary,
          activeAnalysis: currentAnalysis ? {
            filename: currentAnalysis.filename,
            status: currentAnalysis.stage,
            progress: currentAnalysis.uploadProgress,
            startedAt: currentAnalysis.startedAt,
          } : null,
        })
      } catch (error) {
        console.error('[ScoutFloating] Failed to load page context:', error)
        setPageData(null)
      }
    }

    void loadPageData()
  }, [hidden, pageContext, supabase, currentAnalysis])

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user?.id ?? null
      if (!nextUserId || (userIdRef.current && userIdRef.current !== nextUserId)) {
        setSession(null)
        setOpen(false)
        setIsClosing(false)
        setRole(null)
        setPageData(null)
      }
      userIdRef.current = nextUserId
    })

    void supabase.auth.getUser().then(({ data: { user } }) => {
      userIdRef.current = user?.id ?? null
    })

    return () => subscription.unsubscribe()
  }, [supabase])

  // --- Mark Read Condition (Part 3) ---
  useEffect(() => {
    if (hasUnread && open) {
      // User opened SCOUT panel, clear dot
      markRead()
    } else if (hasUnread && !open && reportIdFromPath) {
      // User is viewing the report directly, auto-read
      markRead()
    }
  }, [hasUnread, open, reportIdFromPath, markRead])

  useEffect(() => {
    const handleResize = () => setLayout((current) => normalizeLayout(current))
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    const handlePointerUp = () => {
      resizeRef.current = null
      document.body.style.cursor = 'default'
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!resizeRef.current) return

      const maxHeight = Math.floor(window.innerHeight * 0.8)
      const nextWidth = clamp(resizeRef.current.width + (event.clientX - resizeRef.current.startX), MIN_WIDTH, MAX_WIDTH)
      const nextHeight = clamp(resizeRef.current.height + (event.clientY - resizeRef.current.startY), MIN_HEIGHT, maxHeight)
      setLayout((current) => normalizeLayout({ ...current, width: nextWidth, height: nextHeight }))
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [])

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(true)

    const offsetX = event.clientX - layout.left
    const offsetY = event.clientY - layout.top

    const handleMouseMove = (moveEvent: MouseEvent) => {
      setLayout((current) =>
        normalizeLayout({
          ...current,
          left: moveEvent.clientX - offsetX,
          top: moveEvent.clientY - offsetY,
        })
      )
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const handleTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    if (!touch) return
    setIsDragging(true)

    const offsetX = touch.clientX - layout.left
    const offsetY = touch.clientY - layout.top

    const handleTouchMove = (touchEvent: TouchEvent) => {
      const nextTouch = touchEvent.touches[0]
      if (!nextTouch) return
      touchEvent.preventDefault()
      setLayout((current) =>
        normalizeLayout({
          ...current,
          left: nextTouch.clientX - offsetX,
          top: nextTouch.clientY - offsetY,
        })
      )
    }

    const handleTouchEnd = () => {
      setIsDragging(false)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
    }

    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleTouchEnd)
  }

  const handleClose = () => {
    setIsClosing(true)
    setTimeout(() => {
      setOpen(false)
      setIsClosing(false)
      setSession(null)
    }, 200)
  }

  if (hidden) return null

  const activeSession = session ?? activeSessionInput

  const quickPrompts = getQuickPrompts(activeSession.page)

  const isResponseReady = hasUnread && !open

  return (
    <>
      <style jsx global>{`
        @keyframes scout-pulse-ready {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        @keyframes scout-glow-ready {
          0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5), 0 8px 20px rgba(59, 130, 246, 0.25); }
          70% { box-shadow: 0 0 0 12px rgba(59, 130, 246, 0), 0 8px 20px rgba(59, 130, 246, 0.25); }
          100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0), 0 8px 20px rgba(59, 130, 246, 0.25); }
        }
      `}</style>

      {!open ? (
        <div
          className="fixed right-8 z-[9999] flex flex-col items-end gap-3 transition-all duration-300"
          style={{
            bottom: pathname.includes('eeg-reports') && currentAnalysis
              ? 128  // raised above sticky processing panel (~96px)
              : typeof window !== 'undefined' && window.innerWidth <= 768 ? 20 : 32,
          right: typeof window !== 'undefined' && window.innerWidth <= 768 ? 16 : undefined,
          }}
        >
          {showHint && !isResponseReady && (
            <div className="mr-2 animate-in fade-in slide-in-from-bottom-2 duration-500 rounded-xl bg-[#1E293B] px-4 py-2 text-xs font-medium text-white shadow-lg after:absolute after:bottom-[-6px] after:right-6 after:h-0 after:w-0 after:border-l-[6px] after:border-r-[6px] after:border-t-[6px] after:border-l-transparent after:border-r-transparent after:border-t-[#1E293B] relative">
              Need help understanding your EEG?
            </div>
          )}

          <div className="relative group">
            <div className="absolute bottom-full right-0 mb-3 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
              <div className="rounded bg-gray-800 px-3 py-1.5 text-[11px] font-medium text-white shadow-xl">
                {isResponseReady ? 'Click to view intelligence' : 'Ask SCOUT (Clinical Intelligence)'}
              </div>
            </div>

            <div className="absolute inset-0 z-0">
               {loading && (
                 <div className="absolute inset-0 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin opacity-40" />
               )}
            </div>

            <button
              id="scout-floating-trigger"
              type="button"
              onClick={() => {
                setOpen(true)
                setIsClosing(false)
                setShowHint(false)
              }}
              className="relative z-10 flex h-[56px] w-[56px] md:h-[70px] md:w-[70px] items-center justify-center rounded-full transition-all hover:scale-105 active:scale-90 ring-2 ring-white/60 ring-inset"
              style={{
                background: 'linear-gradient(135deg, #3B82F6, #06B6D4)',
                animation: isResponseReady ? 'scout-pulse-ready 2.2s ease-in-out infinite, scout-glow-ready 2.2s ease-in-out infinite' : undefined,
                boxShadow: isResponseReady ? undefined : '0 8px 20px rgba(59, 130, 246, 0.25)',
              }}
              aria-label={`Open ${SCOUT_FULL_NAME}`}
            >
              <ScoutAvatar size={typeof window !== 'undefined' && window.innerWidth <= 768 ? 32 : 42} variant="primary" showStatus={!isResponseReady} />
              
              {isResponseReady && (
                <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-[#10B981] border-2 border-white shadow-md animate-bounce" />
              )}
            </button>
          </div>
        </div>
      ) : null}

      {open ? (
        <div
          className={`fixed z-[9998] flex flex-col overflow-hidden rounded-[14px] border transition-all duration-300 ease-out origin-bottom-right ${isClosing ? 'opacity-0 scale-95 translate-y-4' : 'opacity-100 scale-100 animate-in fade-in zoom-in-95 slide-in-from-bottom-4'} group/panel`}
          style={{
            ...(typeof window !== 'undefined' && window.innerWidth <= 768
              ? { left: 0, top: 0, width: '100vw', height: '100dvh', borderRadius: 0 }
              : { left: layout.left, top: layout.top, width: layout.width, height: layout.height }
            ),
            background: 'linear-gradient(to bottom, #FFFFFF, #F8FAFC)',
            borderColor: '#E5E7EB',
            boxShadow: isDragging ? '0 20px 50px rgba(0,0,0,0.12)' : '0 10px 30px rgba(0,0,0,0.08)',
          }}
        >
          <div
            className={`sticky top-0 z-30 shrink-0 select-none flex items-center justify-between border-b px-5 py-4 bg-white/60 backdrop-blur-md transition-colors ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
          >
            <div className="flex items-center gap-3">
              <ScoutAvatar size={24} variant="primary" />
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-[#1E293B] leading-tight">
                  SCOUT · Clinical Intelligence Assistant
                </span>
                <span className="text-[10px] text-[#6B7280] font-medium tracking-tight">
                  Seizure Clinical Operations & Understanding Tool
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleClose}
              className="rounded-full p-1.5 transition-colors hover:bg-gray-100 text-gray-400 hover:text-[#1E293B]"
              aria-label="Close"
              title="Close"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="min-h-0 flex-1 bg-transparent overflow-hidden">
            <ScoutConversation
              page={activeSession.page}
              role={activeSession.role ?? null}
              reportId={activeSession.reportId ?? null}
              currentReport={activeSession.currentReport ?? null}
              pageData={activeSession.pageData ?? pageData}
              initialMessage={activeSession.initialMessage}
              quickPrompts={quickPrompts}
              stateKey="persistent-scout"
            />
          </div>

          <button
            type="button"
            aria-label="Resize SCOUT window"
            className="absolute bottom-0 right-0 z-30 h-6 w-6 cursor-se-resize items-center justify-center transition-opacity opacity-40 hover:opacity-100 hidden md:flex"
            onPointerDown={(event) => {
              event.stopPropagation()
              resizeRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                width: layout.width,
                height: layout.height,
              }
              document.body.style.cursor = 'se-resize'
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2.5" strokeLinecap="round">
              <line x1="22" y1="7" x2="7" y2="22" />
              <line x1="22" y1="15" x2="15" y2="22" />
            </svg>
          </button>
        </div>
      ) : null}
    </>
  )
}
