'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  createOptimisticScoutMessage,
  getReliabilityDetails,
  type ReportRecord,
  type ScoutContextPayload,
  type ScoutMessage,
  type ScoutPageData,
  type ScoutPageContext,
} from '@/lib/neurosentinel/types'

type ConversationState = {
  messages: ScoutMessage[]
  loading: boolean
  error: string | null
  loaded: boolean
  hasUnread: boolean
}

type FloatingConversationRequest = {
  page: ScoutPageContext
  role?: ScoutContextPayload['role']
  reportId?: string | null
  currentReport?: ReportRecord | null
  pageData?: ScoutPageData | null
  initialMessage: string
  token: string
}

type ContextValue = {
  conversations: Record<string, ConversationState>
  ensureConversation: (page: ScoutPageContext, reportId: string | null | undefined, initialMessage: string, stateKey?: string) => Promise<void>
  sendMessage: (options: {
    page: ScoutPageContext
    role?: ScoutContextPayload['role']
    reportId?: string | null
    currentReport?: ReportRecord | null
    pageData?: ScoutPageData | null
    initialMessage: string
    content: string
    silent?: boolean
    stateKey?: string
  }) => Promise<void>
  stopMessage: (page: ScoutPageContext, reportId: string | null | undefined, stateKey?: string) => void
  markRead: (page: ScoutPageContext, reportId: string | null | undefined, stateKey?: string) => void
  floatingConversation: FloatingConversationRequest | null
  presentFloatingConversation: (options: Omit<FloatingConversationRequest, 'token'>) => void
}

const ScoutContext = createContext<ContextValue | null>(null)

function getConversationKey(page: ScoutPageContext, reportId: string | null | undefined, stateKey?: string) {
  if (stateKey) return stateKey
  return reportId ? `${page}:${reportId}` : `${page}:global`
}

function getSeedMessages(page: ScoutPageContext, reportId: string | null | undefined, initialMessage: string) {
  const trimmed = initialMessage.trim()
  return trimmed ? [createOptimisticScoutMessage('assistant', trimmed, reportId, page)] : []
}

function serializeReport(report: ReportRecord | null | undefined) {
  if (!report) return null

  const reliability = getReliabilityDetails(report.confidence_score, report.duration_minutes, report.quality_grade)
  const reportKeywords = [
    report.result_label ? `Result: ${report.result_label}` : null,
    `Reliability: ${reliability.level}`,
    typeof report.confidence_score === 'number' ? `Confidence: ${report.confidence_score.toFixed(1)}%` : null,
    typeof report.duration_minutes === 'number' ? `Duration: ${report.duration_minutes.toFixed(1)} min` : null,
    report.risk_level ? `Risk: ${report.risk_level}` : null,
    report.quality_grade ? `Signal quality: ${report.quality_grade}` : null,
  ].filter((keyword): keyword is string => Boolean(keyword))

  return {
    id: report.id,
    filename: report.filename,
    status: report.status,
    summary: report.summary,
    result_label: report.result_label,
    event_count: report.event_count,
    confidence_score: report.confidence_score,
    risk_level: report.risk_level,
    quality_grade: report.quality_grade,
    duration_minutes: report.duration_minutes,
    reliability: reliability.level,
    reliability_reasons: reliability.reasons,
    report_keywords: reportKeywords,
    report_json: report.report_json,
    created_at: report.created_at,
  }
}

function serializePageData(pageData: ScoutPageData | null | undefined) {
  if (!pageData) return null

  return {
    latest_report: serializeReport(pageData.latestReport),
    recent_reports: Array.isArray(pageData.recentReports) ? pageData.recentReports.map((report) => serializeReport(report)).filter(Boolean) : [],
    stats: pageData.stats ?? null,
    summary: pageData.summary ?? null,
    active_analysis: pageData.activeAnalysis ?? null,
  }
}

