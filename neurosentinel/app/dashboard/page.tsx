'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { AnalysisResults } from './_components/analysis-results'
import { UploadZone } from './_components/upload-zone'
import { getRoleLabel } from '@/lib/scout-guide'
import { ensureUserProfile } from '@/lib/user-profile'
import { StatusBadge } from './_components/status-badge'
import { SkeletonDashboardCard } from './_components/skeleton'
import { getAnalysisHeadline, useAnalysis } from '@/lib/context/analysis-context'
import { getReportHeadline, normalizeReport, normalizeReportStatus, type ReportRecord, type ScoutRole } from '@/lib/neurosentinel/types'

export default function DashboardPage() {
  const { currentAnalysis } = useAnalysis()
  const supabase = createClient()
  const [latestAnalysis, setLatestAnalysis] = useState<ReportRecord | null>(null)
  const [reportsLoading, setReportsLoading] = useState(true)
  const [role, setRole] = useState<ScoutRole>(null)
  const [userId, setUserId] = useState<string | null>(null)

  const loadDashboardContext = useCallback(async () => {
    // Don't overwrite latestAnalysis with stale DB data while an upload is running.
    if (currentAnalysis) return

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setReportsLoading(false)
        return
      }

      setUserId(user.id)
      const profile = await ensureUserProfile(supabase, user)
      setRole(profile.role)

      const { data, error } = await supabase
        .from('reports')
        .select('id, user_id, filename, status, summary, result_label, event_count, confidence_score, risk_level, quality_grade, duration_minutes, report_json, created_at, error_message')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)

      if (error) throw error
      setLatestAnalysis(Array.isArray(data) && data[0] ? normalizeReport(data[0]) : null)
    } catch (loadError) {
      console.error('[Dashboard] Failed to load dashboard context:', loadError)
    } finally {
      setReportsLoading(false)
    }
  }, [supabase, currentAnalysis])

  useEffect(() => {
    void loadDashboardContext()
  }, [loadDashboardContext])

  useEffect(() => {
    const status = normalizeReportStatus(latestAnalysis?.status)
    // Only poll the DB when a report is still pending/processing AND no active global analysis
    if (status !== 'pending' && status !== 'processing') return
    if (currentAnalysis) return

    let pollCount = 0
    let intervalId: number | null = null

    const startPolling = () => {
      if (document.hidden) return
      if (intervalId) return
      // Exponential back-off: 5s → 10s → 20s → capped at 30s
      const delayMs = Math.min(5000 * Math.pow(2, Math.floor(pollCount / 3)), 30_000)
      intervalId = window.setInterval(() => {
        if (document.hidden) return
        pollCount++
        void loadDashboardContext()
      }, delayMs)
    }

    const stopPolling = () => {
      if (intervalId) {
        window.clearInterval(intervalId)
        intervalId = null
      }
    }

    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling()
      } else {
        startPolling()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    startPolling()

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      stopPolling()
    }
  }, [latestAnalysis, loadDashboardContext, currentAnalysis])


  return (
    <>
      {/* ── Top Header Bar ── */}
      <header className="clinical-header">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/dashboard"
            className="text-[12px] font-medium transition-colors hover:text-[var(--accent-primary)] shrink-0"
            style={{ color: 'var(--text-muted)' }}
          >
            NeuroSentinel AI
          </Link>
          <span className="text-[10px]" style={{ color: 'var(--border-strong)' }}>&gt;</span>
          <span className="text-[14px] font-semibold" style={{ color: 'var(--text-heading)' }}>
            Dashboard
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: 'var(--accent-primary-light)', border: '1px solid rgba(14, 116, 144, 0.08)' }}>
            <span className="clinical-dot clinical-dot-primary" style={{ width: 6, height: 6 }} />
            <span className="text-[12px] font-semibold" style={{ color: 'var(--accent-primary)' }}>
              {getRoleLabel(role)}
            </span>
          </div>
        </div>
      </header>

      {/* ── Page Content — layered background ── */}
      <div className="clinical-fade-in clinical-page-content">
        <div className="clinical-page-container space-y-8">

          {/* ── Hero Section — elevated with depth ── */}
          <section className="clinical-hero">
            <div className="relative z-10 grid gap-6 lg:gap-12 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-end">
              <div className="clinical-hero-text-block">
                <div className="clinical-hero-tagline">Clinical EEG Intelligence</div>
                <h1 className="clinical-hero-title">
                  Upload your EEG.
                  <br />
                  Detect seizures.
                  <br />
                  <span>Understand every finding.</span>
                </h1>
                <p className="clinical-hero-desc">
                  NeuroSentinel AI analyses your EEG file, detects seizure events, maps brain activity, and generates a structured clinical report — then SCOUT walks you through every result in plain language.
                </p>
              </div>

              {/* ── Status Indicators ── */}
              <div className="grid gap-3">
                {/* Current Role */}
                <div className="clinical-status-pill">
                  <div className="clinical-metric-label">Current role</div>
                  <div className="mt-2 text-[14px] font-semibold" style={{ color: 'var(--text-heading)' }}>
                    {getRoleLabel(role)}
                  </div>
                </div>

                {/* Latest Status — filename wrapped separately to avoid overflow */}
                <div className={`clinical-status-pill ${currentAnalysis ? 'active' : ''}`}>
                  <div className="clinical-metric-label">Latest status</div>
                  <div className="mt-2 flex items-start gap-2 min-w-0">
                    {currentAnalysis && (
                      <span className="clinical-dot clinical-dot-primary clinical-dot-pulse flex-shrink-0 mt-[5px]" />
                    )}
                    <div className="min-w-0">
                      <div
                        className="text-[14px] font-semibold leading-snug"
                        style={{ color: currentAnalysis ? 'var(--accent-primary)' : 'var(--text-heading)', overflowWrap: 'break-word', wordBreak: 'break-word' }}
                      >
                        {currentAnalysis
                          ? getAnalysisHeadline(currentAnalysis.stage)
                          : latestAnalysis
                          ? getReportHeadline(latestAnalysis)
                          : 'Awaiting upload'}
                      </div>
                      {currentAnalysis && (
                        <div
                          className="mt-0.5 text-[12px] font-medium leading-snug"
                          style={{ color: 'var(--text-muted)', overflowWrap: 'break-word', wordBreak: 'break-all' }}
                        >
                          {currentAnalysis.filename}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

            {/* ── Upload Card ── */}
          <section id="tour-step-upload" className="clinical-card px-4 py-5 md:px-7 md:py-7">
            <div className="mb-6">
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                <div className="clinical-section-label">Upload EEG</div>
              </div>
              <p className="clinical-section-desc mt-1">
                Start a new analysis and let SCOUT track the result as it completes.
              </p>
            </div>

            <UploadZone
              onAnalysisComplete={(data) => {
                setLatestAnalysis(data)
              }}
              onReset={() => setLatestAnalysis(null)}
              shouldAutoRedirect
            />
          </section>

          {/* ── Latest Analysis Card — full width primary ── */}
          <section id="tour-step-latest" className="clinical-card px-4 py-5 md:px-7 md:py-7">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                  <div className="clinical-section-label">Latest Analysis</div>
                </div>
                <p className="clinical-section-desc mt-1">
                  {currentAnalysis ? 'Current upload in progress' : 'Your most recent EEG analysis'}
                </p>
              </div>
              {currentAnalysis ? (
                <StatusBadge status={currentAnalysis.stage === 'uploading' ? 'uploading' : 'processing'} showBorder />
              ) : latestAnalysis ? (
                <StatusBadge report={latestAnalysis} showBorder />
              ) : null}
            </div>

            <AnalysisResults data={latestAnalysis} />

            <div className="mt-6 pt-5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <Link href="/dashboard/eeg-reports" className="clinical-link">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                View Analysis History
              </Link>
            </div>
          </section>


          {/* ── Loading / Sign-in fallback ── */}
          {reportsLoading ? (
            <SkeletonDashboardCard />
          ) : userId ? null : (
            <div className="clinical-card px-7 py-6 text-[14px]" style={{ color: 'var(--text-secondary)' }}>
              <div className="flex items-center gap-3">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                Sign in to upload EEG files and track your analysis workflow.
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
