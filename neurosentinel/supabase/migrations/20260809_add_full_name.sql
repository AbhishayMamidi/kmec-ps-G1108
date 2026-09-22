-- Add full_name to users table for personalization
alter table public.users add column if not exists full_name text;
