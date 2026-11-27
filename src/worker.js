// Clean ytmp3.gl scraper worker with strict junk/Google/YouTube URL filtering

const CREATOR = "👨‍💻 SHADOW MOVIE X MAIN OWNER 👨‍💻";
const TOOL_URL = "https://ytmp3.gl/";
const ORIGIN_URL = "https://ytmp3.gl";
const CACHE_TTL_SEC = 600;

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,si;q=0.8",
};

const BLOCKED_HOSTS = [
  "accounts.google.com",
  "google.com",
  "www.google.com",
  "youtube.com",
  "www.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.gstatic.com",
  "gstatic.com",
  "i.ytimg.com",
  "yt3.ggpht.com",
  "ggpht.com",
  "googletagmanager.com",
  "google-analytics.com",
];

function jsonRes(payload, status = 200, cacheStatus = "MISS") {
  return new Response(
    JSON.stringify(
      {
        creator: CREATOR,
        ...payload,
      },
      null,
      2
    ),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Cache-Control": `public, max-age=${CACHE_TTL_SEC}`,
        "X-Cache": cacheStatus,
      },
    }
  );
}

function sanitizeFileName(rawTitle = "audio", ext = "mp3") {
  const cleaned = String(rawTitle || "audio")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  return `${cleaned || "shadow_music"}.${ext.replace(/^\.+/, "")}`;
}

function extractYouTubeId(rawUrl = "") {
  const s = String(rawUrl || "").trim();
  const patterns = [
    /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|music\.youtube\.com\/watch\?.*v=|youtube\.com\/shorts\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m && m[1]) return m[1];
  }
  return null;
}

function normalizeYouTubeUrl(rawUrl = "") {
  const s = String(rawUrl || "").trim();
  const vid = extractYouTubeId(s);
  if (vid) return `https://www.youtube.com/watch?v=${vid}`;
  return s;
}

function decodeHtml(str = "") {
  return String(str)
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/");
}

function absUrl(raw, base = ORIGIN_URL) {
  if (!raw) return null;
  try {
    return new URL(decodeHtml(raw), base).toString();
  } catch (_) {
    return null;
  }
}

function isValidAudioDownloadUrl(candidate = "") {
  const clean = decodeHtml(String(candidate || "").trim());
  if (!/^https?:\/\//i.test(clean)) return false;

  let u;
  try {
    u = new URL(clean);
  } catch (_) {
    return false;
  }

  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTS.some((b) => host === b || host.endsWith(`.${b}`))) {
    return false;
  }

  const fullLower = clean.toLowerCase();
  if (
    fullLower.includes("servicelogin") ||
    fullLower.includes("signin") ||
    /\.(?:json|js|css|html|php|png|jpg|jpeg|webp|gif|svg|woff2?|ttf|map)(?:$|\?)/i.test(
      u.pathname
    )
  ) {
    return false;
  }

  return (
    /\.mp3(?:$|\?)/i.test(u.pathname) ||
    /\/(?:download|dl|mp3|audio|stream|getfile|convert)(?:\/|$|\?)/i.test(
      u.pathname + u.search
    )
  );
}

function isChallengeHtml(html = "") {
  return /__cf_chl_|cf-browser-verification|just a moment\.\.\.|checking your browser before accessing/i.test(
    html
  );
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractScriptUrls(html = "") {
  const scripts = new Set();
  for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const full = absUrl(m[1], ORIGIN_URL);
    if (!full) continue;
    try {
      const h = new URL(full).hostname.toLowerCase();
      if (BLOCKED_HOSTS.some((b) => h === b || h.endsWith(`.${b}`))) continue;
      scripts.add(full);
      if (scripts.size >= 6) break;
    } catch (_) {}
  }
  return [...scripts];
}

