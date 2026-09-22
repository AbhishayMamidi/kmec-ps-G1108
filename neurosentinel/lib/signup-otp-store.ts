import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

const OTP_TTL_MS = 10 * 60 * 1000
const OTP_LENGTH = 6
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://neuro-sentinel-ai-6vfv.vercel.app').replace(/\/+$/, '')
const LOGO_URL = `${APP_URL}/logo.jpeg`

/** Shared table-based email template matching the NeuroSentinel clinical teal design */
function buildEmailHtml({ headline, bodyHtml, footerNote }: { headline: string; bodyHtml: string; footerNote?: string }) {
  const appUrl = APP_URL
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8" /><title>NeuroSentinel AI</title></head>
<body style="margin:0;padding:0;background-color:#EAF9F8;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EAF9F8">
<tr><td align="center" style="padding:32px 16px">
  <table width="540" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;border-radius:14px;overflow:hidden;border:1px solid #A7F3D0">
    <!-- HEADER -->
    <tr>
      <td style="background:#0A4455;padding:18px 24px">
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="vertical-align:middle;padding-right:10px">
              <img src="${LOGO_URL}" width="30" height="30" alt="NeuroSentinel AI" style="display:block;border-radius:6px;border:0" />
            </td>
            <td style="vertical-align:middle">
              <span style="font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;color:#FFFFFF;line-height:1">${headline}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <!-- TEAL ACCENT BAR -->
    <tr><td style="background:#14B8A6;height:3px;font-size:1px;line-height:1px">&nbsp;</td></tr>
    <!-- BODY -->
    <tr>
      <td style="background:#FFFFFF;padding:28px 28px 24px">
        ${bodyHtml}
      </td>
    </tr>
    <!-- FOOTER -->
    <tr>
      <td style="background:#EAF9F8;padding:14px 24px;border-top:1px solid #CCFBF1">
        <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#64748B">
          ${footerNote ?? 'NeuroSentinel AI &mdash; AI-Powered EEG Seizure Detection Platform'}
        </p>
        <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#94A3B8">
          Champapet, Hyderabad, Telangana 500079, India
        </p>
        <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#94A3B8">
          This is a transactional email sent because you requested it. You cannot unsubscribe from security emails.
          &bull; <a href="${appUrl}" style="color:#14B8A6;text-decoration:none">Visit NeuroSentinel AI</a>
        </p>
      </td>
    </tr>
  </table>
</td></tr>
</table>
</body></html>`
}


function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function getOtpSecret() {
  const secret = process.env.OTP_SIGNING_SECRET
  if (!secret) {
    throw new Error('OTP_SIGNING_SECRET env var is not set. Cannot sign or verify OTP tokens.')
  }
  return secret
}

function hashOtp(email: string, otp: string) {
  return crypto.createHmac('sha256', getOtpSecret()).update(`${normalizeEmail(email)}:${otp}`).digest('hex')
}

function signPayload(payload: string) {
  return crypto.createHmac('sha256', getOtpSecret()).update(payload).digest('base64url')
}

function encodePayload(payload: { email: string; otpHash: string; expiresAt: number }) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function decodePayload(token: string) {
  const [encodedPayload, signature] = token.split('.')

  if (!encodedPayload || !signature) {
    throw new Error('Invalid verification token.')
  }

  const expectedSignature = signPayload(encodedPayload)
  if (signature !== expectedSignature) {
    throw new Error('Invalid verification token.')
  }

  const rawPayload = Buffer.from(encodedPayload, 'base64url').toString('utf8')
  return JSON.parse(rawPayload) as { email: string; otpHash: string; expiresAt: number }
}

/**
 * Send an OTP email. Priority order:
 *
 * 1. Gmail SMTP via nodemailer (SMTP_USER + SMTP_PASSWORD set on Vercel)
 *    → Direct Gmail send from Vercel — works on port 587, no relay needed.
 *
 * 2. Brevo API (BREVO_API_KEY) — free, no domain, just verify Gmail sender.
 *
 * 3. Resend API (RESEND_API_KEY) — requires verified domain.
 *
 * 4. HF backend relay (NEUROSENTINEL_BACKEND_URL + INTERNAL_API_SECRET)
 *    → Last resort fallback.
 */
async function sendEmailViaBackend({
  to,
  subject,
  html,
  text,
}: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<void> {

  // ── Tier 1: Gmail SMTP directly from Vercel via nodemailer ──────────────────
  // Gmail's SMTP servers automatically add SPF + DKIM for @gmail.com senders.
  // Use a dedicated Gmail (e.g. neurosentinelai.noreply@gmail.com), not a personal one.
  const smtpUser = process.env.SMTP_USER
  const smtpPass = process.env.SMTP_PASSWORD
  const smtpFrom = process.env.SMTP_FROM_EMAIL ?? smtpUser
  const smtpFromName = process.env.SMTP_FROM_NAME ?? 'NeuroSentinel AI'

  if (smtpUser && smtpPass) {
    const nodemailer = await import('nodemailer')
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: { user: smtpUser, pass: smtpPass.replace(/\s/g, '') },
    })
    await transporter.sendMail({
      from: `"${smtpFromName}" <${smtpFrom}>`,
      to,
      subject,
      html,
      text: text || undefined,
      // List-Unsubscribe: Gmail reads this header natively and shows an unsubscribe button.
      // For transactional/security emails this points back to the app (not a bulk list).
      headers: {
        'List-Unsubscribe': `<mailto:${smtpFrom}?subject=Unsubscribe>, <${APP_URL}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'X-Mailer': 'NeuroSentinel AI Mailer',
        'X-Entity-Ref-ID': `neurosentinelai-${Date.now()}`,
      },
    })
    return
  }

  // ── Tier 2: Brevo (free, no domain needed — just verify your Gmail as sender) ─
  const brevoKey = process.env.BREVO_API_KEY
  if (brevoKey) {
    const fromEmail = process.env.BREVO_FROM_EMAIL ?? smtpUser ?? 'noreply@gmail.com'
    const fromName  = process.env.BREVO_FROM_NAME  ?? process.env.SMTP_FROM_NAME ?? 'NeuroSentinel AI'

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': brevoKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender:      { name: fromName, email: fromEmail },
        to:          [{ email: to }],
        subject,
        htmlContent: html,
        textContent: text,
        headers: {
          'List-Unsubscribe': `<${APP_URL}>`,
          'X-Mailer': 'NeuroSentinel AI Mailer',
        },
      }),
      signal: AbortSignal.timeout(15000),
    }).catch((err: unknown) => {
      throw new Error(`Email send failed: ${err instanceof Error ? err.message : String(err)}`)
    })
    if (res.ok) return
    const body = await res.json().catch(() => ({})) as any
    throw new Error(`Email send failed (${res.status}): ${body?.message ?? 'Unknown Brevo error'}`)
  }

  // ── Tier 3: Resend (requires verified domain) ────────────────────────────────
  const resendKey  = process.env.RESEND_API_KEY
  const resendFrom = process.env.RESEND_FROM_EMAIL ?? 'NeuroSentinel AI <onboarding@resend.dev>'

  if (resendKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: resendFrom, to: [to], subject, html }),
      signal: AbortSignal.timeout(15000),
    }).catch((err: unknown) => {
      throw new Error(`Email send failed: ${err instanceof Error ? err.message : String(err)}`)
    })
    if (res.ok) return
    const body = await res.json().catch(() => ({})) as any
    throw new Error(`Email send failed (${res.status}): ${body?.message ?? body?.name ?? 'Unknown Resend error'}`)
  }

  // ── Tier 4: HF backend relay (last resort) ───────────────────────────────────
  const backendUrl = process.env.NEUROSENTINEL_BACKEND_URL
  const secret     = process.env.INTERNAL_API_SECRET

  if (!backendUrl || !secret) {
    throw new Error(
      'Email service is not configured. Add SMTP_USER and SMTP_PASSWORD to your Vercel environment variables.'
    )
  }

  const response = await fetch(`${backendUrl}/api/v1/internal/send-otp-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': secret },
    body: JSON.stringify({ to, subject, html, text }),
    signal: AbortSignal.timeout(55000),
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    const isTimeout = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('abort')
    if (isTimeout) throw new Error('The email service is starting up — please wait a moment and try again.')
    throw new Error(`Could not reach email service: ${msg}. Please try again in a moment.`)
  })



  if (!response.ok) {
    const detail = await response.json().catch(() => ({ detail: 'Unknown error' }))
    throw new Error(`Email relay failed (${response.status}): ${detail?.detail ?? 'Unknown error'}`)
  }
}

function getAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in .env.local.')
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export async function userExistsForSignup(email: string) {
  const admin = getAdminClient()
  const normalizedEmail = normalizeEmail(email)

  // 1. Fast check — public.users profile table
  const { data } = await admin
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (data?.id) return true

  // 2. Auth.users check — catches users whose public profile is missing
  //    (public.users and auth.users can get out of sync if a trigger failed)
  //    Without this, OTP is sent successfully but createVerifiedSignup fails later.
  const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 })
  return (authData?.users ?? []).some(
    (u) => u.email?.toLowerCase() === normalizedEmail
  )
}

export function generateOtp() {
  const min = 10 ** (OTP_LENGTH - 1)
  const max = 10 ** OTP_LENGTH - 1
  return `${crypto.randomInt(min, max + 1)}`
}

export async function sendSignupOtp(email: string) {
  const normalizedEmail = normalizeEmail(email)
  const otp = generateOtp()
  const expiresAt = Date.now() + OTP_TTL_MS

  await sendEmailViaBackend({
    to: normalizedEmail,
    subject: 'NeuroSentinel AI – Your verification code',
    text: [
      'NeuroSentinel AI – Account Verification',
      '',
      `Your verification code is: ${otp}`,
      'This code expires in 10 minutes.',
      '',
      'If you did not request this, you can safely ignore this email.',
      '',
      '--',
      'NeuroSentinel AI – AI-Powered EEG Seizure Detection',
      'Champapet, Hyderabad, Telangana 500079, India',
      APP_URL,
    ].join('\n'),
    html: buildEmailHtml({
      headline: 'NeuroSentinel AI',
      bodyHtml: `
        <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1E293B;margin:0 0 12px">Verify your account</p>
        <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#475569;margin:0 0 22px">Use the code below to finish creating your NeuroSentinel AI account. The code expires in <strong>10 minutes</strong>.</p>
        <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center" style="padding-bottom:22px">
          <div style="display:inline-block;background:#0A4455;border-radius:12px;padding:16px 32px;font-family:Arial,Helvetica,sans-serif;font-size:34px;font-weight:700;letter-spacing:12px;color:#FFFFFF">${otp}</div>
        </td></tr></table>
        <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#94A3B8;margin:0">If you did not request this code, you can safely ignore this email. No action is needed.</p>
      `,
      footerNote: 'NeuroSentinel AI &mdash; This is a transactional security email. You received it because you signed up at neuro-sentinel-ai-6vfv.vercel.app.',
    }),
  })

  const encodedPayload = encodePayload({
    email: normalizedEmail,
    otpHash: hashOtp(normalizedEmail, otp),
    expiresAt,
  })

  return `${encodedPayload}.${signPayload(encodedPayload)}`
}

export function verifySignupOtp(email: string, otp: string, verificationToken: string) {
  const normalizedEmail = normalizeEmail(email)
  const payload = decodePayload(verificationToken)

  if (payload.email !== normalizedEmail) {
    throw new Error('This verification code does not match the current email.')
  }

  if (payload.expiresAt < Date.now()) {
    throw new Error('This verification code has expired. Please request a new one.')
  }

  if (payload.otpHash !== hashOtp(normalizedEmail, otp)) {
    throw new Error('Invalid verification code.')
  }
}

export async function createVerifiedSignup(email: string, password: string) {
  const admin = getAdminClient()

  const { data, error } = await admin.auth.admin.createUser({
    email: normalizeEmail(email),
    password,
    email_confirm: true,
  })

  if (error) {
    throw new Error(error.message)
  }

  if (!data.user) {
    throw new Error('Unable to create account.')
  }

  const { error: profileError } = await admin
    .from('users')
    .upsert(
      {
        id: data.user.id,
        email: normalizeEmail(email),
        role: 'user',
        onboarding_complete: false,
      },
      { onConflict: 'id' }
    )

  if (profileError) {
    throw new Error(profileError.message)
  }
}
export async function sendResetPasswordOtp(email: string) {
  const normalizedEmail = normalizeEmail(email)
  const otp = generateOtp()
  const expiresAt = Date.now() + OTP_TTL_MS

  await sendEmailViaBackend({
    to: normalizedEmail,
    subject: 'NeuroSentinel AI – Password reset code',
    text: [
      'NeuroSentinel AI – Password Reset',
      '',
      `Your password reset code is: ${otp}`,
      'This code expires in 10 minutes.',
      '',
      'If you did not request a password reset, ignore this email. Your account remains secure.',
      '',
      '--',
      'NeuroSentinel AI – AI-Powered EEG Seizure Detection',
      'Champapet, Hyderabad, Telangana 500079, India',
      APP_URL,
    ].join('\n'),
    html: buildEmailHtml({
      headline: 'NeuroSentinel AI',
      bodyHtml: `
        <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1E293B;margin:0 0 12px">Password Reset Request</p>
        <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#475569;margin:0 0 22px">We received a request to reset your NeuroSentinel AI password. Enter the code below to proceed. The code expires in <strong>10 minutes</strong>.</p>
        <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td align="center" style="padding-bottom:22px">
          <div style="display:inline-block;background:#0A4455;border-radius:12px;padding:16px 32px;font-family:Arial,Helvetica,sans-serif;font-size:34px;font-weight:700;letter-spacing:12px;color:#FFFFFF">${otp}</div>
        </td></tr></table>
        <p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#94A3B8;margin:0">If you did not request a password reset, you can safely ignore this email. Your account remains secure.</p>
      `,
      footerNote: 'NeuroSentinel AI &mdash; This is an automated security email sent because a password reset was requested for your account.',
    }),
  })

  const encodedPayload = encodePayload({
    email: normalizedEmail,
    otpHash: hashOtp(normalizedEmail, otp),
    expiresAt,
  })

  return `${encodedPayload}.${signPayload(encodedPayload)}`
}

export async function confirmPasswordReset(email: string, otp: string, verificationToken: string, newPassword: string) {
  const normalizedEmail = normalizeEmail(email)
  const payload = decodePayload(verificationToken)

  if (payload.email !== normalizedEmail) {
    throw new Error('This verification code does not match the current email.')
  }

  if (payload.expiresAt < Date.now()) {
    throw new Error('This verification code has expired. Please request a new one.')
  }

  if (payload.otpHash !== hashOtp(normalizedEmail, otp)) {
    throw new Error('Invalid verification code.')
  }

  const admin = getAdminClient()
  
  // 1. Find user ID from public.users (shared ID with auth.users)
  const { data: userData, error: userError } = await admin
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (userError || !userData) {
    throw new Error('Unable to find user account.')
  }

  // 2. Update password via admin auth
  const { error: updateError } = await admin.auth.admin.updateUserById(userData.id, {
    password: newPassword,
  })

  if (updateError) {
    throw new Error(updateError.message)
  }
}
