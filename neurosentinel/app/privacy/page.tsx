import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy | NeuroSentinel AI',
}

type Section = {
  title: string
  body: string
  bullets?: string[]
  subsections?: { subtitle: string; bullets: string[] }[]
}

const sections: Section[] = [
  {
    title: '1. Information We Process',
    body: 'Depending on how you use NeuroSentinel AI, the platform may process the following types of information:',
    subsections: [
      {
        subtitle: 'Account Information',
        bullets: [
          'Email address, User ID, Role, Account preferences, Onboarding information, and Full Name.',
          'The current system uses Supabase Auth for email/password authentication and maintains user profile information associated with authenticated accounts.',
        ],
      },
      {
        subtitle: 'EEG and Analysis Information',
        bullets: [
          'Uploaded EDF filenames and recordings during processing.',
          'EEG-related metadata contained in uploaded files.',
          'Analysis status, seizure-detection results, event counts, confidence scores, recording quality information, risk-related outputs, generated reports, and analysis history.',
        ],
      },
      {
        subtitle: 'SCOUT Information',
        bullets: [
          'Messages you send to SCOUT and conversation context.',
          'Information from the current report, relevant recent reports, your profile and preferences, and dashboard information needed for contextual responses.',
          'The current SCOUT implementation can assemble the report context, up to eight recent reports, user profile information, page data, product-guide information, and the last 20 messages when processing a request.',
        ],
      },
      {
        subtitle: 'Technical Information',
        bullets: [
          'The platform may also process technical information required to authenticate users, operate the application, monitor jobs, troubleshoot errors, and maintain security.',
        ],
      },
    ],
  },
  {
    title: '2. How We Use Information',
    body: 'Information may be processed to:',
    bullets: [
      'Create and authenticate your account.',
      'Process uploaded EEG recordings.',
      'Perform automated EEG analysis.',
      'Generate reports and visualizations.',
      'Maintain analysis history.',
      'Provide SCOUT responses.',
      'Send analysis-status notifications.',
      'Maintain and troubleshoot the platform.',
      'Protect the platform against abuse or unauthorized access.',
      'Improve the reliability and functionality of the service.',
      'Comply with applicable legal obligations.',
    ],
  },
  {
    title: '3. How EEG Files Are Processed',
    body: 'When you upload an EDF recording, the file is securely streamed to NeuroSentinel AI for processing. The platform processes uploaded files through preprocessing, chunked inference, quality assessment, explainability analysis, report generation, and database updates. Temporary processing files may exist on backend infrastructure during analysis.',
  },
  {
    title: '4. Stored Reports and Files',
    body: 'NeuroSentinel AI stores information necessary to provide report history and account functionality. Generated PDF reports are stored in account-associated paths within the report-PDF storage system. The system\u2019s database stores report information associated with the authenticated user\u2019s account.',
  },
  {
    title: '5. SCOUT and AI Processing',
    body: 'SCOUT uses a multi-provider AI architecture. The current implementation uses Gemini as the primary provider, Groq as a fallback, and a Hugging Face model as a further fallback. When SCOUT processes a request, relevant information from the report and conversation may be provided to the selected AI provider in order to generate the requested response.',
    bullets: [
      'Do not submit information to SCOUT that you are not authorized to have processed by an external AI service.',
      'NeuroSentinel AI does not guarantee that AI-generated responses are accurate, complete, or suitable for clinical decision-making.',
    ],
  },
  {
    title: '6. Clinical and Health-Related Information',
    body: 'EEG recordings and reports may contain sensitive or health-related information. You are responsible for ensuring that you have an appropriate legal basis, authorization, consent, or institutional permission to upload and process such information. Where possible, users should minimize unnecessary personally identifying information in uploaded files. NeuroSentinel AI is a decision-support system and does not diagnose, prescribe treatment, or replace clinical judgment.',
  },
  {
    title: '7. Authentication and Account Security',
    body: 'Authentication is provided through Supabase Auth. The frontend sends an authentication token to the backend, which verifies the authenticated user before processing protected requests. Users are responsible for keeping their account credentials secure and should not share their authentication information with others.',
  },
  {
    title: '8. Third-Party Services',
    body: 'NeuroSentinel AI currently relies on third-party infrastructure including:',
    bullets: [
      'Vercel \u2014 frontend hosting.',
      'Hugging Face Spaces \u2014 backend hosting.',
      'Supabase \u2014 authentication, database, and storage.',
      'Gemini / Google AI \u2014 primary SCOUT AI provider.',
      'Groq \u2014 SCOUT fallback AI provider.',
      'Hugging Face \u2014 additional SCOUT fallback.',
      'Resend \u2014 email notifications.',
    ],
  },
  {
    title: '',
    body: 'These providers may process information as necessary to provide their respective services. Use of these services may be subject to their respective terms and policies.',
  },
  {
    title: '9. Email Notifications',
    body: 'NeuroSentinel AI may send emails relating to your analysis, including notifications when an analysis succeeds, fails, times out, is cancelled, or exceeds the upload-size limit. Successful analysis emails may contain a report link, result summary, risk level, confidence information, recording quality information, and a clinical disclaimer.',
  },
  {
    title: '10. Data Sharing',
    body: 'NeuroSentinel AI does not sell personal information. Information may be made available to third-party service providers when necessary to operate the platform. Information may also be disclosed where reasonably necessary to:',
    bullets: [
      'Comply with applicable law or a valid legal request.',
      'Protect the security or integrity of the platform.',
      'Investigate abuse, fraud, or security incidents.',
      'Protect the rights or safety of users or others.',
    ],
  },
  {
    title: '11. Data Retention',
    body: 'Different types of information may have different retention periods. Account and report information may be retained while required to provide account functionality and report history. SCOUT conversation records may be retained as part of the account\u2019s analysis and conversation data. The current frontend also maintains SCOUT session state in browser sessionStorage, which is cleared when the browser tab is closed.',
  },
  {
    title: '12. Your Choices and Requests',
    body: 'You may contact us regarding:',
    bullets: [
      'Your account information.',
      'Questions about information processed by NeuroSentinel AI.',
      'Privacy concerns.',
      'Data-access requests.',
      'Correction requests.',
      'Account or data-deletion requests.',
      'Security concerns.',
    ],
  },
  {
    title: '13. Account and Data Deletion',
    body: 'If you want to delete your account or request deletion of associated information, contact us at the email address below. Deletion may be subject to information that must be retained for legal, security, fraud-prevention, backup, or other legitimate purposes.',
  },
  {
    title: '14. Security',
    body: 'NeuroSentinel AI uses authentication and access-controlled infrastructure to protect account and application data. However, no internet-connected system, storage system, or transmission method can be guaranteed to be completely secure. Users should avoid uploading information they are not authorized to process and should protect their account credentials.',
  },
  {
    title: '15. Children\u2019s Privacy',
    body: 'NeuroSentinel AI is not specifically designed as a children\u2019s service. Users should use the platform only where they have the appropriate authority and legal basis to process the information they submit.',
  },
  {
    title: '16. Changes to This Privacy Policy',
    body: 'We may update this Privacy Policy when the platform, its data practices, infrastructure, or applicable requirements change. The \u201cLast updated\u201d date will indicate when the policy was most recently revised.',
  },
  {
    title: '17. Contact',
    body: 'For privacy questions, account requests, security concerns, or other questions about this Privacy Policy:',
  },
]

