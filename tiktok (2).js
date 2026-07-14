// TokGhost backend — Vercel serverless function
// Data source: ScrapeCreators API (https://docs.scrapecreators.com)
// Auth: x-api-key header. Set SCRAPECREATORS_API_KEY in Vercel env vars.
//
// Endpoints used:
//   GET /v1/tiktok/profile?handle=<username>   -> profile + stats   (1 credit)
//   GET /v2/tiktok/video?url=<video url>       -> video + no-wm url (1 credit)
//   GET /v3/tiktok/profile/videos?handle=<u>   -> profile videos    (1 credit)
//
// Routes:
//   /api/tiktok?type=profile&u=username
//   /api/tiktok?type=video&url=<tiktok video url>
//   /api/tiktok?type=videos&u=username

const SC_BASE = "https://api.scrapecreators.com";

// ---- helpers -------------------------------------------------------------

function cleanUsername(raw = "") {
  const s = String(raw).trim();
  const m = s.match(/tiktok\.com\/@?([A-Za-z0-9._]+)/i);
  const u = m ? m[1] : s.replace(/^@/, "");
  return u.replace(/[^A-Za-z0-9._]/g, "").slice(0, 40);
}

function isVideoUrl(u = "") {
  return /tiktok\.com\/.+\/(video|photo)\/\d+/i.test(u) || /vm\.tiktok\.com\//i.test(u);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

function ok(res, data) {
  cors(res);
  // Cache at the edge: saves credits when the same handle is looked up repeatedly.
  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
  res.status(200).json({ ok: true, ...data });
}

function fail(res, code, msg) {
  cors(res);
  res.status(code).json({ ok: false, error: msg });
}

async function sc(path) {
  const key = process.env.SCRAPECREATORS_API_KEY;
  if (!key) throw new Error("NO_KEY");
  const r = await fetch(`${SC_BASE}${path}`, { headers: { "x-api-key": key } });
  if (r.status === 404) throw new Error("NOT_FOUND");
  if (r.status === 401 || r.status === 403) throw new Error("BAD_KEY");
  if (r.status === 429) throw new Error("RATE_LIMIT");
  if (!r.ok) throw new Error(`SC_${r.status}`);
  return r.json();
}

// Pull a value from any of several possible shapes (APIs move fields around).
function pick(obj, ...paths) {
  for (const p of paths) {
    const v = p.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}

// ---- shapers -------------------------------------------------------------

function shapeProfile(raw, username) {
  const stats = raw?.stats || raw?.statsV2 || raw?.user?.stats || {};
  const user = raw?.user || raw?.userInfo?.user || raw;
  const num = (v) => (v == null ? null : Number(v));

  return {
    type: "profile",
    username: pick(user, "uniqueId", "unique_id") || username,
    nickname: pick(user, "nickname", "nickName"),
    avatar: pick(user, "avatarLarger", "avatarMedium", "avatar_larger.url_list.0", "avatar"),
    bio: pick(user, "signature", "desc"),
    verified: !!pick(user, "verified"),
    private: !!pick(user, "privateAccount", "secret"),
    followers: num(pick(stats, "followerCount", "follower_count")),
    following: num(pick(stats, "followingCount", "following_count")),
    likes: num(pick(stats, "heartCount", "heart", "total_favorited")),
    videos: num(pick(stats, "videoCount", "aweme_count")),
    profileUrl: `https://www.tiktok.com/@${pick(user, "uniqueId", "unique_id") || username}`,
  };
}

function shapeVideo(raw) {
  const v = raw?.aweme_detail || raw?.video || raw;
  const st = v?.statistics || {};
  const author = v?.author || {};

  // No-watermark: prefer download_no_watermark_addr, then play_addr when unwatermarked.
  const noWm =
    pick(v, "download_no_watermark_addr.url_list.0", "downloadAddr") ||
    (v?.video?.has_watermark === false
      ? pick(v, "video.play_addr.url_list.0")
      : null) ||
    pick(v, "video.download_no_watermark_addr.url_list.0", "video.play_addr.url_list.0");

  const num = (x) => (x == null ? null : Number(x));

  return {
    type: "video",
    id: pick(v, "aweme_id", "id"),
    title: pick(v, "desc", "title") || "",
    author: pick(author, "unique_id", "uniqueId", "nickname") || "",
    authorUrl: author?.unique_id ? `https://www.tiktok.com/@${author.unique_id}` : null,
    cover: pick(v, "video.cover.url_list.0", "video.origin_cover.url_list.0", "cover"),
    download: noWm,           // clean MP4, no watermark
    music: pick(v, "music.play_url.url_list.0"),  // audio for the MP3 tool
    likes: num(pick(st, "digg_count")),
    comments: num(pick(st, "comment_count")),
    shares: num(pick(st, "share_count")),
    plays: num(pick(st, "play_count")),
  };
}

// ---- handler -------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    cors(res);
    return res.status(204).end();
  }

  const { type = "profile", u = "", url = "" } = req.query || {};

  try {
    // --- VIDEO (downloader, mp3, comments pages) ---
    if (type === "video") {
      const target = String(url || u).trim();
      if (!isVideoUrl(target)) {
        return fail(res, 400, "Paste a full TikTok video link.");
      }
      const raw = await sc(`/v2/tiktok/video?url=${encodeURIComponent(target)}`);
      return ok(res, shapeVideo(raw));
    }

    // --- PROFILE VIDEOS (profile grid, photo/pfp pages) ---
    if (type === "videos") {
      const handle = cleanUsername(u || url);
      if (!handle) return fail(res, 400, "Enter a TikTok username.");
      const raw = await sc(`/v3/tiktok/profile/videos?handle=${encodeURIComponent(handle)}`);
      const list = raw?.aweme_list || raw?.videos || raw?.itemList || [];
      return ok(res, {
        type: "videos",
        username: handle,
        count: list.length,
        videos: list.slice(0, 30).map(shapeVideo),
      });
    }

    // --- PROFILE (homepage, analytics, age, money, followers) ---
    const handle = cleanUsername(u || url);
    if (!handle) return fail(res, 400, "Enter a TikTok username.");
    const raw = await sc(`/v1/tiktok/profile?handle=${encodeURIComponent(handle)}`);
    return ok(res, shapeProfile(raw, handle));

  } catch (e) {
    const m = e.message || "";
    if (m === "NO_KEY")     return fail(res, 503, "The data service is not configured yet. Please try again later.");
    if (m === "BAD_KEY")    return fail(res, 503, "The data service rejected our credentials. We are looking into it.");
    if (m === "NOT_FOUND")  return fail(res, 404, "That account could not be found. Check the spelling, and note that private accounts are not accessible.");
    if (m === "RATE_LIMIT") return fail(res, 429, "Too many requests right now. Please wait a moment and try again.");
    return fail(res, 502, "Could not reach TikTok right now. Please try again shortly.");
  }
}
