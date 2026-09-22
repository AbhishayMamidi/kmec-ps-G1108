export type ScoutRole = 'clinician' | 'researcher' | 'patient' | null
export type ScoutPageContext = 'dashboard' | 'report' | 'onboarding' | 'settings' | 'history' | 'general'

type ScoutReportContext = {
  fileName?: string
  result?: string
  confidence?: number
  summary?: string
  status?: string
  riskLevel?: string
  eventCount?: number
  createdAt?: string
  recordingDuration?: string
  diagnosticState?: string
}

type ScoutResponseOptions = {
  lastMessage: string
  role?: ScoutRole
  page?: ScoutPageContext
  report?: ScoutReportContext | null
}

export const DESIGN_PHILOSOPHY = {
  title: '7.1 Design Philosophy',
  statement: 'Clinical precision and structured intelligence.',
  summary: 'Clean white-themed clinical aesthetics, focusing on clarity, trust, and professional efficiency.',
}

export const SCOUT_FULL_NAME = 'SCOUT — Seizure Clinical Operations & Understanding Tool'

export const COLOUR_PALETTE = [
  { name: 'Pure White', value: '#FFFFFF' },
  { name: 'Light Gray', value: '#F9FAFB' },
  { name: 'Clinical Blue', value: '#3B82F6' },
  { name: 'Clinical Teal', value: '#14B8A6' },
  { name: 'Text Primary', value: '#1E293B' },
  { name: 'Text Secondary', value: '#64748B' },
]

export const SCOUT_GUIDE_REFERENCES = [
  {
    title: '8.0 What is SCOUT?',
    body: `${SCOUT_FULL_NAME} handles first-run onboarding, report explanation, and quick in-product guidance inside NeuroSentinel AI.`,
  },
  {
    title: '8.1 SCOUT Personality & Tone',
    body: 'SCOUT should sound concise, calm, aware of context, and never over-explained.',
  },
  {
    title: '8.2 SCOUT Placement Rules',
    body: 'Dashboard uses a launcher icon, report view uses the inline explainer, and onboarding is SCOUT-led on its own page.',
  },
]

export const SCOUT_PERSONALITY = {
  title: '8.1 SCOUT Personality & Tone',
  description: 'SCOUT should feel direct, helpful, slightly cinematic, and brief by default.',
}

export const SCOUT_PLACEMENT_RULES = [
  'Dashboard: icon-first launcher in the bottom-right.',
  'Report: inline side-panel explainer that auto-opens on load.',
  'Settings and secondary pages: floating launcher is allowed.',
  'Onboarding: dedicated SCOUT page before the user enters the product.',
]

export const SCOUT_CHAT_DIALOG_SPEC = {
  width: 380,
  height: 520,
  minWidth: 320,
  minHeight: 420,
  maxWidth: 600,
  maxHeight: '80vh',
}

export const SCOUT_GUARDRAILS = [
  'SCOUT must never diagnose or replace clinical judgment.',
  'SCOUT must never recommend treatment changes.',
  'SCOUT must never fabricate data or certainty.',
  'SCOUT must keep follow-up responses concise but maintain role-appropriate tone. Initial report summaries should be detailed.',
]

export const SCOUT_ROLE_TONE_RULES: Record<Exclude<ScoutRole, null>, string> = {
  clinician: 'Precise, clinical, and metric-dense. Structured output with key data points up front. Follow-ups stay short and data-driven.',
  researcher: 'Technical and methodological. Narrative context with embedded metrics and confidence bounds. Follow-ups stay concise but thorough.',
  patient: 'Warm, calm, and conversational. Write in flowing paragraphs — never use numbered lists or bullet points. Follow-ups stay short but supportive.',
}

/** Maps raw DB role values to proper display labels for PDFs and UI. */
export function displayRoleLabel(role: string | null | undefined): string {
  if (!role) return 'Unknown'
  const r = role.toLowerCase().trim()
  if (r === 'clinician') return 'Clinician'
  if (r === 'researcher') return 'Researcher'
  if (r === 'patient') return 'Patient'
  return 'Unknown'
}

export const SCOUT_ROLE_CONFIRMATIONS: Record<Exclude<ScoutRole, null>, string> = {
  clinician: "Clinician mode active. I'll keep this precise and clinical.",
  patient: "Patient mode active. I'll keep this plain and easy to follow.",
  researcher: "Researcher mode active. I'll keep this technical and concise.",
}

export const SCOUT_ONBOARDING_INTRO =
  `Hey. I'm ${SCOUT_FULL_NAME}, your intelligence layer inside NeuroSentinel AI. Before we move, I need your role so I can speak your language.`

export const SCOUT_ONBOARDING_ROLE_PROMPT =
  "What's your role? Are you a clinician reviewing patient data, a researcher working with the model, or a patient tracking your own recordings?"

export const SCOUT_ONBOARDING_GUIDE_CHOICE_PROMPT =
  'Want a quick tour, or should I take you straight to the dashboard?'

