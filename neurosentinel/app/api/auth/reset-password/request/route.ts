import { NextResponse } from 'next/server'
import { sendResetPasswordOtp, userExistsForSignup } from '@/lib/signup-otp-store'

// Give Vercel up to 30s — the HF backend relay needs time to connect + send SMTP
export const maxDuration = 30

export async function POST(req: Request) {
  try {
    const { email } = await req.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
    }

    // Verify user exists before sending OTP
    const exists = await userExistsForSignup(email)
    if (!exists) {
      return NextResponse.json(
        { error: 'No account found with this email address.' },
        { status: 404 }
      )
    }

    const verificationToken = await sendResetPasswordOtp(email)
    return NextResponse.json({ ok: true, verificationToken })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to send recovery code.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
