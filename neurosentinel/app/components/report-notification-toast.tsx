'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { normalizeReportStatus } from '@/lib/neurosentinel/types'
import { useReportNotification, ReportNotification } from './report-notification-provider'

export function ReportNotificationToast() {
  const { notifications } = useReportNotification()
  const pathname = usePathname()

  // Determine if user is currently on the main dashboard upload page
  const isOnDashboard = pathname === '/dashboard'

  if (notifications.length === 0) return null

  return (
    <div className="fixed right-5 top-5 z-[9999] flex flex-col gap-3">
      {notifications.slice().reverse().map((n) => (
        <SingleToast key={n.jobId} notification={n} isOnDashboard={isOnDashboard} />
      ))}
    </div>
  )
}

function SingleToast({ notification, isOnDashboard }: { notification: ReportNotification; isOnDashboard: boolean }) {
  const { updateNotification, dismissNotification } = useReportNotification()
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Only poll if processing or uploading
    const isPollingState = notification.status === 'processing' || notification.status === 'uploading'
    if (!isPollingState) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }

    const supabase = createClient()
    pollRef.current = setInterval(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        let report: { id: string; status: string; filename: string } | null = null

        if (notification.reportId) {
          const { data } = await supabase
            .from('reports')
            .select('id, status, filename')
            .eq('id', notification.reportId)
            .eq('user_id', user.id)
            .maybeSingle()
          report = data
        } else if (notification.filename) {
          const query = supabase
            .from('reports')
            .select('id, status, filename')
            .eq('user_id', user.id)
            .eq('filename', notification.filename)
            .order('created_at', { ascending: false })
            .limit(1)

          if (notification.startTime) {
            query.gt('created_at', new Date(notification.startTime).toISOString())
          }

          const { data } = await query.maybeSingle()
          report = data
        }

        if (!report) return
        const status = normalizeReportStatus(report.status)

        if (status === 'completed' && notification.status !== 'completed' && !notification.hasNotified) {
          updateNotification(notification.jobId, { status: 'completed', reportId: report.id, hasNotified: true })
        } else if (status === 'failed' && notification.status !== 'failed' && !notification.hasNotified) {
          updateNotification(notification.jobId, { status: 'failed', reportId: report.id, hasNotified: true })
        } else if (status === 'processing' && notification.status === 'uploading') {
          updateNotification(notification.jobId, { status: 'processing', reportId: report.id })
        }
      } catch (err) {
        console.error('[Toast Polling] error:', err)
      }
    }, 5000)

    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [notification.status, notification.reportId, notification.filename, notification.hasNotified, notification.jobId, notification.startTime, updateNotification])

  const isSuccess = notification.status === 'completed'
  const isFailed = notification.status === 'failed' || notification.status === 'aborted'
  const isAborted = notification.status === 'aborted'

  const accentColor = isSuccess ? '#10B981' : '#EF4444'
  const statusLabel = isSuccess
    ? 'Report Ready'
    : isAborted
      ? `Cancelled: ${notification.filename}`
      : 'Analysis Failed'

  const subtext = isSuccess ? notification.filename : null
  const sublabel = isAborted ? 'Cancelled just now' : isSuccess ? 'Completed just now' : 'Failed'

  const isVisible = isSuccess || isFailed || isAborted
  if (isOnDashboard || !isVisible) return null

  return (
    <div
      className="flex flex-col gap-2.5 rounded-2xl border px-4 py-3.5 shadow-xl relative bg-white"
      style={{
        borderColor: '#E5E7EB',
        minWidth: 280,
        animation: 'slideInRight 0.4s ease',
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: accentColor, boxShadow: `0 0 10px ${accentColor}40` }}
        />
        
        <div className="flex-1 min-w-0 flex flex-col">
          <span className="text-sm font-bold text-gray-900 leading-tight">
            {statusLabel}
          </span>
          {subtext && (
            <span className="text-xs text-gray-600 mt-1 truncate">{subtext}</span>
          )}
          <span className="text-[10px] font-medium text-gray-400 mt-1">
            {sublabel}
          </span>
        </div>

        <button
          type="button"
          onClick={() => dismissNotification(notification.jobId)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm transition-colors hover:bg-gray-100 text-gray-400 -mr-1 -mt-1"
        >
          ×
        </button>
      </div>

      {isSuccess && notification.reportId && (
        <div className="flex items-center gap-2 pt-1.5 mt-1 border-t border-gray-100 w-full">
          <Link
            href={`/report/${notification.reportId}`}
            onClick={() => dismissNotification(notification.jobId)}
            className="flex-1 rounded-lg px-3 py-1.5 text-center text-xs font-bold transition-all text-white hover:opacity-90 shadow-sm"
            style={{ background: accentColor }}
          >
            View Report
          </Link>
          <button
            type="button"
            onClick={() => dismissNotification(notification.jobId)}
            className="rounded-lg border px-3 py-1.5 text-xs font-semibold text-gray-500 transition-colors hover:bg-gray-50 border-gray-200"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
