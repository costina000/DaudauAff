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
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    return currentUrl;
  }

  return currentUrl;
}

function extractMeta(html: string, property: string): string {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

    // 1. Resolve vt.tiktok.com / vm.tiktok.com short links.
    const resolvedUrl = await resolveUrl(inputUrl);

    if (!isTikTokUrl(resolvedUrl)) {
      return jsonResponse({
        error: 'Could not resolve TikTok URL',
        input_url: inputUrl,
        resolved_url: resolvedUrl,
      }, 502);
    }

    // 2. Try TikTok's official oEmbed endpoint using the resolved URL.
    let data = await getOembed(resolvedUrl);

    // 3. If oEmbed fails, fetch the TikTok page and read its Open Graph metadata.
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
        error: 'TikTok did not return a thumbnail',
        input_url: inputUrl,
        resolved_url: resolvedUrl,
        hint: 'TikTok may be blocking automated requests for this video. The link itself was resolved successfully.',
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
