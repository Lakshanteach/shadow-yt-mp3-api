// Enhanced save-tube.com JS bundle + endpoint inspector worker

const CREATOR = "👨‍💻 SHADOW MOVIE X MAIN OWNER 👨‍💻";
const TOOL_URL = "https://save-tube.com/youtube-music-downloader/";
const ORIGIN_URL = "https://save-tube.com";
const CACHE_TTL_SEC = 300;

const BASE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,si;q=0.8",
};

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

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
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
    if (full && !full.includes("googletagmanager") && !full.includes("google-analytics")) {
      scripts.add(full);
    }
  }
  return [...scripts].slice(0, 6);
}

function extractEndpointsFromJs(jsText = "") {
  const found = new Set();

  for (const m of jsText.matchAll(
    /https?:\/\/[a-zA-Z0-9.-]+(?:save-tube|savetube|yt|tube|convert|dl|api|cdn|media)[a-zA-Z0-9./?=&_-]*/gi
  )) {
    found.add(decodeHtml(m[0]));
    if (found.size >= 15) break;
  }

  for (const m of jsText.matchAll(
    /["'`](\/(?:api\/|v\d+\/|ajax\/)?[a-zA-Z0-9_/-]*(?:convert|download|mp3|info|extract|process|task|status|yt|youtube|music)[a-zA-Z0-9_/-]*)["'`]/gi
  )) {
    const full = absUrl(m[1], ORIGIN_URL);
    if (full) {
      found.add(full);
      if (found.size >= 15) break;
    }
  }

  return [...found];
}

function collectDownloadCandidates(text = "") {
  const decoded = decodeHtml(text);
  const found = new Set();

  for (const m of decoded.matchAll(
    /https?:\/\/[^\s"'<>\\)]+(?:\.mp3|\/download[^"'<>\\)\s]*|[?&](?:dl|download|mp3|audio|token|file)=[^\s"'<>\\)\s]+)/gi
  )) {
    found.add(m[0]);
    if (found.size >= 8) break;
  }

  for (const m of decoded.matchAll(
    /"(?:download_?url|mp3_?url|audio_?url|stream_?url|download|link|url)"\s*:\s*"(https?:\/\/[^"]+)"/gi
  )) {
    const candidate = decodeHtml(m[1]);
    if (
      /\.(?:mp3|m4a|ogg|opus|webm)/i.test(candidate) ||
      /download|dl|convert|getfile|audio/i.test(candidate)
    ) {
      found.add(candidate);
      if (found.size >= 8) break;
    }
  }

  return [...found];
}

async function scrapeSaveTubeMp3(inputUrl) {
  const ytUrl = normalizeYouTubeUrl(inputUrl);
  const videoId = extractYouTubeId(ytUrl);

  const pageRes = await fetchWithTimeout(
    TOOL_URL,
    {
      headers: { ...BASE_HEADERS, Referer: `${ORIGIN_URL}/` },
      redirect: "follow",
      cf: { cacheTtl: CACHE_TTL_SEC, cacheEverything: true },
    },
    8000
  );

  const pageHtml = await pageRes.text();
  if (!pageRes.ok) {
    return {
      ok: false,
      source: TOOL_URL,
      inputUrl: ytUrl,
      videoId,
      error: `Failed to load save-tube page (HTTP ${pageRes.status})`,
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

  // Fetch JS bundles in parallel to discover hidden API/download endpoints
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

    // Try GET with query params first
    try {
      const getUrl = new URL(ep);
      getUrl.searchParams.set("url", ytUrl);
      getUrl.searchParams.set("format", "mp3");
      const gRes = await fetchWithTimeout(
        getUrl.toString(),
        { headers: { ...BASE_HEADERS, Referer: TOOL_URL } },
        5000
      );
      const gText = await gRes.text();
      if (gRes.ok && gText) {
        for (const dl of collectDownloadCandidates(gText)) {
          candidates.add(dl);
        }
      }
    } catch (_) {}

    if (candidates.size > 0) break;

    // Try POST with JSON payload
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
          body: JSON.stringify({ url: ytUrl, link: ytUrl, format: "mp3", quality: "128" }),
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
          if (typeof direct === "string" && /^https?:\/\//i.test(direct)) {
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
        ? "Save-tube processes conversion via dynamic client/API flow; check discoveredEndpoints or test a direct MP3/audio API."
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
        const data = await scrapeSaveTubeMp3(target);
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
