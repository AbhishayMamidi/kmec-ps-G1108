'use client'

import { createContext, useCallback, useContext, useState } from 'react'

export type ReportNotification = {
  jobId: string
  reportId?: string
  filename: string
  status: 'uploading' | 'processing' | 'completed' | 'failed' | 'aborted'
  timestamp: number
  startTime?: number
  hasNotified?: boolean
}

type NotificationCtx = {
  notifications: ReportNotification[]
  showNotification: (n: ReportNotification) => void
  updateNotification: (jobId: string, updates: Partial<ReportNotification>) => void
  dismissNotification: (jobId: string) => void
}

const ReportNotificationContext = createContext<NotificationCtx>({
  notifications: [],
  showNotification: () => {},
  updateNotification: () => {},
  dismissNotification: () => {},
})

export function useReportNotification() {
  return useContext(ReportNotificationContext)
}

export function ReportNotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<ReportNotification[]>([])

  const showNotification = useCallback((n: ReportNotification) => {
    setNotifications(prev => {
      // If job already exists, replace it
      const exists = prev.find(p => p.jobId === n.jobId)
      if (exists) {
        return prev.map(p => p.jobId === n.jobId ? { ...p, ...n } : p)
      }
      return [...prev, n]
    })
  }, [])

  const updateNotification = useCallback((jobId: string, updates: Partial<ReportNotification>) => {
    setNotifications(prev => prev.map(p => p.jobId === jobId ? { ...p, ...updates } : p))
  }, [])

  const dismissNotification = useCallback((jobId: string) => {
    setNotifications(prev => prev.filter(p => p.jobId !== jobId))
  }, [])

  return (
    <ReportNotificationContext.Provider value={{ notifications, showNotification, updateNotification, dismissNotification }}>
      {children}
    </ReportNotificationContext.Provider>
  )
}