export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-[#F8FAFC] px-6 py-20 pb-20" style={{ fontFamily: "'Outfit', sans-serif" }}>
      <div className="mx-auto max-w-[800px]">
        <div
          className="relative overflow-hidden rounded-[16px] bg-[#FFFFFF] p-8 md:p-12"
          style={{
            border: '1px solid rgba(0,0,0,0.05)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.03), 0 8px 16px rgba(0,0,0,0.02)',
          }}
        >
          <Link
            href="/"
            className="mb-10 inline-flex items-center gap-2 text-[13px] font-medium text-slate-400 transition-colors hover:text-slate-600"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to app
          </Link>

          <div className="mb-8">
            <span className="text-[11.5px] font-bold tracking-[0.1em] uppercase text-[#0EA5A4]">
              NeuroSentinel AI
            </span>
            <h1 className="mt-3 text-[32px] md:text-[36px] font-bold tracking-tight text-[#0F172A] leading-tight">
              Privacy Policy
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-500">
              This Privacy Policy explains how NeuroSentinel AI processes information when you create an account or use its EEG analysis, reporting, and SCOUT AI features.
            </p>
            <p className="mt-2 text-[14px] text-slate-400">
              Because EEG recordings and associated reports may contain sensitive or health-related information, users should review this policy carefully before uploading data.
            </p>
          </div>

          <div style={{ height: '1px', background: '#E2E8F0', marginBottom: '40px' }} />

          <div className="space-y-10">
            {sections.map((section, i) => (
              <section key={i} className="relative pl-5" style={{ borderLeft: '3px solid #E2E8F0' }}>
                {section.title && (
                  <h2 className="text-[19px] font-semibold text-[#1E293B]">
                    {section.title}
                  </h2>
                )}
                <p className={`${section.title ? 'mt-3' : ''} text-[15px] leading-[1.7] text-[#475569]`}>
                  {section.body}
                </p>

                {section.subsections && section.subsections.map((sub, k) => (
                  <div key={k} className="mt-4">
                    <h3 className="text-[15px] font-bold text-[#334155]">{sub.subtitle}</h3>
                    <ul className="mt-2 space-y-1.5 pl-1">
                      {sub.bullets.map((b, j) => (
                        <li key={j} className="flex gap-2.5 text-[14.5px] leading-[1.7] text-[#475569]">
                          <span className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-[#CBD5E1]" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

                {section.bullets && (
                  <ul className="mt-3 space-y-2 pl-1">
                    {section.bullets.map((bullet, j) => (
                      <li key={j} className="flex gap-2.5 text-[14.5px] leading-[1.7] text-[#475569]">
                        <span className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-[#CBD5E1]" />
                        {bullet}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}

            {/* Contact email */}
            <div className="pl-5 -mt-4" style={{ borderLeft: '3px solid #E2E8F0' }}>
              <a
                href="mailto:manikondaadwith6@gmail.com"
                className="inline-flex items-center gap-2 text-[15px] font-semibold text-[#6366F1] transition-colors hover:text-[#4F46E5]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                manikondaadwith6@gmail.com
              </a>
            </div>
          </div>

          <div className="mt-12 mb-6" style={{ height: '1px', background: '#E2E8F0' }} />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-[12.5px] text-slate-400 font-medium tracking-wide">
            <span>Last updated: August 8, 2026</span>
            <span>NeuroSentinel AI</span>
          </div>
        </div>
      </div>
    </main>
  )
}
