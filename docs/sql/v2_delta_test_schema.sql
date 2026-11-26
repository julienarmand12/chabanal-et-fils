-- TEST ONLY: V2 delta schema for the isolated Chabanal et fils validation project.
-- Workspace and owner match sync-v2-delta.js in this test branch.
-- Do not apply this script to production as-is.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.app_v2_workspaces (
  id uuid primary key,
  name text not null,
  owner_id uuid not null references auth.users(id),
  change_seq bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.app_v2_devices (
  id uuid primary key,
  workspace_id uuid not null references public.app_v2_workspaces(id) on delete cascade,
  device_label text not null default 'Appareil',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table public.app_v2_records (
  workspace_id uuid not null references public.app_v2_workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in (
    'client','intervention','equipment_model','equipment_installation',
    'equipment_serial','media','stock_item','notification',
    'diagnostic_brand','recovery_time','deletion_marker'
  )),
  record_id text not null,
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  primary key (workspace_id, entity_type, record_id)
);

create table public.app_v2_change_log (
  seq bigint generated always as identity primary key,
  workspace_id uuid not null references public.app_v2_workspaces(id) on delete cascade,
  entity_type text not null,
  record_id text not null,
  operation text not null check (operation in ('upsert','delete')),
  revision bigint not null,
  payload jsonb not null,
  changed_at timestamptz not null default now()
);
create index app_v2_change_log_workspace_seq_idx
  on public.app_v2_change_log (workspace_id, seq);
create index app_v2_workspaces_owner_id_idx
  on public.app_v2_workspaces(owner_id);
create index app_v2_records_updated_by_idx
  on public.app_v2_records(updated_by);

create table public.app_v2_sync_cursors (
  workspace_id uuid not null,
  device_id uuid not null,
  last_seq bigint not null default 0 check (last_seq >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, device_id),
  foreign key (workspace_id, device_id)
    references public.app_v2_devices(workspace_id, id) on delete cascade
);

create or replace function private.v2_records_set_revision()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.created_at := coalesce(new.created_at, pg_catalog.clock_timestamp());
  else
    new.revision := old.revision + 1;
    new.created_at := old.created_at;
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create or replace function private.v2_records_log_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_seq bigint; v_operation text;
begin
  v_operation := case when new.deleted_at is not null then 'delete' else 'upsert' end;
  insert into public.app_v2_change_log (
    workspace_id, entity_type, record_id, operation, revision, payload, changed_at
  ) values (
    new.workspace_id, new.entity_type, new.record_id, v_operation,
    new.revision, new.payload, pg_catalog.clock_timestamp()
  ) returning seq into v_seq;
  update public.app_v2_workspaces
     set change_seq = v_seq, updated_at = pg_catalog.clock_timestamp()
   where id = new.workspace_id;
  return new;
end;
$$;

create trigger app_v2_records_set_revision
before insert or update on public.app_v2_records
for each row execute function private.v2_records_set_revision();
create trigger app_v2_records_log_change
after insert or update on public.app_v2_records
for each row execute function private.v2_records_log_change();

revoke all on function private.v2_records_set_revision() from public, anon, authenticated;
revoke all on function private.v2_records_log_change() from public, anon, authenticated;

alter table public.app_v2_workspaces enable row level security;
alter table public.app_v2_devices enable row level security;
alter table public.app_v2_records enable row level security;
alter table public.app_v2_change_log enable row level security;
alter table public.app_v2_sync_cursors enable row level security;

create policy app_v2_workspaces_owner_select
on public.app_v2_workspaces for select to authenticated
using ((select auth.uid()) = owner_id);

create policy app_v2_devices_workspace_select
on public.app_v2_devices for select to authenticated
using (exists (select 1 from public.app_v2_workspaces w
  where w.id = app_v2_devices.workspace_id and w.owner_id = (select auth.uid())));
create policy app_v2_devices_workspace_insert
on public.app_v2_devices for insert to authenticated
with check (exists (select 1 from public.app_v2_workspaces w
  where w.id = app_v2_devices.workspace_id and w.owner_id = (select auth.uid())));
create policy app_v2_devices_workspace_update
on public.app_v2_devices for update to authenticated
using (exists (select 1 from public.app_v2_workspaces w
  where w.id = app_v2_devices.workspace_id and w.owner_id = (select auth.uid())))
with check (exists (select 1 from public.app_v2_workspaces w
  where w.id = app_v2_devices.workspace_id and w.owner_id = (select auth.uid())));

create policy app_v2_records_workspace_select
on public.app_v2_records for select to authenticated
using (exists (select 1 from public.app_v2_workspaces w
  where w.id = app_v2_records.workspace_id and w.owner_id = (select auth.uid())));
create policy app_v2_records_workspace_insert
on public.app_v2_records for insert to authenticated
with check (exists (select 1 from public.app_v2_workspaces w
  where w.id = app_v2_records.workspace_id and w.owner_id = (select auth.uid())));
create policy app_v2_records_workspace_update
on public.app_v2_records for update to authenticated
using (exists (select 1 from public.app_v2_workspaces w
  where w.id = app_v2_records.workspace_id and w.owner_id = (select auth.uid())))
with check (exists (select 1 from public.app_v2_workspaces w
  where w.id = app_v2_records.workspace_id and w.owner_id = (select auth.uid())));

create policy app_v2_change_log_workspace_select
on public.app_v2_change_log for select to authenticated
using (exists (select 1 from public.app_v2_workspaces w
  where w.id = app_v2_change_log.workspace_id and w.owner_id = (select auth.uid())));

create policy app_v2_sync_cursors_workspace_select
on public.app_v2_sync_cursors for select to authenticated
using (exists (select 1 from public.app_v2_workspaces w
  where w.id = app_v2_sync_cursors.workspace_id and w.owner_id = (select auth.uid())));
create policy app_v2_sync_cursors_workspace_insert
on public.app_v2_sync_cursors for insert to authenticated
with check (
  exists (select 1 from public.app_v2_workspaces w
    where w.id = app_v2_sync_cursors.workspace_id and w.owner_id = (select auth.uid()))
  and exists (select 1 from public.app_v2_devices d
    where d.workspace_id = app_v2_sync_cursors.workspace_id and d.id = app_v2_sync_cursors.device_id)
);
create policy app_v2_sync_cursors_workspace_update
on public.app_v2_sync_cursors for update to authenticated
using (exists (select 1 from public.app_v2_workspaces w
  where w.id = app_v2_sync_cursors.workspace_id and w.owner_id = (select auth.uid())))
with check (
  exists (select 1 from public.app_v2_workspaces w
    where w.id = app_v2_sync_cursors.workspace_id and w.owner_id = (select auth.uid()))
  and exists (select 1 from public.app_v2_devices d
    where d.workspace_id = app_v2_sync_cursors.workspace_id and d.id = app_v2_sync_cursors.device_id)
);

revoke all on public.app_v2_workspaces, public.app_v2_devices,
  public.app_v2_records, public.app_v2_change_log, public.app_v2_sync_cursors
  from public, anon, authenticated;
grant select on public.app_v2_workspaces, public.app_v2_change_log to authenticated;
grant select, insert, update on public.app_v2_devices,
  public.app_v2_records, public.app_v2_sync_cursors to authenticated;

insert into public.app_v2_workspaces (id, name, owner_id)
values ('ad49e922-7fd9-447d-b5df-0e5de2ce2554',
  'Chabanal et fils — environnement de test V2',
  '560058e6-bc5c-4fff-ae80-562cc89b64bb');
