-- Chạy đoạn SQL này trong Supabase SQL Editor 1 lần.
alter table public.products
add column if not exists pinned boolean not null default false;

create index if not exists products_pinned_sort_idx
on public.products (pinned desc, sort_order asc, created_at desc);
