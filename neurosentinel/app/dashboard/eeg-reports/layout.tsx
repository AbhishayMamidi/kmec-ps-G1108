import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Analysis History - NeuroSentinel AI',
  description: 'View your past EEG analysis reports and download completed summaries.',
}

export default function EegReportsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
