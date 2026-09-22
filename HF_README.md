---
title: NeuroSentinel AI Backend
emoji: 🧠
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
---

# NeuroSentinel AI — Backend API

FastAPI backend powering the NeuroSentinel AI clinical EEG analysis platform.

## What it does

- Accepts EDF (EEG) file uploads via `POST /api/v1/analyze`
- Runs the NeuroSentinel AI ML pipeline (preprocessing → inference → explainability → report)
- Writes structured reports to Supabase
- Serves job status via `GET /api/v1/job-status/{report_id}`
- Sends email notifications on completion via SendGrid

## Stack

- **Runtime:** Python 3.11, FastAPI, Uvicorn
- **ML:** PyTorch, MNE-Python
- **Storage:** Supabase (PostgreSQL + Auth)
- **Containerized:** Docker (see `Dockerfile`)

## Authentication

All endpoints require a valid Supabase JWT in the `Authorization: Bearer <token>` header.

## Configuration

Set the following environment variables in the HF Space settings:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `SENDGRID_API_KEY` | SendGrid API key for email reports |
| `GOOGLE_API_KEY` | Gemini API key for SCOUT assistant |
| `FRONTEND_URL` | URL of the NeuroSentinel AI frontend |
