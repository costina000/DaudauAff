-- Add an optional TikTok video URL to each product.
alter table public.products
add column if not exists video_url text;
