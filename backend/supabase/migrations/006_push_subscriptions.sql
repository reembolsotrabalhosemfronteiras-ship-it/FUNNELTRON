-- ============================================================================
-- 006 — Assinaturas de notificação push (PIX gerado / PIX pago)
-- ============================================================================
-- Rode no SQL Editor do Supabase. É idempotente (pode rodar duas vezes).
--
-- Uma linha por navegador inscrito. `endpoint` é único por definição do Push
-- API (identifica o navegador+dispositivo junto ao serviço de push do SO), e
-- é o que usamos pra deduplicar reinscrições do mesmo aparelho.
create table if not exists public.push_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users on delete cascade not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Usuários gerenciam próprias inscrições push" on public.push_subscriptions;
create policy "Usuários gerenciam próprias inscrições push"
  on public.push_subscriptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
