import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://neuro-sentinel-ai-6vfv.vercel.app').replace(/\/+$/, '')

function normalizeEmailHtml(rawHtml: string) {
  return rawHtml.replace(/href=(["'])(https?:\/\/[^"'<>]+)\1/gi, (match, quote, url) => {
    const normalized = String(url).trim()
    if (
      normalized.includes('neuro-sentinel-ai-6vfv.vercel.app') ||
      normalized.includes('neurosentinel.vercel.app') ||
      normalized.includes('/dashboard')
    ) {
      return `href=${quote}${APP_URL}${quote}`
    }
    return match
  })
}

/**
 * INTERNAL API ROUTE
 * Relays analysis reports from the Hugging Face backend (SMTP blocked there)
 * to the Vercel environment (SMTP allowed).
 *
 * Uses SMTP_USER / SMTP_PASSWORD from env — should be a dedicated Gmail account
 * (e.g. neurosentinelai.noreply@gmail.com), NOT a personal address.
 * Gmail SMTP automatically provides SPF + DKIM authentication for @gmail.com senders.
 */

export async function POST(req: NextRequest) {
  const secret     = process.env.INTERNAL_API_SECRET
  const authHeader = req.headers.get('x-internal-secret')

  if (!secret) {
    console.error('[send-report] INTERNAL_API_SECRET env var is not set — rejecting relay request')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  if (authHeader !== secret) {
    return NextResponse.json({ error: 'Unauthorized relay request' }, { status: 401 })
  }

  // Resolve sender from env — never fall back to a hardcoded personal address
  const smtpUser = process.env.SMTP_USER
  const smtpPass = process.env.SMTP_PASSWORD
  const fromEmail = process.env.SMTP_FROM_EMAIL ?? smtpUser
  const fromName  = process.env.SMTP_FROM_NAME  ?? 'NeuroSentinel AI'

  if (!smtpUser || !smtpPass) {
    console.error('[send-report] SMTP_USER / SMTP_PASSWORD not configured')
    return NextResponse.json(
      { error: 'Email service not configured. Set SMTP_USER and SMTP_PASSWORD in Vercel env vars.' },
      { status: 500 }
    )
  }

  try {
    const body = await req.json()
    const { to_email, subject, html, text, pdf_base64, filename } = body

    if (!to_email || !subject || !html) {
      return NextResponse.json({ error: 'Missing required mail fields' }, { status: 400 })
    }

    const normalizedHtml = normalizeEmailHtml(String(html))

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: { user: smtpUser, pass: smtpPass.replace(/\s/g, '') },
    })

    const attachments: { filename: string; content: string; encoding: string }[] = []
    if (pdf_base64) {
      attachments.push({
        filename: filename || 'NeuroSentinel_AI_Report.pdf',
        content:  pdf_base64,
        encoding: 'base64',
      })
    }

    // Plain-text fallback (improves spam score and is required by CAN-SPAM)
    const plainText = text || [
      'NeuroSentinel AI — EEG Analysis Report',
      '',
      'Please view this email in an HTML-capable mail client to see your full report.',
      `You can also access your reports at: ${APP_URL}/dashboard/eeg-reports`,
      '',
      '--',
      'NeuroSentinel AI — AI-Powered EEG Seizure Detection',
      'Champapet, Hyderabad, Telangana 500079, India',
      APP_URL,
    ].join('\n')

    await transporter.sendMail({
      from:    `"${fromName}" <${fromEmail}>`,
      to:      to_email,
      subject,
      html:    normalizedHtml,
      text:    plainText,
      attachments,
      // List-Unsubscribe header: Gmail reads this natively and may show an unsubscribe link.
      // For report emails the user requested, this is informational only.
      headers: {
        'List-Unsubscribe':      `<mailto:${fromEmail}?subject=Unsubscribe>, <${APP_URL}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'X-Mailer':              'NeuroSentinel AI Mailer',
        'X-Entity-Ref-ID':       `neurosentinelai-report-${Date.now()}`,
      },
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[send-report] Email relay failed:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
