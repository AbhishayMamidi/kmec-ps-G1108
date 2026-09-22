<![CDATA[# NeuroSentinel — Frontend

Next.js 14 (App Router) web app for NeuroSentinel AI — the clinical EEG seizure detection platform.

**Live:** [https://neurosentinel.vercel.app](https://neurosentinel.vercel.app)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Auth & DB | Supabase |
| AI (SCOUT) | Google Gemini via `@ai-sdk/google` |
| Charts | Recharts |
| Email | Nodemailer (via backend SMTP relay) |
| PDF | pdf-lib |

---

## Getting Started

```bash
# Install dependencies
npm install

# Copy env template
cp .env.example .env.local
# Fill in all values in .env.local

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your values. See the root [README](../README.md#frontend--nextjs-vercel) for a description of each variable.

---

## Project Structure

```
neurosentinel/
├── app/
│   ├── api/                # Next.js API routes
│   │   ├── auth/           # OTP, signup, password reset
│   │   ├── upload/         # EDF file upload → Supabase Storage
│   │   ├── job-status/     # Backend job polling
│   │   ├── chat/           # SCOUT AI streaming chat
│   │   └── reports/        # PDF generation proxy
│   ├── components/         # Shared UI components (SCOUT, toasts)
│   ├── dashboard/          # Authenticated dashboard pages
│   ├── report/[id]/        # Report viewer
│   ├── login/              # Auth page
│   ├── onboarding/         # New-user onboarding
│   ├── privacy/            # Privacy policy
│   └── terms/              # Terms of service
├── lib/
│   ├── supabase/           # Supabase client (browser, server, admin)
│   ├── neurosentinel/      # Shared types and UI config
│   └── scout-guide.ts      # SCOUT AI product guide
└── middleware.ts            # Auth middleware
```

---

## Deployment (Vercel)

1. Import the repo to Vercel, set **Root Directory** to `neurosentinel/`.
2. Add all environment variables from `.env.example` in the Vercel dashboard.
3. Deploy — Vercel auto-builds on push to `main`.
]]>
