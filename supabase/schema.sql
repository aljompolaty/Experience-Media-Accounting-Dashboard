-- Experience Media accounting dashboard — Supabase schema.
-- Run once in Supabase: SQL Editor → New query → paste → Run.
--
-- One row per user holds the whole dashboard document (projects, clients, suppliers, ...).
-- `revision` increases on every save; the app only overwrites the revision it last saw,
-- so a stale device can never silently overwrite newer data from another device.

create table if not exists public.workspaces (
    user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
    data       jsonb       not null,
    revision   integer     not null default 1,
    device     text,
    updated_at timestamptz not null default now()
);

-- Daily safety copies: the first save of each day keeps the previous version here.
create table if not exists public.workspace_snapshots (
    id         bigserial primary key,
    user_id    uuid        not null references auth.users (id) on delete cascade,
    data       jsonb       not null,
    revision   integer     not null,
    created_at timestamptz not null default now()
);
create index if not exists workspace_snapshots_user_created on public.workspace_snapshots (user_id, created_at desc);

-- Row level security: every user sees and changes only their own rows.
alter table public.workspaces enable row level security;
alter table public.workspace_snapshots enable row level security;

drop policy if exists "workspaces: own row" on public.workspaces;
create policy "workspaces: own row" on public.workspaces
    for all to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists "snapshots: read own" on public.workspace_snapshots;
create policy "snapshots: read own" on public.workspace_snapshots
    for select to authenticated
    using (user_id = auth.uid());

create or replace function public.snapshot_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    new.updated_at := now();
    if not exists (
        select 1 from public.workspace_snapshots
        where user_id = old.user_id and created_at >= date_trunc('day', now())
    ) then
        insert into public.workspace_snapshots (user_id, data, revision)
        values (old.user_id, old.data, old.revision);
    end if;
    return new;
end;
$$;

drop trigger if exists workspaces_snapshot on public.workspaces;
create trigger workspaces_snapshot
    before update on public.workspaces
    for each row execute function public.snapshot_workspace();
