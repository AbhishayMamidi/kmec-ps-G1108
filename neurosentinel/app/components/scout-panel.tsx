'use client'

import { ScoutConversation } from './scout-conversation'
import { getQuickPrompts, type ScoutPageContext, type ScoutRole } from '@/lib/scout-guide'
import type { ReportRecord, ScoutPageData } from '@/lib/neurosentinel/types'

type ScoutPanelProps = {
  page: ScoutPageContext
  role?: ScoutRole
  initialMessage: string
  report?: ReportRecord | null
  pageData?: ScoutPageData | null
  autoPrompt?: { content: string; visible: boolean } | null
}


export function ScoutPanel({
  page,
  role = null,
  initialMessage,
  report = null,
  pageData = null,
  onClose,
  autoPrompt = null,
}: ScoutPanelProps & { onClose?: () => void }) {

  return (
    <aside
      className="flex h-full flex-col bg-white border-l border-gray-100 shadow-sm"
    >
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center justify-between border-b bg-gray-50/50 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </div>
          <div>
            <h3 className="text-[13px] font-black uppercase tracking-widest text-gray-900 leading-tight">
              SCOUT Clinical Assistant
            </h3>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter mt-0.5">
              Seizure Clinical Operations & Understanding Tool
            </p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-900"
            aria-label="Close SCOUT"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        )}
      </div>

      <ScoutConversation
        page={page}
        role={role}
        reportId={report?.id ?? null}
        currentReport={report}
        pageData={pageData}
        initialMessage={initialMessage}
        quickPrompts={getQuickPrompts(page)}
        autoPrompt={autoPrompt}
      />
    </aside>
  )
}
