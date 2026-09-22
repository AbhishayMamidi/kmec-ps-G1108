import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBackendBaseUrl } from '@/lib/backend'

export const runtime = 'nodejs'

/**
 * Lightweight proxy: receives a JSON body with `file_url` and `filename`
 * from the frontend (after the file was uploaded directly to Supabase Storage)
 * and forwards it to the FastAPI backend. The actual EEG file never passes
 * through Vercel — only a small JSON payload.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()

    const user = session?.user ?? null

    if (!user || !session?.access_token) {
      return NextResponse.json(
        { error: 'You need to be signed in to upload EEG files.' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { file_url, filename } = body

    if (!file_url || !filename) {
      return NextResponse.json(
        { error: 'Missing file_url or filename.' },
        { status: 400 }
      )
    }

    const backendResponse = await fetch(
      `${getBackendBaseUrl()}/api/v1/analyze-url`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ file_url, filename }),
        cache: 'no-store',
      }
    )

    const backendPayload = await backendResponse.json().catch((parseErr) => {
      console.error('[api/upload] Failed to parse backend JSON response:', parseErr)
      return null
    })

    if (!backendResponse.ok) {
      const message =
        backendPayload?.detail ||
        backendPayload?.error ||
        'The backend rejected this analysis request.'
      return NextResponse.json({ error: message }, { status: backendResponse.status })
    }

    return NextResponse.json(backendPayload)
  } catch (error: any) {
    console.error('[api/upload] Error:', error)
    return NextResponse.json(
      { error: error?.message || 'Unable to process this EEG upload right now.' },
      { status: 500 }
    )
  }
}
