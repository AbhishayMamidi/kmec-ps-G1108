import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchBackend } from '@/lib/backend'
import { normalizeScoutRole } from '@/lib/scout-guide'

export async function POST(req: Request) {
  const supabase = await createClient()

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (!user || !session?.access_token) {
      return NextResponse.json({ error: 'You need to be signed in to chat with SCOUT.' }, { status: 401 })
    }

    const body = await req.json()
    const messages = Array.isArray(body?.messages) ? body.messages : []
    const context = body?.context ?? {}
    const lastUserMessage =
      [...messages].reverse().find((message: any) => message?.role === 'user' && typeof message?.content === 'string')?.content?.trim() || ''

    if (!lastUserMessage) {
      return NextResponse.json({ error: 'SCOUT needs a message to respond to.' }, { status: 400 })
    }

    const page = typeof context.page === 'string' ? context.page : 'general'
    const role = normalizeScoutRole(context.role)
    const reportId = typeof context.report_id === 'string' ? context.report_id : null
    const currentReport = context.current_report && typeof context.current_report === 'object' ? context.current_report : null
    const pageData = context.page_data && typeof context.page_data === 'object' ? context.page_data : null

    // Build in-session history from frontend messages (last 10 exchanges).
    // We no longer persist chat to DB — conversations are session-only.
    const recentHistory = messages
      .filter((m: any) => m?.role && typeof m?.content === 'string')
      .slice(-10)
      .map((m: any) => ({ role: m.role as string, content: (m.content as string).slice(0, 8000) }))

    const backendResponse = await fetchBackend('/api/v1/scout/chat', {
      method: 'POST',
      accessToken: session.access_token,
      timeoutMs: 90_000,
      body: JSON.stringify({
        message: lastUserMessage,
        history: recentHistory,
        context: {
          page,
          role,
          report_id: reportId,
          current_report: currentReport,
          page_data: pageData,
        },
      }),
    })

    const payload = await backendResponse.json().catch(() => null)

    if (!backendResponse.ok) {
      const errorMessage = payload?.detail || payload?.error || 'SCOUT could not respond right now.'
      console.error('[api/chat] Backend provider fallback:', payload?.provider_failures ?? errorMessage)
      const assistantMessage = payload?.message || 'SCOUT could not respond right now. Try again in a moment.'

      return NextResponse.json({
        message: assistantMessage,
        provider: payload?.provider ?? 'deterministic-fallback',
        fallback: true,
        tools_used: Array.isArray(payload?.tools_used) ? payload.tools_used : [],
      })
    }

    const assistantMessage = typeof payload?.message === 'string' && payload.message.trim() ? payload.message.trim() : 'I do not have a reliable answer yet.'

    return NextResponse.json({
      message: assistantMessage,
      provider: payload?.provider ?? 'unknown',
      fallback: Boolean(payload?.fallback),
      tools_used: Array.isArray(payload?.tools_used) ? payload.tools_used : [],
    })
  } catch (error: any) {
    const isTimeout = error?.name === 'AbortError'
    const isNetwork = error?.cause?.code === 'ECONNREFUSED' || error?.message?.includes('ECONNREFUSED') || error?.message?.includes('fetch failed')
    const errorDetail = isTimeout
      ? 'The backend took too long to respond. Please try again.'
      : isNetwork
        ? 'Could not connect to the NeuroSentinel AI backend. Make sure the backend server is running.'
        : error?.message || 'SCOUT encountered an unexpected error.'

    console.error('[api/chat] Error:', errorDetail, error)
    return NextResponse.json({
      message: errorDetail,
      provider: 'deterministic-fallback',
      fallback: true,
      tools_used: [],
    })
  }
}
