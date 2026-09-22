import { NextResponse } from 'next/server'
import { createVerifiedSignup, verifySignupOtp } from '@/lib/signup-otp-store'

export async function POST(req: Request) {
  try {
    const { email, password, otp, verificationToken } = await req.json()

    if (!email || !password || !otp || !verificationToken) {
      return NextResponse.json({ error: 'Email, password, verification code, and verification token are required.' }, { status: 400 })
    }

    verifySignupOtp(email, otp, verificationToken)
    await createVerifiedSignup(email, password)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to complete sign up.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
