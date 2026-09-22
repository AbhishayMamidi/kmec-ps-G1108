'use client'

import { useState } from 'react'

export function HelpSupportButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Floating help button — bottom-right */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-[9999] flex h-11 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 active:scale-95"
        style={{
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(0,0,0,0.08)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          color: '#475569',
          fontFamily: "'Outfit', sans-serif",
        }}
        aria-label="Help & Support"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        Help &amp; Support
      </button>

      {/* Modal */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-[10000] bg-black/25 backdrop-blur-[2px] transition-opacity duration-200"
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed z-[10001] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[460px] rounded-2xl border bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200"
            style={{ borderColor: '#E2E8F0', fontFamily: "'Outfit', sans-serif" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-5" style={{ borderColor: '#F1F5F9' }}>
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-xl"
                  style={{ background: 'linear-gradient(135deg, #10B981, #059669)' }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <div>
                  <div className="text-[16px] font-bold text-[#0F172A]" style={{ fontFamily: "'Inter', sans-serif" }}>Help &amp; Support</div>
                  <div className="text-[11px] font-medium text-[#94A3B8]">NeuroSentinel AI</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-[#94A3B8] transition-colors hover:bg-[#F1F5F9] hover:text-[#475569]"
                aria-label="Close"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-6 space-y-5">
              <p className="text-[14px] leading-relaxed text-[#475569]">
                Whether you have a question about your EEG reports, need technical assistance, or are interested in research collaborations &mdash; we&apos;d love to hear from you.
              </p>

              {/* Contact Card */}
              <div className="rounded-xl border p-4" style={{ borderColor: '#E2E8F0', background: '#F8FAFC' }}>
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#94A3B8] mb-3">Get in Touch</div>
                <a
                  href="mailto:manikondaadwith6@gmail.com"
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 -mx-1 transition-colors hover:bg-white group"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: '#EEF2FF' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect width="20" height="16" x="2" y="4" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-[#0F172A] group-hover:text-[#6366F1] transition-colors">manikondaadwith6@gmail.com</div>
                    <div className="text-[11px] text-[#94A3B8]">Developer &amp; Lead Engineer</div>
                  </div>
                </a>
              </div>

              {/* Topics */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border px-3.5 py-3 text-center" style={{ borderColor: '#E2E8F0' }}>
                  <div className="text-[15px] mb-0.5">🐛</div>
                  <div className="text-[11px] font-semibold text-[#475569]">Bug Reports</div>
                </div>
                <div className="rounded-xl border px-3.5 py-3 text-center" style={{ borderColor: '#E2E8F0' }}>
                  <div className="text-[15px] mb-0.5">💡</div>
                  <div className="text-[11px] font-semibold text-[#475569]">Feature Requests</div>
                </div>
                <div className="rounded-xl border px-3.5 py-3 text-center" style={{ borderColor: '#E2E8F0' }}>
                  <div className="text-[15px] mb-0.5">🤝</div>
                  <div className="text-[11px] font-semibold text-[#475569]">Collaborations</div>
                </div>
                <div className="rounded-xl border px-3.5 py-3 text-center" style={{ borderColor: '#E2E8F0' }}>
                  <div className="text-[15px] mb-0.5">📋</div>
                  <div className="text-[11px] font-semibold text-[#475569]">General Queries</div>
                </div>
              </div>

              <p className="text-[12px] text-center text-[#94A3B8] leading-relaxed">
                We typically respond within 24 hours.<br />
                Built with ❤️ by the NeuroSentinel AI team.
              </p>
            </div>
          </div>
        </>
      )}
    </>
  )
}
