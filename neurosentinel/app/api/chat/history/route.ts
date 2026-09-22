import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'You need to be signed in to view SCOUT history.' }, { status: 401 })
    }

    const reportId = request.nextUrl.searchParams.get('reportId')
    const page = request.nextUrl.searchParams.get('page') || 'general'

    let query = admin
      .from('chat_messages')
      .select('id, role, content, report_id, page_context, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(20)

    if (reportId) {
      query = query.eq('report_id', reportId)
    } else {
      query = query.is('report_id', null).eq('page_context', page)
    }

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json({ messages: data ?? [] })
  } catch (error: any) {
    console.error('[api/chat/history] Error:', error)
    return NextResponse.json({ error: error?.message || 'Unable to load SCOUT history.' }, { status: 500 })
  }
}
