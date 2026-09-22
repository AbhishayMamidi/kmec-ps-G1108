import { NextResponse } from 'next/server'
import { confirmPasswordReset } from '@/lib/signup-otp-store'

export async function POST(req: Request) {
  try {
    const { email, otp, token, newPassword } = await req.json()

    if (!email || !otp || !token || !newPassword) {
      return NextResponse.json(
        { error: 'Email, OTP, token, and new password are required.' },
        { status: 400 }
      )
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters long.' },
        { status: 400 }
      )
    }

    await confirmPasswordReset(email, otp, token, newPassword)

    return NextResponse.json({ ok: true, message: 'Password updated successfully.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to reset password.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