export const SCOUT_ONBOARDING_FINISH =
  "Alright. You're ready. Upload your first file whenever you're set."

export const SCOUT_GUIDE_CHOICE_ACTIONS = ['Take tour', 'Go to dashboard']

export const SCOUT_ONBOARDING_TOUR = [
  {
    step: '01',
    title: 'Command Centre — Upload Your EEG',
    body: 'The Command Centre is your home base. Drop an .edf EEG file into the upload zone and NeuroSentinel AI will start processing it immediately. You can continue working while the backend analyses your recording — a notification will appear when the report is ready.',
    target: 'upload',
  },
  {
    step: '02',
    title: 'Who Are You?',
    body: SCOUT_ONBOARDING_ROLE_PROMPT,
    target: 'role',
  },
  {
    step: '03',
    title: 'Accepted EEG Format',
    body: "We accept .edf files. 22-channel scalp EEG recordings at 256 Hz using the 10-20 electrode system work best. SCOUT will flag file issues before the model runs, and analysis typically takes 30–60 seconds.",
    target: 'format',
  },
  {
    step: '04',
    title: 'Your Clinical Report',
    body: "Once processing completes, you'll get a full clinical report with seizure event detection, probability timelines, brain-region heatmaps, channel importance rankings, band power analysis, signal quality metrics, and clinical recommendations. SCOUT will automatically summarise the report tailored to your role — and you can download a PDF to share with your care team.",
    target: 'report',
  },
]

export const SCOUT_QUICK_PROMPTS = {
  dashboard: ['Upload EEG', 'View latest report', 'Clinical tour'],
  report: ['Explain risk', 'Summarize report', 'Next steps'],
  settings: ['Update profile', 'Account security', 'Privacy controls'],
  history: ['Filter reports', 'Search guide', 'Export reports'],
  general: ['Upload help', 'Clinical tour', 'Recent reports'],
}

function matches(message: string, keywords: string[]) {
  return keywords.some((keyword) => message.includes(keyword))
}






export function getQuickPrompts(page: ScoutPageContext = 'general') {
  if (page === 'dashboard') return SCOUT_QUICK_PROMPTS.dashboard
  if (page === 'report') return SCOUT_QUICK_PROMPTS.report
  if (page === 'settings') return SCOUT_QUICK_PROMPTS.settings
  if (page === 'history') return SCOUT_QUICK_PROMPTS.history
  return SCOUT_QUICK_PROMPTS.general
}

export function normalizeScoutRole(role: unknown): ScoutRole {
  if (role === 'clinician' || role === 'researcher' || role === 'patient') return role
  return null
}

export function classifyRoleInput(input: string): ScoutRole {
  const value = input.trim().toLowerCase()

  if (!value) return null

  if (
    matches(value, [
      'doctor',
      'dr',
      'physician',
      'clinician',
      'neurologist',
      'epileptologist',
      'nurse',
      'hospital',
      'clinical',
      'provider',
    ])
  ) {
    return 'clinician'
  }

  if (
    matches(value, [
      'research',
      'researcher',
      'scientist',
      'phd',
      'student',
      'academic',
      'engineer',
      'data',
      'lab',
      'model',
    ])
  ) {
    return 'researcher'
  }

  if (
    matches(value, [
      'patient',
      'myself',
      'self',
      'personal',
      'parent',
      'family',
      'caregiver',
      'son',
      'daughter',
      'monitoring',
    ])
  ) {
    return 'patient'
  }

  return null
}

export function getRoleConfirmation(role: ScoutRole) {
  if (!role) return ''
  return SCOUT_ROLE_CONFIRMATIONS[role]
}

export function getGuideChoicePrompt(role: ScoutRole) {
  if (!role) return SCOUT_ONBOARDING_GUIDE_CHOICE_PROMPT
  return `${SCOUT_ROLE_CONFIRMATIONS[role]} ${SCOUT_ONBOARDING_GUIDE_CHOICE_PROMPT}`
}

export function getScoutInitialMessage(role: ScoutRole, page: ScoutPageContext = 'general') {
  if (page === 'onboarding') {
    return SCOUT_ONBOARDING_INTRO
  }

  if (page === 'report') {
    return 'SCOUT report explainer online. How can I help you analyze this EEG recording?'
  }

  return 'SCOUT online. How can I assist your clinical workflow today?'
}

export function getRoleLabel(role: ScoutRole) {
  if (!role) return 'Role not set'
  return role.charAt(0).toUpperCase() + role.slice(1)
}

export function getRoleToneSummary(role: ScoutRole) {
  if (!role) {
    return 'Neutral onboarding tone until SCOUT learns whether the user is a clinician, researcher, or patient.'
  }

  return SCOUT_ROLE_TONE_RULES[role]
}

