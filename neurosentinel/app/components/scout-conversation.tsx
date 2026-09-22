'use client'

import { useEffect, useRef, useState } from 'react'
import { useScoutConversation } from './scout-provider'
import { type ReportRecord, type ScoutPageContext, type ScoutPageData, type ScoutRole } from '@/lib/neurosentinel/types'

function cleanMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s*/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-*+]\s+/gm, '• ')
    .replace(/^\d+\.\s+/gm, (match) => match)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

type ScoutConversationProps = {
  page: ScoutPageContext
  role?: ScoutRole
  reportId?: string | null
  currentReport?: ReportRecord | null
  pageData?: ScoutPageData | null
  initialMessage: string
  quickPrompts: string[]
  autoPrompt?: { content: string; visible: boolean } | null
  stateKey?: string
}




export function ScoutConversation({
  page,
  role = null,
  reportId = null,
  currentReport = null,
  pageData = null,
  initialMessage,
  quickPrompts,
  autoPrompt = null,
  stateKey,
}: ScoutConversationProps) {
  const [input, setInput] = useState('')
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const { messages, loading, error, sendMessage, stopMessage } = useScoutConversation({
    page,
    role,
    reportId,
    currentReport,
    pageData,
    initialMessage,
    stateKey,
  })

  const sendMessageRef = useRef(sendMessage)
  sendMessageRef.current = sendMessage

  // Scroll to bottom when messages or loading state change
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, loading])

  // Auto-focus when panel opens
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus()
    }, 400) // Small delay for the slide-in animation
    return () => clearTimeout(timer)
  }, [])

  // Auto-send logic: fires once when the conversation is fully settled (not loading, only
  // the seed greeting exists). This is more reliable than a fixed 600ms timer because it
  // waits for the provider's conversation state to be ready before sending.
  const autoSentRef = useRef(false)
  useEffect(() => {
    if (!autoPrompt?.content) return
    if (autoSentRef.current) return               // already sent — never fire twice
    if (loading) return                            // wait until provider is not busy
    if (messages.length > 1) {
      // Conversation already has a response (session restore or prior auto-send)
      autoSentRef.current = true
      return
    }
    // Conversation is ready: only the seed greeting is present, nothing in-flight
    autoSentRef.current = true
    sendMessageRef.current(autoPrompt.content, true)
  }, [autoPrompt?.content, loading, messages.length])


  const handleSend = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    setInput('')
    void sendMessage(trimmed)
  }

  return (
    <div className="flex h-full flex-col bg-white overflow-hidden">
      {/* ── Chat Feed ── */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-6 py-6 scout-scroll-area"
      >
        <div className="space-y-8">
          {messages.map((message, i) => {
            const isScout = message.role === 'assistant'
            const isFirst = i === 0

            return (
              <div 
                key={message.id}
                className={`flex flex-col animate-in fade-in duration-500 ${isScout ? 'items-start' : 'items-end'}`}
              >
                <div className={`whitespace-pre-wrap max-w-[90%] rounded-2xl px-5 py-3.5 text-[14px] leading-relaxed transition-all ${
                  isScout 
                    ? 'bg-[#F8FAFC] text-[#0F172A] ring-1 ring-inset ring-[#E2E8F0]' 
                    : 'bg-[#0F172A] text-white shadow-md shadow-slate-200'
                }`}>
                  {isScout ? cleanMarkdown(message.content) : message.content}
                </div>

                {/* Quick actions after the first message */}
                {isFirst && isScout && messages.length === 1 && !loading && (
                   <div className="mt-4 flex flex-wrap gap-2">
                     {quickPrompts.slice(0, 3).map((prompt) => (
                       <button
                         key={prompt}
                         onClick={() => handleSend(prompt)}
                         className="rounded-full border border-gray-200 bg-white px-3.5 py-1.5 text-[11px] font-bold text-gray-500 transition-all hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 active:scale-95"
                       >
                         {prompt}
                       </button>
                     ))}
                   </div>
                )}
              </div>
            )
          })}

          {loading && (
            <div className="flex flex-col items-start animate-in fade-in slide-in-from-bottom-2">
              <div className="bg-[#F8FAFC] rounded-2xl px-5 py-3.5 ring-1 ring-inset ring-[#E2E8F0] flex items-center gap-2.5">
                <span className="text-[12px] font-semibold tracking-wider text-[#64748B] uppercase">Analyzing</span>
                <div className="flex gap-1.5 ml-1">
                  {[0, 1, 2].map((d) => (
                    <div 
                      key={d} 
                      className="h-1.5 w-1.5 rounded-full bg-[#10B981]" 
                      style={{ animation: 'bounce 1.2s infinite', animationDelay: `${d * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-red-50 p-4 ring-1 ring-inset ring-red-100">
               <p className="text-[12px] font-bold text-red-600 mb-2">
                 SCOUT is temporarily unavailable. Please ensure backend is running.
               </p>
               <button 
                 onClick={() => messages.length > 0 && handleSend(messages[messages.length - 1].content)}
                 className="text-[11px] font-black uppercase tracking-widest text-red-700 underline underline-offset-4 hover:text-red-800"
               >
                 Retry Connection
               </button>
            </div>
          )}
          <div ref={bottomRef} className="h-4" />
        </div>
      </div>

      {/* ── Input Box (Always Visible) ── */}
      <div className="shrink-0 border-t bg-white px-5 py-5 z-10 shadow-[0_-4px_12px_rgba(0,0,0,0.02)]">
        <form
          onSubmit={(e) => { e.preventDefault(); handleSend(input) }}
          className="flex items-center gap-2.5"
        >
          <div className="relative flex-1">
              <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={page === 'report' ? 'Ask SCOUT about this report...' : 'Ask SCOUT about this page...'}
              disabled={loading}
              className="w-full rounded-2xl border border-slate-200 bg-[#F8FAFC] px-5 py-3.5 text-[14px] font-medium text-[#0F172A] outline-none transition-all placeholder:text-slate-400 focus:border-[#10B981] focus:bg-white focus:ring-4 focus:ring-[#10B981]/15 disabled:opacity-60"
            />
          </div>
          {loading ? (
            <button
              type="button"
              onClick={stopMessage}
              className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-2xl bg-red-500 text-white shadow-lg shadow-red-100 transition-all hover:bg-red-600 hover:scale-105 active:scale-95"
              aria-label="Stop generation"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-2xl text-white shadow-lg transition-all hover:scale-105 active:scale-95 disabled:bg-slate-100 disabled:text-slate-300 disabled:shadow-none"
              style={{ background: input.trim() && !loading ? 'linear-gradient(180deg, #10B981, #059669)' : undefined }}
              aria-label="Send message"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
          )}
        </form>
      </div>

      <style jsx global>{`
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        .scout-scroll-area::-webkit-scrollbar {
          width: 6px;
        }
        .scout-scroll-area::-webkit-scrollbar-track {
          background: transparent;
        }
        .scout-scroll-area::-webkit-scrollbar-thumb {
          background-color: #E2E8F0;
          border-radius: 10px;
        }
        .scout-scroll-area:hover::-webkit-scrollbar-thumb {
          background-color: #CBD5E1;
        }
      `}</style>
    </div>
  )
}
