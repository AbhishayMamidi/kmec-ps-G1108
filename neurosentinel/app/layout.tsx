import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { ScoutFloating } from './components/scout-floating'
import { ScoutProvider } from './components/scout-provider'
import { ReportNotificationProvider } from './components/report-notification-provider'
import { ReportNotificationToast } from './components/report-notification-toast'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
})

const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
})

export const metadata: Metadata = {
  title: 'NeuroSentinel AI - AI-Powered Seizure Intelligence',
  description:
    'NeuroSentinel AI uses advanced AI to analyse EEG and neurological reports, providing clinicians and patients with actionable seizure intelligence.',
  keywords: ['seizure detection', 'EEG analysis', 'neurology AI', 'NeuroSentinel AI'],
  authors: [{ name: 'NeuroSentinel AI' }],
}

export const viewport: Viewport = {
  themeColor: '#0A0A0F',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} bg-bg-primary text-text-primary antialiased`}>
        <ScoutProvider>
          <ReportNotificationProvider>
            {children}
            <ScoutFloating />
            <ReportNotificationToast />
          </ReportNotificationProvider>
        </ScoutProvider>
      </body>
    </html>
  )
}
