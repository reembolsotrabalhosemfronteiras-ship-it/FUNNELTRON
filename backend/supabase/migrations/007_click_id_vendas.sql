-- 007_click_id_vendas.sql
-- Liga cada venda (live_sales) à sessão de navegação que a gerou, via
-- `click_id` — o placeholder que a PerfectPay preenche no postback com o
-- valor do parâmetro `click_id` presente na URL do checkout no momento da
-- compra. O tracker.js já gera esse identificador (sessionStorage) e agora
-- também o propaga como `click_id` nos links entre páginas do funil.
--
-- Com o session_id em mãos, o webhook resolve o step_id da venda pela última
-- página que a sessão visitou (live_beats.step_id) — hoje isso só chegava
-- quando vinha pronto no payload, e a PerfectPay nunca manda step_id.

alter table public.live_sales
  add column if not exists session_id text;

create index if not exists live_sales_session_id_idx
  on public.live_sales (session_id) where session_id is not null;
