# Thiết lập Admin + Supabase

Website vẫn chạy trên GitHub Pages. Supabase chỉ dùng cho đăng nhập và dữ liệu sản phẩm.

## 1. Tạo project Supabase
Tạo một project mới tại https://supabase.com/.

## 2. Tạo bảng products
Mở SQL Editor và chạy:

```sql
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'Khác',
  affiliate_url text not null,
  image_url text not null,
  description text default '',
  price text default '',
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.products enable row level security;

create policy "public can read active products"
on public.products for select
using (active = true);

create policy "authenticated can manage products"
on public.products for all
to authenticated
using (true)
with check (true);
```

## 3. Tạo tài khoản admin
Trong Supabase: Authentication → Users → Add user. Tạo email + password riêng cho tài khoản quản trị.

## 4. Điền config
Mở `supabase-config.js`, lấy Project URL và anon/public key trong Supabase → Project Settings → API rồi điền vào 2 biến.

**Không bao giờ đưa `service_role` key lên GitHub Pages.**

## 5. Mở Admin
Sau khi Pages deploy xong:
`https://costina000.github.io/DaudauAff/admin.html`

Đăng nhập bằng tài khoản Supabase admin.

> Bản hiện tại quản lý sản phẩm bằng URL ảnh. Upload file ảnh trực tiếp lên Supabase Storage sẽ được thêm ở bước tiếp theo sau khi Storage bucket được tạo và policy được cấu hình.
