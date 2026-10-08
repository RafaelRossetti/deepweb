-- Execute no SQL Editor do projeto Supabase dedicado à atividade.
-- Este arquivo é uma configuração inicial revisável, não uma migração aplicada.
begin;

create table if not exists public.thor_activities (
  code text primary key check (code ~ '^[A-Z2-9]{6}$'),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  revision bigint not null default 1 check (revision > 0 and revision < 9007199254740991),
  created_at timestamptz not null default now()
);

alter table public.thor_activities enable row level security;
revoke all on public.thor_activities from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update on public.thor_activities to service_role;
comment on table public.thor_activities is
  'Estado privado da arena. Apenas o backend usa a chave secreta; alunos acessam a API da aplicação.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('thor-documents', 'thor-documents', false, 3145728, array['application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = 3145728,
  allowed_mime_types = array['application/pdf'];

-- Restrictive policies do not grant access. They stop other, broad policies
-- in an existing project from exposing this private bucket to browser roles.
-- The service_role used by the backend bypasses RLS.
drop policy if exists thor_documents_server_only on storage.objects;
create policy thor_documents_server_only on storage.objects
  as restrictive for all to anon, authenticated
  using (bucket_id <> 'thor-documents')
  with check (bucket_id <> 'thor-documents');

drop policy if exists thor_bucket_server_only on storage.buckets;
create policy thor_bucket_server_only on storage.buckets
  as restrictive for all to anon, authenticated
  using (id <> 'thor-documents')
  with check (id <> 'thor-documents');

commit;

-- Verificação: o bucket deve estar privado; a tabela deve ter RLS ativado.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'thor-documents';
select relname, relrowsecurity
from pg_class where oid = 'public.thor_activities'::regclass;
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'thor_activities'
order by grantee, privilege_type;
