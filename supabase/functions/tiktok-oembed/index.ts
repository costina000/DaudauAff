import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const browserHeaders = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isTikTokUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return host === 'tiktok.com' || host.endsWith('.tiktok.com');
  } catch {
    return false;
  }
}

function isShortTikTokUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return host === 'vt.tiktok.com' || host === 'vm.tiktok.com' || host === 't.tiktok.com';
  } catch {
    return false;
  }
}

function extractMeta(html: string, property: string): string {
  const escaped = property.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  return '';
}

function extractCanonical(html: string): string {
  const patterns = [
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }

  return '';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getOembed(url: string) {
  try {
    const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
    const response = await fetch(endpoint, {
      headers: { Accept: 'application/json', 'User-Agent': browserHeaders['User-Agent'] },
      redirect: 'follow',
    });

    if (!response.ok) return null;
    const json = await response.json();
    return json?.thumbnail_url ? json : null;
  } catch {
    return null;
  }
}

async function getTikwmMetadata(url: string) {
  try {
    const body = new URLSearchParams({ url, hd: '1' });
    const response = await fetch('https://www.tikwm.com/api/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': browserHeaders['User-Agent'],
      },
      body: body.toString(),
    });

    if (!response.ok) return null;

    const json = await response.json();
    if (json?.code !== 0 || !json?.data) return null;

    const data = json.data;
    const thumbnail = data.cover || data.origin_cover || data.dynamic_cover || '';
    if (!thumbnail) return null;

    return {
      thumbnail_url: thumbnail,
      title: data.title || '',
      author_name: data.author?.nickname || data.author?.unique_id || '',
      author_url: data.author?.unique_id
        ? `https://www.tiktok.com/@${data.author.unique_id}`
        : '',
      video_url: data.share_url || url,
      input_url: url,
      source: 'tikwm',
    };
  } catch {
    return null;
  }
}

async function getShortLinkMetadata(url: string) {
  // TikTok itself notes that share links can be temporarily unavailable just
  // after they are created. TikWM also documents a short-link delay, so retry
  // automatically instead of asking the user to do anything manually.
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await getTikwmMetadata(url);
    if (result) return result;
    if (attempt < 2) await sleep(1500 * (attempt + 1));
  }
  return null;
}

async function resolveUrl(inputUrl: string): Promise<string> {
  let currentUrl = inputUrl;

  for (let i = 0; i < 6; i++) {
    try {
      const response = await fetch(currentUrl, {
        method: 'GET',
        headers: browserHeaders,
        redirect: 'manual',
      });

      const location = response.headers.get('location');
      if (!location) return currentUrl;

      const nextUrl = new URL(location, currentUrl).toString();
      const next = new URL(nextUrl);

      // TikTok sometimes redirects automated requests to its homepage.
      // Never treat that homepage as the video URL.
      if (next.hostname === 'www.tiktok.com' && next.pathname === '/') {
        return currentUrl;
      }

      currentUrl = nextUrl;
    } catch {
      return currentUrl;
    }
  }

  return currentUrl;
}

async function getPageMetadata(url: string) {
  try {
    const response = await fetch(url, {
      headers: browserHeaders,
      redirect: 'follow',
    });

    if (!response.ok) return null;

    const html = await response.text();
    const thumbnail =
      extractMeta(html, 'og:image') ||
      extractMeta(html, 'twitter:image') ||
      extractMeta(html, 'twitter:image:src');

    if (!thumbnail) return null;

    return {
      thumbnail_url: thumbnail,
      title: extractMeta(html, 'og:title'),
      video_url: extractCanonical(html) || url,
      input_url: url,
      source: 'tiktok-page',
    };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const authorization = req.headers.get('Authorization');
    if (!authorization) return jsonResponse({ error: 'Unauthorized' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authorization } } },
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const body = await req.json();
    const inputUrl = String(body?.url ?? '').trim();

    if (!inputUrl) return jsonResponse({ error: 'Missing TikTok URL' }, 400);
    if (!isTikTokUrl(inputUrl)) return jsonResponse({ error: 'Invalid TikTok URL' }, 400);

    // 1. Short share links: use the metadata resolver first and retry
    // automatically because newly-created TikTok share links can be delayed.
    if (isShortTikTokUrl(inputUrl)) {
      const shortMetadata = await getShortLinkMetadata(inputUrl);
      if (shortMetadata) return jsonResponse(shortMetadata);
    }

    // 2. Official TikTok oEmbed for canonical URLs (and as a second attempt).
    let data = await getOembed(inputUrl);
    let resolvedUrl = inputUrl;

    if (data?.thumbnail_url) {
      return jsonResponse({
        thumbnail_url: data.thumbnail_url,
        title: data.title || '',
        author_name: data.author_name || '',
        author_url: data.author_url || '',
        video_url: inputUrl,
        input_url: inputUrl,
        source: 'tiktok-oembed',
      });
    }

    resolvedUrl = await resolveUrl(inputUrl);

    if (resolvedUrl !== inputUrl && isTikTokUrl(resolvedUrl)) {
      data = await getOembed(resolvedUrl);
      if (data?.thumbnail_url) {
        return jsonResponse({
          thumbnail_url: data.thumbnail_url,
          title: data.title || '',
          author_name: data.author_name || '',
          author_url: data.author_url || '',
          video_url: resolvedUrl,
          input_url: inputUrl,
          source: 'tiktok-oembed-resolved',
        });
      }
    }

    // 3. Last metadata fallback for canonical URLs.
    const pageMetadata = await getPageMetadata(resolvedUrl);
    if (pageMetadata) {
      return jsonResponse({
        ...pageMetadata,
        author_name: '',
        author_url: '',
      });
    }

    return jsonResponse({
      error: 'TikTok thumbnail could not be fetched automatically',
      input_url: inputUrl,
      resolved_url: resolvedUrl,
      hint: 'The video may be private, deleted, unavailable, or temporarily blocked by TikTok.',
    }, 502);
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Unexpected error',
    }, 500);
  }
});