export function getReportExplainerOpening(role: ScoutRole, report?: ScoutReportContext | null) {
  if (report?.status === 'pending') {
    return 'The report is queued for backend analysis. I\'ll notify you once the processing completes.'
  }

  if (report?.status === 'processing') {
    return 'Analysis in progress. I\'m currently processing the signal and generating your clinical briefing.'
  }

  if (report?.status === 'failed') {
    return report.summary || 'This report failed during analysis. I can help investigate the error or guide your next upload.'
  }

  // --- Completed Report Summary ---
  const fileName = report?.fileName ? ` (${report.fileName})` : ''
  const risk = report?.riskLevel ? ` Risk level: ${report.riskLevel.toLowerCase()}.` : ''
  
  // Use diagnostic_state as the grounding truth — never hallucinate "seizure detected"
  // when the state is SUSPICIOUS (0 confirmed events)
  const diagnosticState = report?.diagnosticState
  
  if (diagnosticState === 'DETECTED') {
    const eventCount = report?.eventCount ?? 0
    return `I've analyzed your EEG recording${fileName}. ${eventCount} seizure event${eventCount !== 1 ? 's' : ''} confirmed after post-processing.${risk} I'm preparing a detailed summary for you now.`
  }
  
  if (diagnosticState === 'SUSPICIOUS') {
    return `I've analyzed your EEG recording${fileName}. The model detected suspicious seizure-like patterns, but no events survived post-processing filters — meaning no confirmed seizure events.${risk} I'm preparing a detailed summary for you now.`
  }
  
  if (diagnosticState === 'CLEAR') {
    return `I've analyzed your EEG recording${fileName}. No seizure activity was detected.${risk} I'm preparing a detailed summary for you now.`
  }

  // Backward compat fallback: derive from result_label
  const result = report?.result || 'Analysis complete'
  const resultLower = result.toLowerCase()
  
  if (resultLower.includes('suspicious')) {
    return `I've analyzed your EEG recording${fileName}. Suspicious patterns were flagged but no confirmed seizure events.${risk} I'm preparing a detailed summary for you now.`
  }
  
  return `I've analyzed your EEG recording${fileName}. ${result}.${risk} I'm preparing a detailed summary for you now.`
}

export function buildScoutResponse({ lastMessage, role = null, page = 'general', report = null }: ScoutResponseOptions) {
  const normalized = lastMessage.trim().toLowerCase()

  if (!normalized || matches(normalized, ['hi', 'hello', 'hey', 'start', 'scout'])) {
    if (page === 'report') return getReportExplainerOpening(role, report)
    return getScoutInitialMessage(role, page)
  }

  if (matches(normalized, ['tour', 'onboarding', 'guide'])) {
    return 'I can show the upload flow, the analysis surface, and how reports open. If you want the full tour, start onboarding.'
  }

  if (matches(normalized, ['role', 'clinician', 'researcher', 'patient'])) {
    if (role) {
      return `${getRoleLabel(role)} mode is active. ${getRoleToneSummary(role)}`
    }

    return SCOUT_ONBOARDING_ROLE_PROMPT
  }

  if (matches(normalized, ['upload', '.edf', 'file', 'eeg'])) {
    return "Upload an .edf EEG file to start analysis. I'll flag obvious format problems before the model runs."
  }

  if (matches(normalized, ['dashboard', 'workflow', 'command centre', 'command center'])) {
    return 'Start with upload, review the analysis surface, then open a report for the full explainer.'
  }

  if (matches(normalized, ['report', 'event', 'walk through', 'walkthrough', 'summary'])) {
    return getReportExplainerOpening(role, report)
  }

  if (matches(normalized, ['heatmap', 'attention'])) {
    if (role === 'patient') {
      return 'The heatmap shows where the system focused most strongly. It is a clue map, not a diagnosis.'
    }

    return 'The attention heatmap shows where model focus was strongest across channels and time.'
  }

  if (matches(normalized, ['confidence', 'f1', 'sensitivity', 'false positive', 'latency'])) {
    if (role === 'patient') {
      return 'I keep the raw model metrics in the background for patient mode. I can explain the overall result in plain language instead.'
    }

    return 'Confidence, latency, and false positives should be reviewed together with the attention map.'
  }

  if (matches(normalized, ['settings', 'preferences', 'memory'])) {
    return 'Settings controls preferences, privacy, and how SCOUT remembers context.'
  }

  if (matches(normalized, ['diagnose', 'treat', 'medication', 'prescribe'])) {
    return 'I can explain the output, but I cannot diagnose, prescribe, or replace clinical judgment.'
  }

  if (page === 'report') {
    const statusText = !report?.result ? 'the current report' : report.result === 'Seizure Detected' ? 'a seizure-positive report' : 'a no-event report'
    return `I am tracking ${statusText}. I can summarize it or explain the attention map.`
  }

  if (page === 'dashboard') {
    return "Upload an EEG file to begin clinical analysis, or open an existing report from your history."
  }

  if (page === 'history') {
    return "I can help you filter, search, or review previous clinical reports."
  }

  if (page === 'settings') {
    return "I can guide you through managing your profile identity, preferences, or account security."
  }

  return 'How can I assist you today?'
}