function extractEndpointsFromJs(jsText = "") {
  const found = new Set();

  for (const m of jsText.matchAll(
    /https?:\/\/[a-zA-Z0-9.-]+(?:ytmp3|mp3|convert|dl|download|api|cdn|media|tube)[a-zA-Z0-9./?=&_-]*/gi
  )) {
    const cand = decodeHtml(m[0]);
    try {
      const h = new URL(cand).hostname.toLowerCase();
      if (BLOCKED_HOSTS.some((b) => h === b || h.endsWith(`.${b}`))) continue;
      found.add(cand);
      if (found.size >= 12) break;
    } catch (_) {}
  }

  for (const m of jsText.matchAll(
    /["'`](\/(?:api\/|v\d+\/|ajax\/)?[a-zA-Z0-9_/-]*(?:convert|download|mp3|info|extract|process|task|status)[a-zA-Z0-9_/-]*)["'`]/gi
  )) {
    const full = absUrl(m[1], ORIGIN_URL);
    if (full) {
      found.add(full);
      if (found.size >= 12) break;
    }
  }

  return [...found];
}

function collectDownloadCandidates(text = "") {
  const decoded = decodeHtml(text);
  const found = new Set();

  for (const m of decoded.matchAll(/https?:\/\/[^\s"'<>\\)]+/gi)) {
    const cand = decodeHtml(m[0]);
    if (isValidAudioDownloadUrl(cand)) {
      found.add(cand);
      if (found.size >= 8) break;
    }
  }

  for (const m of decoded.matchAll(
    /"(?:download_?url|mp3_?url|audio_?url|stream_?url|download|link|url)"\s*:\s*"(https?:\/\/[^"]+)"/gi
  )) {
    const cand = decodeHtml(m[1]);
    if (isValidAudioDownloadUrl(cand)) {
      found.add(cand);
      if (found.size >= 8) break;
    }
  }

  return [...found];
}

async function scrapeYtmp3Gl(inputUrl) {
  const ytUrl = normalizeYouTubeUrl(inputUrl);
  const videoId = extractYouTubeId(ytUrl);

  const pageRes = await fetchWithTimeout(
    TOOL_URL,
    {
      headers: { ...BASE_HEADERS, Referer: `${ORIGIN_URL}/` },
      redirect: "follow",
      cf: { cacheTtl: CACHE_TTL_SEC, cacheEverything: true },
    },
    7000
  );

  const pageHtml = await pageRes.text();
  if (!pageRes.ok || isChallengeHtml(pageHtml)) {
    return {
      ok: false,
      source: TOOL_URL,
      inputUrl: ytUrl,
      videoId,
      cloudflareChallenge: isChallengeHtml(pageHtml),
      error: isChallengeHtml(pageHtml)
        ? "Blocked by Cloudflare challenge on ytmp3.gl"
        : `Failed to load ytmp3.gl (HTTP ${pageRes.status})`,
    };
  }

  const titleMatch =
    pageHtml.match(/<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
    pageHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = titleMatch
    ? decodeHtml(titleMatch[1]).replace(/<[^>]+>/g, "").trim()
    : videoId
      ? `YouTube_${videoId}`
      : "Audio_Track";

  const thumbMatch = pageHtml.match(
    /<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i
  );
  let thumbnail = thumbMatch
    ? absUrl(thumbMatch[1], ORIGIN_URL)
    : videoId
      ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      : null;

  const candidates = new Set(collectDownloadCandidates(pageHtml));
  const discoveredEndpoints = new Set(extractEndpointsFromJs(pageHtml));
  const scriptUrls = extractScriptUrls(pageHtml);

  const jsContents = await Promise.all(
    scriptUrls.map(async (sUrl) => {
      try {
        const r = await fetchWithTimeout(sUrl, { headers: BASE_HEADERS }, 5000);
        return r.ok ? await r.text() : "";
      } catch (_) {
        return "";
      }
    })
  );

  for (const js of jsContents) {
    if (!js) continue;
    for (const ep of extractEndpointsFromJs(js)) {
      discoveredEndpoints.add(ep);
    }
    for (const dl of collectDownloadCandidates(js)) {
      candidates.add(dl);
    }
  }

  const endpointsList = [...discoveredEndpoints].slice(0, 8);

  for (const ep of endpointsList) {
    if (!/^https?:\/\//i.test(ep)) continue;

    try {
      const pRes = await fetchWithTimeout(
        ep,
        {
          method: "POST",
          headers: {
            ...BASE_HEADERS,
            "Content-Type": "application/json",
            Origin: ORIGIN_URL,
            Referer: TOOL_URL,
          },
          body: JSON.stringify({
            url: ytUrl,
            link: ytUrl,
            videoId,
            format: "mp3",
            quality: "128",
          }),
        },
        5000
      );
      const pText = await pRes.text();
      if (pRes.ok && pText) {
        for (const dl of collectDownloadCandidates(pText)) {
          candidates.add(dl);
        }
        try {
          const parsed = JSON.parse(pText);
          if (parsed?.title && typeof parsed.title === "string") title = parsed.title.trim();
          const direct =
            parsed?.downloadUrl ||
            parsed?.download_url ||
            parsed?.mp3 ||
            parsed?.url ||
            parsed?.data?.downloadUrl ||
            parsed?.data?.url;
          if (typeof direct === "string" && isValidAudioDownloadUrl(direct)) {
            candidates.add(direct);
          }
        } catch (_) {}
      }
    } catch (_) {}

    if (candidates.size > 0) break;
  }

  const mp3Links = [...candidates];
  const primaryMp3Url = mp3Links[0] || null;
  const fileName = sanitizeFileName(title, "mp3");

  return {
    ok: mp3Links.length > 0,
    source: TOOL_URL,
    inputUrl: ytUrl,
    videoId,
    title,
    fileName,
    mimetype: "audio/mpeg",
    asDocument: true,
    thumbnail,
    format: "mp3",
    downloadUrl: primaryMp3Url,
    documentUrl: primaryMp3Url,
    downloadLinks: mp3Links,
    discoveredEndpoints: endpointsList,
    note:
      mp3Links.length === 0
        ? "No valid MP3 download link returned without browser JS/session flow on ytmp3.gl."
        : null,
  };
}

export default {
  async fetch(req, ctx) {
    if (req.method === "OPTIONS") {
      return jsonRes({ ok: true }, 200, "BYPASS");
    }

    const url = new URL(req.url);
    const route = url.pathname.replace(/\/+$/, "") || "/";

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });

    if (req.method === "GET" && route !== "/health") {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const headers = new Headers(cached.headers);
        headers.set("X-Cache", "HIT");
        return new Response(cached.body, { status: cached.status, headers });
      }
    }

    try {
      if (route === "/health") {
        return jsonRes({ ok: true, status: "ready", target: TOOL_URL }, 200, "BYPASS");
      }

      if (route === "/mp3" || route === "/dl" || route === "/ytmp3") {
        const target = (url.searchParams.get("url") || "").trim();
        if (!target) {
          return jsonRes(
            { ok: false, error: "Query parameter 'url' is required" },
            400,
            "BYPASS"
          );
        }
        const data = await scrapeYtmp3Gl(target);
        const resp = jsonRes(data, data.ok ? 200 : 502, "MISS");
        if (data.ok && ctx?.waitUntil) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
        return resp;
      }

      return jsonRes({ ok: false, error: "Endpoint not found" }, 404, "BYPASS");
    } catch (err) {
      return jsonRes({ ok: false, error: err?.message || "Scraper error" }, 500, "BYPASS");
    }
  },
};
