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
    return (
      host === 'vt.tiktok.com' ||
      host === 'vm.tiktok.com' ||
      host === 't.tiktok.com'
    );
  } catch {
    return false;
  }
}

function extractMeta(html: string, property: string): string {
  const escaped = property.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, 'i'),
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

async function getOembed(url: string) {
  const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
  const response = await fetch(endpoint, {
    headers: { Accept: 'application/json', 'User-Agent': browserHeaders['User-Agent'] },
    redirect: 'follow',
  });

  if (!response.ok) return null;

  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * TikTok's official oEmbed endpoint does not reliably accept vt/vm short links.
 * Use TikWM only as a metadata fallback for short links, then fall back to
 * TikTok oEmbed/page metadata for normal canonical URLs.
 */
async function getShortLinkMetadata(url: string) {
  try {
    const body = new URLSearchParams();
    body.set('url', url);
    body.set('hd', '1');

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
    return {
      thumbnail_url: data.cover ?? data.origin_cover ?? '',
      title: data.title ?? '',
      author_name: data.author?.nickname ?? data.author?.unique_id ?? '',
      author_url: data.author?.unique_id
        ? `https://www.tiktok.com/@${data.author.unique_id}`
        : '',
      video_url: data.share_url ?? url,
      input_url: url,
    };
  } catch {
    return null;
  }
}

async function resolveUrl(inputUrl: string): Promise<string> {
  let currentUrl = inputUrl;

  for (let i = 0; i < 6; i++) {
    const response = await fetch(currentUrl, {
      method: 'GET',
      headers: browserHeaders,
      redirect: 'manual',
    });

    const location = response.headers.get('location');
    if (location) {
      const nextUrl = new URL(location, currentUrl).toString();

      // TikTok sometimes redirects bots to the homepage. Do not treat that
      // homepage as the resolved video URL.
      try {
        const next = new URL(nextUrl);
        if (next.hostname === 'www.tiktok.com' && next.pathname === '/') {
          return currentUrl;
        }
      } catch {
        // Ignore malformed redirect and keep the current URL.
      }

      currentUrl = nextUrl;
      continue;
    }

    return currentUrl;
  }

  return currentUrl;
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
    if (!authorization) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authorization } } },
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const body = await req.json();
    const inputUrl = String(body?.url ?? '').trim();

    if (!inputUrl) {
      return jsonResponse({ error: 'Missing TikTok URL' }, 400);
    }

    if (!isTikTokUrl(inputUrl)) {
      return jsonResponse({ error: 'Invalid TikTok URL' }, 400);
    }

    // Short links are handled first by a metadata resolver because TikTok's
    // official oEmbed endpoint does not reliably resolve vt/vm links.
    if (isShortTikTokUrl(inputUrl)) {
      const shortMetadata = await getShortLinkMetadata(inputUrl);
      if (shortMetadata?.thumbnail_url) {
        return jsonResponse(shortMetadata);
      }
    }

    // Try TikTok's official oEmbed endpoint directly.
    let data = await getOembed(inputUrl);
    let resolvedUrl = inputUrl;

    // If the input is a normal canonical URL, oEmbed should be enough.
    // For other TikTok links, try resolving the redirect and then oEmbed.
    if (!data) {
      resolvedUrl = await resolveUrl(inputUrl);
      if (isTikTokUrl(resolvedUrl) && resolvedUrl !== inputUrl) {
        data = await getOembed(resolvedUrl);
      }
    }

    let thumbnailUrl = data?.thumbnail_url ?? '';
    let title = data?.title ?? '';
    let authorName = data?.author_name ?? '';
    let authorUrl = data?.author_url ?? '';
    let canonicalUrl = resolvedUrl;

    if (!thumbnailUrl) {
      const pageResponse = await fetch(resolvedUrl, {
        headers: browserHeaders,
        redirect: 'follow',
      });

      if (pageResponse.ok) {
        const html = await pageResponse.text();

        thumbnailUrl =
          extractMeta(html, 'og:image') ||
          extractMeta(html, 'twitter:image') ||
          extractMeta(html, 'twitter:image:src');

        title = title || extractMeta(html, 'og:title');
        canonicalUrl = extractCanonical(html) || canonicalUrl;
      }
    }

    if (!thumbnailUrl) {
      return jsonResponse({
        error: 'TikTok thumbnail could not be fetched',
        input_url: inputUrl,
        resolved_url: resolvedUrl,
        hint: 'The TikTok link may be private, unavailable, expired, or blocked from automated metadata requests.',
      }, 502);
    }

    return jsonResponse({
      thumbnail_url: thumbnailUrl,
      title,
      author_name: authorName,
      author_url: authorUrl,
      video_url: canonicalUrl,
      input_url: inputUrl,
    });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Unexpected error',
    }, 500);
  }
});
