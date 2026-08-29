-- Add TikTok thumbnail URL for product videos
alter table public.products
add column if not exists video_thumbnail_url text;
