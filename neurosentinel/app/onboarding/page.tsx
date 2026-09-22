'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type ScoutRole } from '@/lib/scout-guide'
import { ensureUserProfile, toDatabaseRole } from '@/lib/user-profile'

// Minimal message type for our controlled flow
type Message = {
  id: string
  role: 'scout' | 'user'
  content: string
}

export default function OnboardingPage() {
  const router = useRouter()
  const supabase = createClient()
  
  const [messages, setMessages] = useState<Message[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const [showNameInput, setShowNameInput] = useState(false)
  const [showRoleOptions, setShowRoleOptions] = useState(false)
  const [showTourOptions, setShowTourOptions] = useState(false)
  const [hasStarted, setHasStarted] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [userName, setUserName] = useState<string | null>(null)
  
  const scrollRef = useRef<HTMLDivElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isTyping, showRoleOptions, showTourOptions, showNameInput])

  // Focus name input when shown
  useEffect(() => {
    if (showNameInput && nameInputRef.current) {
      nameInputRef.current.focus()
    }
  }, [showNameInput])

  // Authentication check & kick off flow
  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/')
        return
      }
      const profile = await ensureUserProfile(supabase, user)
      if (profile.onboarding_complete && window.sessionStorage.getItem('ns-pending-onboarding') !== 'true') {
        router.replace('/dashboard')
        return
      }
      
      // If user already has a name saved, remember it
      if (profile.full_name) {
        setUserName(profile.full_name)
      }

      // Kick off the conversation
      setHasStarted(true)
    }
    void init()
  }, [router, supabase])

  // Helper to add a message with a typing delay
  const pushMessage = async (role: 'scout' | 'user', content: string, delayMs = 600) => {
    if (role === 'scout') {
      setIsTyping(true)
      await new Promise(r => setTimeout(r, delayMs))
      setIsTyping(false)
    }
    setMessages(prev => [...prev, { id: Math.random().toString(), role, content }])
  }

  // The conversation flow execution
  useEffect(() => {
    if (!hasStarted) return

    let mounted = true
    const runFlow = async () => {
      await new Promise(r => setTimeout(r, 400))
      if (!mounted) return
      
      await pushMessage('scout', "Hi, I'm SCOUT — Seizure Clinical Operations & Understanding Tool. I'm your clinical assistant inside NeuroSentinel AI.", 800)
      if (!mounted) return

      await pushMessage('scout', "Before we begin, may I know your name?", 1000)
      if (!mounted) return

      setShowNameInput(true)
    }

    void runFlow()
    return () => { mounted = false }
  }, [hasStarted])

  const handleNameSubmit = async () => {
    const trimmed = nameValue.trim()
    if (!trimmed) return

    setShowNameInput(false)
    setUserName(trimmed)
    setMessages(prev => [...prev, { id: Math.random().toString(), role: 'user', content: trimmed }])

    // Save name to DB in the background
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      supabase.from('users').update({ full_name: trimmed }).eq('id', user.id).then()
      supabase.auth.updateUser({ data: { full_name: trimmed } }).then()
    }

    await pushMessage('scout', `Nice to meet you, ${trimmed}! I need your role so I can tailor how I present insights.`, 1000)
    await pushMessage('scout', "What's your role?", 800)

    setShowRoleOptions(true)
  }

  const handleRoleSelection = async (roleSelection: ScoutRole) => {
    setShowRoleOptions(false)
    setMessages(prev => [...prev, { id: Math.random().toString(), role: 'user', content: getRoleLabel(roleSelection) }])

    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      // Background save
      const dbUpdates = {
        role: toDatabaseRole(roleSelection),
        onboarding_complete: true
      }
      supabase.from('users').update(dbUpdates).eq('id', user.id).then()
      supabase.auth.updateUser({ data: { scout_role: roleSelection, role: roleSelection } }).then()
    }

    // Dynamic response based on selected role
    let ackMessage = ""
    const nameGreet = userName ? `, ${userName}` : ""
    if (roleSelection === 'clinician') {
      ackMessage = `Got it${nameGreet}. I'll present structured clinical summaries with key metrics up front.`
    } else if (roleSelection === 'researcher') {
      ackMessage = `Understood${nameGreet}. I'll focus on model methodology, raw analytical metrics, and statistical confidence bounds.`
    } else {
      ackMessage = `Got it${nameGreet}. I'll use clear, reassuring language and avoid complex medical jargon.`
    }

    // Continue the flow
    await pushMessage('scout', ackMessage, 1000)
    
    await pushMessage('scout', "You're all set. Do you want a quick 60-second tour, or jump straight to the dashboard?", 1200)

    setShowTourOptions(true)
  }

  const handleTourSelection = (takeTour: boolean) => {
    setShowTourOptions(false)
    setMessages(prev => [...prev, { id: Math.random().toString(), role: 'user', content: takeTour ? 'Take Tour (60s)' : 'Skip to Dashboard' }])
    
    setIsTyping(true)
    setTimeout(() => {
      window.sessionStorage.removeItem('ns-pending-onboarding')
      if (takeTour) {
        window.sessionStorage.setItem('ns-pending-tour', 'true')
      } else {
        window.sessionStorage.setItem('ns-scout-tour-complete', 'true')
      }
      router.replace('/dashboard')
    }, 800)
  }

  const getRoleLabel = (role: ScoutRole) => {
    if (role === 'clinician') return 'Clinician'
    if (role === 'researcher') return 'Researcher'
    if (role === 'patient') return 'Patient'
    return 'User'
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] py-8 px-4" style={{ fontFamily: "'Inter', sans-serif" }}>
      
      {/* Background vignette wrapper */}
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-100 via-transparent to-transparent opacity-80" />
      
      {/* SCOUT CHAT CONTAINER */}
      <div className="relative z-10 w-full max-w-[640px] h-[650px] max-h-[90vh] flex flex-col bg-white rounded-3xl border border-[#E2E8F0] shadow-2xl overflow-hidden">
        
        {/* Header */}
        <Link href="/dashboard" className="flex items-center gap-4 border-b border-[#E2E8F0] px-6 py-5 bg-white shrink-0 shadow-sm z-10 transition-opacity hover:opacity-90">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <img src="/logo.jpeg" alt="" className="h-full w-full object-contain" />
          </div>
          <div>
            <div className="text-[11px] font-bold tracking-[0.15em] text-[#10B981] uppercase">NeuroSentinel AI</div>
            <h1 className="text-[17px] font-bold text-[#0F172A] tracking-tight" style={{ fontFamily: "'Outfit', sans-serif" }}>SCOUT · Clinical Assistant</h1>
            <p className="text-[10px] font-semibold text-[#94A3B8] tracking-wide mt-0.5">Seizure Clinical Operations &amp; Understanding Tool</p>
          </div>
        </Link>

        {/* Conversation Area */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-6 py-8 space-y-6 bg-slate-50/50"
        >
          {messages.map((message) => {
            const isScout = message.role === 'scout'
            return (
              <div key={message.id} className={`flex w-full animate-in fade-in slide-in-from-bottom-2 duration-300 ${isScout ? 'justify-start' : 'justify-end'}`}>
                <div 
                  className={`max-w-[85%] px-5 py-3.5 text-[15px] leading-relaxed rounded-[20px] shadow-sm ${
                    isScout 
                      ? 'bg-white border border-[#E2E8F0] text-[#0F172A] rounded-bl-sm' 
                      : 'bg-[#F1F5F9] border border-[#E2E8F0] text-[#0F172A] rounded-br-sm'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            )
          })}

          {isTyping && (
            <div className="flex justify-start animate-in fade-in">
              <div className="flex items-center gap-1.5 px-5 py-4 bg-white border border-[#E2E8F0] rounded-[20px] rounded-bl-sm shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-[#94A3B8] animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#94A3B8] animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-[#94A3B8] animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}

          {showNameInput && (
            <div className="flex flex-col gap-3 pt-2 pl-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <form
                onSubmit={(e) => { e.preventDefault(); void handleNameSubmit() }}
                className="flex items-center gap-2 w-[320px]"
              >
                <input
                  ref={nameInputRef}
                  id="scout-name-input"
                  type="text"
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  placeholder="Enter your name…"
                  className="flex-1 px-4 py-3 rounded-xl border border-[#E2E8F0] bg-white text-[15px] text-[#0F172A] shadow-sm outline-none transition-all focus:border-[#10B981] focus:ring-2 focus:ring-[#10B981]/20 placeholder:text-[#94A3B8]"
                />
                <button
                  type="submit"
                  disabled={!nameValue.trim()}
                  className="shrink-0 flex items-center justify-center px-4 py-3 rounded-xl bg-[#10B981] text-white font-bold text-[14px] shadow-sm transition-all hover:bg-[#059669] hover:shadow-md hover:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </form>
            </div>
          )}

          {showRoleOptions && (
            <div className="flex flex-col gap-3 pt-2 pl-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <button
                onClick={() => handleRoleSelection('clinician')}
                className="group flex items-center justify-between w-[280px] px-5 py-3.5 bg-white border border-[#E2E8F0] rounded-2xl shadow-sm transition-all hover:border-[#10B981] hover:shadow-md hover:-translate-y-0.5 text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">👨‍⚕️</span>
                  <span className="text-[15px] font-bold text-[#0F172A]">Clinician</span>
                </div>
                <svg className="text-[#94A3B8] group-hover:text-[#10B981] transition-colors" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>

              <button
                onClick={() => handleRoleSelection('researcher')}
                className="group flex items-center justify-between w-[280px] px-5 py-3.5 bg-white border border-[#E2E8F0] rounded-2xl shadow-sm transition-all hover:border-[#10B981] hover:shadow-md hover:-translate-y-0.5 text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">🔬</span>
                  <span className="text-[15px] font-bold text-[#0F172A]">Researcher</span>
                </div>
                <svg className="text-[#94A3B8] group-hover:text-[#10B981] transition-colors" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>

              <button
                onClick={() => handleRoleSelection('patient')}
                className="group flex items-center justify-between w-[280px] px-5 py-3.5 bg-white border border-[#E2E8F0] rounded-2xl shadow-sm transition-all hover:border-[#10B981] hover:shadow-md hover:-translate-y-0.5 text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">🧑</span>
                  <span className="text-[15px] font-bold text-[#0F172A]">Patient</span>
                </div>
                <svg className="text-[#94A3B8] group-hover:text-[#10B981] transition-colors" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          )}

          {showTourOptions && (
            <div className="flex flex-col gap-3 pt-2 pl-2 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <button
                onClick={() => handleTourSelection(true)}
                className="group flex items-center justify-between w-[280px] px-5 py-3.5 bg-white border border-[#E2E8F0] rounded-2xl shadow-sm transition-all hover:border-[#10B981] hover:shadow-md hover:-translate-y-0.5 text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[15px] font-bold text-[#0F172A]">Take Tour (60s)</span>
                </div>
                <svg className="text-[#94A3B8] group-hover:text-[#10B981] transition-colors" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>

              <button
                onClick={() => handleTourSelection(false)}
                className="group flex items-center justify-between w-[280px] px-5 py-3.5 bg-white border border-[#E2E8F0] rounded-2xl shadow-sm transition-all hover:border-[#10B981] hover:shadow-md hover:-translate-y-0.5 text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[15px] font-bold text-[#64748B]">Skip to Dashboard</span>
                </div>
                <svg className="text-[#94A3B8] group-hover:text-[#10B981] transition-colors" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          )}

          {/* Padding element for scrolling */}
          <div className="h-4" />
        </div>
      </div>
    </div>
  )
}
