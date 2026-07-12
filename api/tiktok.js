// TokGhost backend — Vercel serverless function
// Handles: profile lookup, video info via TikTok oEmbed (free) + optional paid API.
//
// Endpoints:
//   /api/tiktok?type=video&url=<tiktok video url>
//   /api/tiktok?type=profile&u=<username>
//   /api/tiktok?type=debug&url=<tiktok video url>   <-- shows the real upstream error

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function cleanUsername(raw = "") {
  let u = String(raw).trim().replace(/^@/, "");
  const m = String(raw).match(/tiktok\.com\/@?([A-Za-z0-9._]+)/i);
  if (m) u = m[1];
  return u.replace(/[^A-Za-z0-9._]/g, "").slice(0, 40);
}

function send(res, code, body) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  res.status(code).json(body);
}

// Fetch oEmbed with a real browser UA + timeout. Returns { data } or { err }.
async function oembed(videoUrl) {
  const api = `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(api, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": UA,
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.tiktok.com/",
      },
    });
    const text = await r.text();
    if (!r.ok) return { err: `TikTok returned HTTP ${r.status}`, status: r.status, body: text.slice(0, 300) };
    try {
      return { data: JSON.parse(text) };
    } catch {
      return { err: "TikTok returned non-JSON (likely a block page)", body: text.slice(0, 300) };
    }
  } catch (e) {
    return { err: `Request failed: ${e.name === "AbortError" ? "timeout" : e.message}` };
  } finally {
    clearTimeout(t);
  }
}

// Optional paid provider. Set TIKTOK_API_URL + TIKTOK_API_KEY in Vercel env vars.
async function paidProfile(username) {
  const base = process.env.TIKTOK_API_URL;
  const key = process.env.TIKTOK_API_KEY;
  if (!base || !key) return null;
  const r = await fetch(`${base}?username=${encodeURIComponent(username)}`, {
    headers: { Authorization: `Bearer ${key}`, "User-Agent": UA },
  });
  if (!r.ok) return null;
  return r.json();
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(204).end();
  }

  const { type = "profile", u = "", url = "" } = req.query || {};

  // DEBUG: surfaces the real upstream error so we can see what TikTok actually said.
  if (type === "debug") {
    const target = url || "https://www.tiktok.com/@tiktok/video/7016181462140628225";
    const out = await oembed(target);
    return send(res, 200, { ok: true, type: "debug", target, result: out });
  }

  if (type === "video") {
    if (!/tiktok\.com/i.test(url)) {
      return send(res, 400, { ok: false, error: "Paste a valid TikTok video link." });
    }
    const { data, err, body } = await oembed(url);
    if (err) {
      return send(res, 502, {
        ok: false,
        error: "TikTok did not respond to this request.",
        detail: err,
        hint: body ? String(body).slice(0, 160) : undefined,
      });
    }
    return send(res, 200, {
      ok: true,
      type: "video",
      title: data.title || "",
      author: data.author_name || "",
      authorUrl: data.author_url || "",
      thumbnail: data.thumbnail_url || "",
      download: null, // watermark-free MP4 needs the paid API
    });
  }

  // profile
  const username = cleanUsername(u || url);
  if (!username) return send(res, 400, { ok: false, error: "Enter a TikTok username." });

  const paid = await paidProfile(username).catch(() => null);
  if (paid) {
    return send(res, 200, { ok: true, type: "profile", username, source: "api", ...paid });
  }

  // Free tier: confirm + link out. Full stats need the paid API.
  return send(res, 200, {
    ok: true,
    type: "profile",
    username,
    source: "free",
    profileUrl: `https://www.tiktok.com/@${username}`,
    note:
      "Free tier links to the profile. Full stats, video lists and watermark-free " +
      "downloads require the data API (set TIKTOK_API_URL and TIKTOK_API_KEY in Vercel).",
  });
}
