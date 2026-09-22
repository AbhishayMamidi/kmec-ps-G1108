import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Use | NeuroSentinel AI',
}

type Section = {
  title: string
  body: string
  bullets?: string[]
}

const sections: Section[] = [
  {
    title: '1. About NeuroSentinel AI',
    body: 'NeuroSentinel AI is an end-to-end EEG analysis and clinical decision-support platform designed to assist with the review of scalp EEG recordings. The platform accepts EEG recordings in EDF format, processes them through an automated analysis pipeline, and produces structured seizure-detection results, clinical reports, signal-quality information, and explainability outputs. NeuroSentinel AI also provides SCOUT, an AI assistant designed to help users understand reports and analysis results. NeuroSentinel AI is intended to support research, analysis, and professional review workflows. It is not a replacement for qualified medical or research professionals.',
  },
  {
    title: '2. Medical and Clinical Disclaimer',
    body: 'NeuroSentinel AI is a decision-support tool and does not provide medical diagnosis or treatment. The platform does not replace the judgment of a neurologist, physician, researcher, or other qualified professional.',
    bullets: [
      'Automated seizure detections, confidence values, risk or severity assessments, seizure classifications, explanations, and SCOUT responses may be incorrect, incomplete, or uncertain.',
      'Some outputs, including heuristic severity assessments and seizure-type or focal/generalized classifications, are rule-based estimates and should not be treated as ground-truth clinical diagnoses.',
      'All results must be independently reviewed and validated by an appropriately qualified professional before being used for patient-care or other consequential decisions.',
      'NeuroSentinel AI must not be used for emergency medical decisions or emergency medical care.',
      'NeuroSentinel AI is not FDA approved.',
    ],
  },
  {
    title: '3. User Responsibilities',
    body: 'You are responsible for:',
    bullets: [
      'Providing accurate account information.',
      'Maintaining the security of your account credentials.',
      'Uploading only EEG recordings and other information that you are authorized to process.',
      'Obtaining any required consent, authorization, institutional approval, or other legal basis before processing personal or health-related information.',
      'Reviewing and validating NeuroSentinel AI outputs before relying on them.',
      'Using the platform in accordance with applicable laws, regulations, institutional policies, and research requirements.',
    ],
  },
  {
    title: '4. EEG Data and Sensitive Information',
    body: 'EEG recordings may contain information that is personal, sensitive, or related to an individual\u2019s health. You should upload only information that you have the legal right and appropriate authorization to process. Where practical, users should remove unnecessary personally identifying information from EEG files before uploading them. If you are using NeuroSentinel AI on behalf of a hospital, university, research institution, or other organization, you are responsible for ensuring that your use of the platform complies with that organization\u2019s policies and applicable requirements.',
  },
  {
    title: '5. AI-Assisted Features',
    body: 'SCOUT is an AI assistant that can summarize reports, answer questions about analysis results, and provide role-aware assistance. SCOUT uses information associated with the current analysis and conversation to generate its responses. AI responses may be inaccurate or incomplete. SCOUT must not be treated as an independent medical authority, and its responses do not constitute medical diagnosis, treatment recommendations, or emergency advice.',
  },
  {
    title: '6. Acceptable Use',
    body: 'You agree not to:',
    bullets: [
      'Upload malicious or intentionally harmful files.',
      'Attempt unauthorized access to the platform, backend, database, storage, or another user\u2019s account.',
      'Circumvent authentication or security controls.',
      'Interfere with or disrupt the operation of the platform.',
      'Attempt to reverse engineer protected components except where permitted by applicable law.',
      'Abuse APIs or other platform functionality.',
      'Upload information that you are not authorized to process.',
      'Use NeuroSentinel AI for unlawful purposes.',
      'Use platform outputs in a manner that violates applicable medical, privacy, research, or other regulations.',
    ],
  },
  {
    title: '7. Uploaded Files and Analysis',
    body: 'Uploaded EDF files are processed by NeuroSentinel AI to perform EEG preprocessing, model inference, quality assessment, explainability analysis, and report generation. Uploads are subject to a maximum file size of 1 GB. Analysis may produce stored reports, metrics, summaries, and generated PDF reports associated with your account.',
  },
  {
    title: '8. Reports and Results',
    body: 'NeuroSentinel AI may generate structured reports containing information such as seizure events, confidence information, recording quality, risk-related outputs, and explainability information. Generated reports are intended to assist review and should not be interpreted as definitive medical conclusions.',
  },
  {
    title: '9. Intellectual Property',
    body: 'The NeuroSentinel AI software, interface, branding, documentation, models, and underlying technology are owned by or licensed to the operators of NeuroSentinel AI unless otherwise stated. You retain rights to information and data that you lawfully own or control and submit to the platform. You grant NeuroSentinel AI the limited permissions reasonably necessary to process submitted information to provide the platform\u2019s requested functionality.',
  },
  {
    title: '10. Third-Party Services',
    body: 'NeuroSentinel AI relies on third-party infrastructure and services to operate certain parts of the platform, including hosting, authentication, databases, storage, email delivery, and AI processing. The current technical architecture includes Vercel, Hugging Face Spaces, Supabase, and external AI providers used by SCOUT. Use of these services may be subject to their respective terms and policies.',
  },
  {
    title: '11. Availability and Changes',
    body: 'NeuroSentinel AI is an evolving research and software platform. Features, models, algorithms, infrastructure, and functionality may change, be temporarily unavailable, or be discontinued without notice. We do not guarantee uninterrupted or error-free operation.',
  },
  {
    title: '12. No Warranty',
    body: 'NeuroSentinel AI is provided on an \u201cas is\u201d and \u201cas available\u201d basis to the maximum extent permitted by law. We do not guarantee:',
    bullets: [
      'Perfect seizure detection.',
      'Absence of false positives or false negatives.',
      'Accuracy for every EEG recording or patient population.',
      'Continuous availability.',
      'Accuracy of AI-generated explanations or responses.',
      'Fitness for a particular medical, research, or operational purpose.',
    ],
  },
  {
    title: '13. Limitation of Liability',
    body: 'To the maximum extent permitted by applicable law, NeuroSentinel AI and its operators shall not be liable for indirect, incidental, consequential, special, or similar losses arising from the use or inability to use the platform, including losses arising from reliance on automated analysis, reports, or AI-generated information. Nothing in these Terms excludes or limits liability that cannot legally be excluded or limited.',
  },
  {
    title: '14. Account Suspension or Termination',
    body: 'We may suspend or terminate access where reasonably necessary because of unlawful activity, abuse, security concerns, or violation of these Terms. You may stop using NeuroSentinel AI at any time. If you want to request account or data deletion, contact us using the address below.',
  },
  {
    title: '15. Changes to These Terms',
    body: 'We may update these Terms when the platform, its functionality, or applicable requirements change. The \u201cLast updated\u201d date will indicate when the Terms were most recently revised.',
  },
  {
    title: '16. Contact',
    body: 'For technical support, questions, collaboration inquiries, or concerns regarding these Terms:',
  },
]

