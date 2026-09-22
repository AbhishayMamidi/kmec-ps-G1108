create extension if not exists pgcrypto;

create table if not exists public.users (
  id uuid primary key,
  email text,
  role text check (role in ('clinician', 'researcher', 'patient')) null,
  onboarding_complete boolean not null default false,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  filename text not null,
  storage_path text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  error_message text,
  report_json jsonb,
  summary text,
  result_label text,
  event_count integer,
  confidence_score numeric,
  duration_minutes numeric,
  quality_grade text,
  risk_level text,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  report_id uuid references public.reports (id) on delete set null,
  page_context text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table public.reports add column if not exists storage_path text;
alter table public.reports add column if not exists status text not null default 'pending';
alter table public.reports add column if not exists error_message text;
alter table public.reports add column if not exists report_json jsonb;
alter table public.reports add column if not exists summary text;
alter table public.reports add column if not exists result_label text;
alter table public.reports add column if not exists event_count integer;
alter table public.reports add column if not exists confidence_score numeric;
alter table public.reports add column if not exists duration_minutes numeric;
alter table public.reports add column if not exists quality_grade text;
alter table public.reports add column if not exists risk_level text;

alter table public.chat_messages add column if not exists report_id uuid references public.reports (id) on delete set null;
alter table public.chat_messages add column if not exists page_context text;
alter table public.chat_messages add column if not exists metadata jsonb;

create index if not exists reports_user_created_at_idx on public.reports (user_id, created_at desc);
create index if not exists reports_status_idx on public.reports (status);
create index if not exists chat_messages_user_created_at_idx on public.chat_messages (user_id, created_at desc);
create index if not exists chat_messages_report_created_at_idx on public.chat_messages (report_id, created_at desc);

alter table public.users enable row level security;
alter table public.reports enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists own_user on public.users;
drop policy if exists own_reports on public.reports;
drop policy if exists own_messages on public.chat_messages;

create policy own_user on public.users for all using (auth.uid() = id) with check (auth.uid() = id);
create policy own_reports on public.reports for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy own_messages on public.chat_messages for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('eeg-uploads', 'eeg-uploads', false)
on conflict (id) do nothing;

drop policy if exists "Users can manage their own EEG uploads" on storage.objects;
create policy "Users can manage their own EEG uploads"
on storage.objects
for all
using (bucket_id = 'eeg-uploads' and auth.uid()::text = (storage.foldername(name))[1])
with check (bucket_id = 'eeg-uploads' and auth.uid()::text = (storage.foldername(name))[1]);
