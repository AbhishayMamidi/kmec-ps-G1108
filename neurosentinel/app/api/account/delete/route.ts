import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const REPORT_PDF_BUCKET = process.env.SUPABASE_REPORT_PDF_BUCKET || 'report-pdfs'

export async function DELETE() {
  const supabase = await createClient()
  const admin = createAdminClient()

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'You need to be signed in to delete your account.' }, { status: 401 })
    }

    const { data: reports, error: reportsError } = await admin
      .from('reports')
      .select('id')
      .eq('user_id', user.id)

    if (reportsError) {
      throw reportsError
    }

    const storagePaths = (reports ?? [])
      .map((report: { id?: string | null }) => (typeof report.id === 'string' ? `${user.id}/${report.id}.pdf` : null))
      .filter((path: string | null): path is string => Boolean(path))

    if (storagePaths.length > 0) {
      await admin.storage.from(REPORT_PDF_BUCKET).remove(storagePaths)
    }

    const { error: chatDeleteError } = await admin.from('chat_messages').delete().eq('user_id', user.id)
    if (chatDeleteError) throw chatDeleteError

    const { error: reportDeleteError } = await admin.from('reports').delete().eq('user_id', user.id)
    if (reportDeleteError) throw reportDeleteError

    const { error: userRowDeleteError } = await admin.from('users').delete().eq('id', user.id)
    if (userRowDeleteError) throw userRowDeleteError

    const { error: authDeleteError } = await admin.auth.admin.deleteUser(user.id)
    if (authDeleteError) throw authDeleteError

    await supabase.auth.signOut()

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Unable to delete your account.' }, { status: 500 })
  }
}