export default function TermsPage() {
  return (
    <main className="min-h-dvh px-6 py-20 pb-20" style={{ background: 'linear-gradient(135deg, #F8FAFC, #E2E8F0)', fontFamily: "'Outfit', sans-serif" }}>
      <div className="mx-auto max-w-[800px]">
        <div
          className="relative overflow-hidden rounded-[16px] p-8 md:p-12"
          style={{
            background: 'rgba(255, 255, 255, 0.7)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(0,0,0,0.05)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
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
              Terms of Use
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed" style={{ color: '#64748B' }}>
              These Terms of Use govern your access to and use of NeuroSentinel AI, including its EEG analysis, seizure-detection, reporting, visualization, and SCOUT AI assistant features.
            </p>
            <p className="mt-2 text-[14px]" style={{ color: '#94A3B8' }}>
              By creating an account or using NeuroSentinel AI, you acknowledge that you have read and agree to these Terms. If you do not agree, you should not use the platform.
            </p>
          </div>

          <div style={{ height: '1px', background: '#E2E8F0', marginBottom: '40px' }} />

          <div className="space-y-10">
            {sections.map((section, i) => (
              <section key={i} className="relative pl-5" style={{ borderLeft: '3px solid #E2E8F0' }}>
                {section.title && (
                  <h2 className="text-[19px] font-semibold" style={{ color: '#0F172A' }}>
                    {section.title}
                  </h2>
                )}
                <p className={`${section.title ? 'mt-3' : ''} text-[15px] leading-[1.7]`} style={{ color: '#334155' }}>
                  {section.body}
                </p>
                {section.bullets && (
                  <ul className="mt-3 space-y-2 pl-1">
                    {section.bullets.map((bullet, j) => (
                      <li key={j} className="flex gap-2.5 text-[14.5px] leading-[1.7]" style={{ color: '#475569' }}>
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
