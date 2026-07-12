// TokGhost backend — Vercel serverless function
// Handles: profile lookup, video info, oEmbed.
// Strategy: FREE tier uses TikTok's public oEmbed. PAID tier (optional) uses a
// scraping API via env vars. This is the single spot where free -> paid upgrades.
//
// Endpoint:  /api/tiktok?type=profile&u=username
//            /api/tiktok?type=video&url=<tiktok video url>
//
// Deploy: drop this file in /api on Vercel. No build step needed.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";

// ---- helpers -------------------------------------------------------------

function cleanUsername(raw = "") {
  let u = String(raw).trim().replace(/^@/, "");
  const m = String(raw).match(/tiktok\.com\/@?([A-Za-z0-9._]+)/i);
  if (m) u = m[1];
  return u.replace(/[^A-Za-z0-9._]/g, "").slice(0, 40);
}

function ok(res, data) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  res.status(200).json({ ok: true, ...data });
}

function fail(res, code, msg) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(code).json({ ok: false, error: msg });
}

// ---- data sources --------------------------------------------------------

// FREE: TikTok official oEmbed. Works for a video URL. Returns author + thumbnail.
// This is rate-limited by TikTok and is the fragile-but-free path.
async function oembed(videoUrl) {
  const api = `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`;
  const r = await fetch(api, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`oembed ${r.status}`);
  return r.json();
}

// PAID (optional): a scraping API. Wire your provider here and set env vars in
// Vercel:  TIKTOK_API_URL  and  TIKTOK_API_KEY. Until you set them, this is skipped
// and the app falls back to free/oEmbed. This is your upgrade path once revenue starts.
async function paidProfile(username) {
  const base = process.env.TIKTOK_API_URL;
  const key = process.env.TIKTOK_API_KEY;
  if (!base || !key) return null; // not configured yet -> free tier only
  const r = await fetch(`${base}?username=${encodeURIComponent(username)}`, {
    headers: { "Authorization": `Bearer ${key}`, "User-Agent": UA },
  });
  if (!r.ok) throw new Error(`paid ${r.status}`);
  return r.json();
}

// ---- handler -------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    return res.status(204).end();
  }

  const { type = "profile", u = "", url = "" } = req.query || {};

  try {
    if (type === "video") {
      if (!/tiktok\.com/i.test(url)) return fail(res, 400, "Provide a valid TikTok video URL.");
      const data = await oembed(url);
      return ok(res, {
        type: "video",
        title: data.title || "",
        author: data.author_name || "",
        authorUrl: data.author_url || "",
        thumbnail: data.thumbnail_url || "",
        html: data.html || "",
        // Note: watermark-free MP4 requires the paid API. oEmbed gives embed HTML only.
        download: null,
      });
    }

    // profile
    const username = cleanUsername(u || url);
    if (!username) return fail(res, 400, "Enter a TikTok username.");

    // Try paid provider first if configured (richer data), else free tier.
    const paid = await paidProfile(username).catch(() => null);
    if (paid) {
      return ok(res, { type: "profile", username, source: "api", ...paid });
    }

    // FREE fallback: we can confirm the profile and link to it. Full stats
    // (followers, video list) need the paid API. Be honest in the response.
    return ok(res, {
      type: "profile",
      username,
      source: "free",
      profileUrl: `https://www.tiktok.com/@${username}`,
      note:
        "Free tier confirms the profile and links out. Full stats, videos, " +
        "and watermark-free downloads require the data API (set TIKTOK_API_URL " +
        "and TIKTOK_API_KEY in Vercel to enable).",
    });
  } catch (e) {
    return fail(res, 502, "Could not reach TikTok right now. Try again shortly.");
  }
}
