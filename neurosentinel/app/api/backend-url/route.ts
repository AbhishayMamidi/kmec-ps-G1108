import { NextResponse } from 'next/server'
import { getBackendBaseUrl } from '@/lib/backend'

export const runtime = 'edge'

export async function GET() {
  try {
    const url = getBackendBaseUrl()
    return NextResponse.json({ url })
  } catch {
    return NextResponse.json({ url: null, error: 'Backend URL not configured' }, { status: 500 })
  }
}