export function ScoutProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<Record<string, ConversationState>>({})
  const [floatingConversation, setFloatingConversation] = useState<FloatingConversationRequest | null>(null)
  const loadingRef = useRef<Record<string, boolean>>({})
  const abortControllersRef = useRef<Record<string, AbortController | null>>({})
  const sessionIdRef = useRef<string | null>(null)

  // ── sessionStorage persistence helpers ──
  const STORAGE_PREFIX = 'scout_conversations_'

  const persistToStorage = useCallback((userId: string, convs: Record<string, ConversationState>) => {
    try {
      // Only persist messages and loaded state — skip transient fields
      const serializable: Record<string, { messages: ScoutMessage[]; loaded: boolean }> = {}
      for (const [key, state] of Object.entries(convs)) {
        if (state.loaded && state.messages.length > 0) {
          serializable[key] = { messages: state.messages, loaded: true }
        }
      }
      sessionStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(serializable))
    } catch {
      // sessionStorage quota or access error — non-fatal
    }
  }, [])

  const hydrateFromStorage = useCallback((userId: string): Record<string, ConversationState> => {
    try {
      const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${userId}`)
      if (!raw) return {}
      const parsed = JSON.parse(raw) as Record<string, { messages: ScoutMessage[]; loaded: boolean }>
      const hydrated: Record<string, ConversationState> = {}
      for (const [key, state] of Object.entries(parsed)) {
        if (Array.isArray(state.messages) && state.messages.length > 0) {
          hydrated[key] = {
            messages: state.messages,
            loading: false,
            error: null,
            loaded: true,
            hasUnread: false,
          }
        }
      }
      return hydrated
    } catch {
      return {}
    }
  }, [])

  const clearStorage = useCallback((userId?: string | null) => {
    try {
      if (userId) {
        sessionStorage.removeItem(`${STORAGE_PREFIX}${userId}`)
      }
      // Also clear any stale keys from other sessions
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i)
        if (key?.startsWith(STORAGE_PREFIX)) {
          sessionStorage.removeItem(key)
        }
      }
    } catch {
      // non-fatal
    }
  }, [])

  // ── Persist conversations to sessionStorage on every change ──
  const conversationsRef = useRef(conversations)
  conversationsRef.current = conversations
  useEffect(() => {
    const userId = sessionIdRef.current
    if (userId && Object.keys(conversations).length > 0) {
      persistToStorage(userId, conversations)
    }
  }, [conversations, persistToStorage])

  // ── Clear all conversations on sign-out / hydrate on sign-in ──
  useEffect(() => {
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const newUserId = session?.user?.id ?? null
      const prevSessionId = sessionIdRef.current

      // Handle sign-out or session end
      if (event === 'SIGNED_OUT' || !newUserId) {
        clearStorage(prevSessionId)
        sessionIdRef.current = null
        setConversations({})
        setFloatingConversation(null)
        loadingRef.current = {}
        Object.values(abortControllersRef.current).forEach((c) => c?.abort())
        abortControllersRef.current = {}
        return
      }

      // New login or user switch: hydrate from sessionStorage
      if (event === 'SIGNED_IN' || (newUserId && newUserId !== prevSessionId)) {
        sessionIdRef.current = newUserId
        const hydrated = hydrateFromStorage(newUserId)
        setConversations(hydrated)
        setFloatingConversation(null)
        loadingRef.current = {}
        Object.values(abortControllersRef.current).forEach((c) => c?.abort())
        abortControllersRef.current = {}
      }
    })
    return () => subscription.unsubscribe()
  }, [hydrateFromStorage, clearStorage])

  const ensureConversation = useCallback(async (page: ScoutPageContext, reportId: string | null | undefined, initialMessage: string, stateKey?: string) => {
    const key = getConversationKey(page, reportId, stateKey)
    if (loadingRef.current[key]) return
    if (conversations[key]?.loaded) return

    loadingRef.current[key] = true

    // Seed with initial greeting — sessionStorage may already have messages
    // which would be caught by the `loaded` check above
    setConversations((current) => ({
      ...current,
      [key]: {
        messages: getSeedMessages(page, reportId, initialMessage),
        loading: false,
        error: null,
        loaded: true,
        hasUnread: false,
      },
    }))

    loadingRef.current[key] = false
  }, [conversations])

  const sendMessage = useCallback<ContextValue['sendMessage']>(async ({ page, role = null, reportId = null, currentReport = null, pageData = null, initialMessage, content, silent = false, stateKey }) => {
    const trimmed = content.trim()
    if (!trimmed) return

    const key = getConversationKey(page, reportId, stateKey)
    await ensureConversation(page, reportId, initialMessage, stateKey)

    // When silent=true (auto-summarize), don't show the user message in the chat
    if (!silent) {
      setConversations((current) => {
        const existing = current[key] ?? {
          messages: getSeedMessages(page, reportId, initialMessage),
          loading: false,
          error: null,
          loaded: true,
          hasUnread: false,
        }
        return {
          ...current,
          [key]: {
            ...existing,
            messages: [...existing.messages, createOptimisticScoutMessage('user', trimmed, reportId, page)],
            loading: true,
            error: null,
            loaded: true,
          },
        }
      })
    } else {
      // Still set loading state but don't add user message
      setConversations((current) => {
        const existing = current[key] ?? {
          messages: getSeedMessages(page, reportId, initialMessage),
          loading: false,
          error: null,
          loaded: true,
          hasUnread: false,
        }
        return {
          ...current,
          [key]: { ...existing, loading: true, error: null, loaded: true },
        }
      })
    }

    try {
      const latestState = conversations[key]
      const optimisticMessages = [
        ...(latestState?.messages ?? getSeedMessages(page, reportId, initialMessage)),
        createOptimisticScoutMessage('user', trimmed, reportId, page),
      ]

      abortControllersRef.current[key]?.abort()
      const controller = new AbortController()
      abortControllersRef.current[key] = controller

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          messages: optimisticMessages.map((message) => ({ role: message.role, content: message.content })),
          context: {
            page,
            role,
            report_id: reportId,
            current_report: serializeReport(currentReport),
            page_data: serializePageData(pageData),
          },
        }),
      })
      const payload = await response.json()

      if (!response.ok) {
        throw new Error(payload.error || 'SCOUT could not respond right now.')
      }

      setConversations((current) => {
        const existing = current[key]
        const assistantMessage = createOptimisticScoutMessage(
          'assistant',
          typeof payload.message === 'string' && payload.message.trim() ? payload.message : 'I do not have a reliable answer yet.',
          reportId,
          page
        )
        return {
          ...current,
          [key]: {
            ...(existing ?? { messages: optimisticMessages, loading: false, error: null, loaded: true, hasUnread: false }),
            messages: [...(existing?.messages ?? optimisticMessages), assistantMessage],
            loading: false,
            error: null,
            loaded: true,
            hasUnread: true, // New message arrived
          },
        }
      })
    } catch (error: any) {
      const isAbort = error?.name === 'AbortError'
      setConversations((current) => ({
        ...current,
        [key]: {
          ...(current[key] ?? { messages: [], loading: false, error: null, loaded: true, hasUnread: false }),
          messages: [
            ...((current[key] ?? { messages: [] }).messages || []),
            createOptimisticScoutMessage(
              'assistant',
              isAbort ? 'Stopped.' : error?.message || 'SCOUT could not respond right now. Try again.',
              reportId,
              page,
              !isAbort
            ),
          ],
          loading: false,
          error: null,
          loaded: true,
          hasUnread: !isAbort, // Only mark as unread if it wasn't an intentional stop
        },
      }))
    } finally {
      abortControllersRef.current[key] = null
    }
  }, [conversations, ensureConversation])

  const stopMessage = useCallback((page: ScoutPageContext, reportId: string | null | undefined, stateKey?: string) => {
    const key = getConversationKey(page, reportId, stateKey)
    abortControllersRef.current[key]?.abort()
  }, [])

  const markRead = useCallback((page: ScoutPageContext, reportId: string | null | undefined, stateKey?: string) => {
    const key = getConversationKey(page, reportId, stateKey)
    setConversations((current) => {
      const existing = current[key]
      if (!existing || !existing.hasUnread) return current
      return {
        ...current,
        [key]: { ...existing, hasUnread: false },
      }
    })
  }, [])

  const value = useMemo<ContextValue>(
    () => ({
      conversations,
      ensureConversation,
      sendMessage,
      stopMessage,
      markRead,
      floatingConversation,
      presentFloatingConversation: (options) => {
        setFloatingConversation({
          ...options,
          token: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        })
      },
    }),
    [conversations, ensureConversation, floatingConversation, sendMessage, stopMessage, markRead]
  )

  return <ScoutContext.Provider value={value}>{children}</ScoutContext.Provider>
}

export function useScoutFloatingConversation() {
  const context = useContext(ScoutContext)

  if (!context) {
    throw new Error('useScoutFloatingConversation must be used inside ScoutProvider.')
  }

  return {
    floatingConversation: context.floatingConversation,
    presentFloatingConversation: context.presentFloatingConversation,
  }
}

export function useScoutConversation({
  page,
  role = null,
  reportId = null,
  currentReport = null,
  pageData = null,
  stateKey,
  initialMessage,
}: {
  page: ScoutPageContext
  role?: ScoutContextPayload['role']
  reportId?: string | null
  currentReport?: ReportRecord | null
  pageData?: ScoutPageData | null
  stateKey?: string
  initialMessage: string
}) {
  const context = useContext(ScoutContext)

  if (!context) {
    throw new Error('useScoutConversation must be used inside ScoutProvider.')
  }

  const key = getConversationKey(page, reportId, stateKey)
  const state = context.conversations[key] ?? {
    messages: getSeedMessages(page, reportId, initialMessage),
    loading: false,
    error: null,
    loaded: false,
    hasUnread: false,
  }

  useEffect(() => {
    void context.ensureConversation(page, reportId, initialMessage, stateKey)
  }, [context, initialMessage, page, reportId, stateKey])

  return {
    messages: state.messages,
    loading: state.loading,
    error: state.error,
    hasUnread: state.hasUnread,
    sendMessage: (content: string, silent?: boolean) => context.sendMessage({ page, role, reportId, currentReport, pageData, initialMessage, content, silent, stateKey }),
    stopMessage: () => context.stopMessage(page, reportId, stateKey),
    markRead: () => context.markRead(page, reportId, stateKey),
  }
}
