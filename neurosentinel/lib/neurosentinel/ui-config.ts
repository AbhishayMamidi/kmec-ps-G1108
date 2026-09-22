export type StatusType = 'seizure_detected' | 'suspicious_activity' | 'no_seizure' | 'failed' | 'processing' | 'pending' | 'aborted' | 'uploading' | 'inconclusive'

export interface StatusConfig {
  label: string
  color: string
  bg: string
  text: string
  border: string
}

export const STATUS_CONFIG: Record<StatusType, StatusConfig> = {
  seizure_detected: {
    label: 'Seizure Detected',
    color: 'orange',
    bg: 'bg-orange-100',
    text: 'text-orange-700',
    border: 'border-orange-500',
  },
  suspicious_activity: {
    label: 'Suspicious Activity',
    color: 'amber',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-400',
  },
  no_seizure: {
    label: 'No Seizure',
    color: 'green',
    bg: 'bg-emerald-100',
    text: 'text-emerald-900',
    border: 'border-emerald-300',
  },
  inconclusive: {
    label: 'Inconclusive',
    color: 'slate',
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    border: 'border-slate-400',
  },
  failed: {
    label: 'Analysis Failed',
    color: 'red',
    bg: 'bg-red-100',
    text: 'text-red-700',
    border: 'border-red-500',
  },
  aborted: {
    label: 'Analysis Aborted',
    color: 'red',
    bg: 'bg-red-100',
    text: 'text-red-700',
    border: 'border-red-500',
  },
  uploading: {
    label: 'Uploading',
    color: 'blue',
    bg: 'bg-sky-100',
    text: 'text-sky-700',
    border: 'border-sky-500',
  },
  processing: {
    label: 'Processing',
    color: 'blue',
    bg: 'bg-blue-100',
    text: 'text-blue-700',
    border: 'border-blue-500',
  },
  pending: {
    label: 'Queued',
    color: 'slate',
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border-slate-500',
  },
}

export type ReliabilityType = 'High' | 'Moderate' | 'Low'

export interface ReliabilityConfig {
  label: string
  color: string
  bg: string
  text: string
  border: string
  icon: string
}

export const RELIABILITY_CONFIG: Record<ReliabilityType, ReliabilityConfig> = {
  High: {
    label: 'Reliability: High',
    color: 'green',
    bg: 'bg-emerald-100',
    text: 'text-emerald-800',
    border: 'border-emerald-300',
    icon: '✓',
  },
  Moderate: {
    label: 'Reliability: Moderate',
    color: 'orange',
    bg: 'bg-amber-100',
    text: 'text-amber-800',
    border: 'border-amber-300',
    icon: '',
  },
  Low: {
    label: 'Reliability: Low',
    color: 'red',
    bg: 'bg-red-100',
    text: 'text-red-800',
    border: 'border-red-300',
    icon: '⚠️',
  },
}
