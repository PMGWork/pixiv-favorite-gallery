import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import type { FavoriteItem } from "@random-gallery/shared";

const BASE_URL = "https://app-api.pixiv.net";
const AUTH_URL = "https://oauth.secure.pixiv.net/auth/token";
const RAINDROP_BASE_URL = "https://api.raindrop.io/rest/v1";
const CLIENT_ID = "MOBrBDS8blbauoSck0ZfDbtuzpyT";
const CLIENT_SECRET = "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj";
const HASH_SECRET =
  "28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c";
const USER_AGENT = "PixivAndroidApp/5.0.234 (Android 9.0; Pixel 3)";

const PIXIV_REFRESH_TOKEN = process.env.PIXIV_REFRESH_TOKEN || "";
const RAINDROP_TOKEN = process.env.RAINDROP_TOKEN || "";
const PORT = parseInt(process.env.PORT || "3010", 10);

if (!PIXIV_REFRESH_TOKEN) {
  console.warn("PIXIV_REFRESH_TOKEN is not set; Pixiv source is disabled.");
}

if (!RAINDROP_TOKEN) {
  console.warn("RAINDROP_TOKEN is not set; Raindrop source is disabled.");
}

const app = new Hono();

app.use("*", cors({ origin: "*" }));

app.get("/favorites", async (c) => {
  const limit = clampNumber(parseInt(c.req.query("limit") || "20", 10), 10, 30);
  const offset = Math.max(0, parseInt(c.req.query("offset") || "0", 10));
  const seed = c.req.query("seed") || generateSeed();
  const tags = (c.req.query("tags") || "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  const mode = c.req.query("mode") === "and" ? "and" : "or";
  const ai = c.req.query("ai") || "all";
  const source = c.req.query("source") === "raindrop" ? "raindrop" : "pixiv";

  try {
    if (source === "raindrop") {
      if (!RAINDROP_TOKEN) {
        return c.json({ error: "RAINDROP_TOKEN is required" }, 400);
      }

      const allRaindrops = await fetchAllRaindrops(RAINDROP_TOKEN);
      if (!allRaindrops.length) {
        return c.json({ data: [], offset: 0, hasMore: false, total: 0, seed });
      }

      const filteredByTags = filterByTagNames(allRaindrops, tags, mode);
      const shuffled = seededShuffle(filteredByTags, seed);
      const total = shuffled.length;
      const selected = shuffled.slice(offset, offset + limit);
      const nextOffset = offset + selected.length;
      const hasMore = nextOffset < total;

      return c.json({
        data: selected,
        offset: nextOffset,
        hasMore,
        total,
        seed,
      });
    }

    if (!PIXIV_REFRESH_TOKEN) {
      return c.json({ error: "PIXIV_REFRESH_TOKEN is required" }, 400);
    }

    const auth = await refreshAccessToken(PIXIV_REFRESH_TOKEN);
    const allIllusts = await fetchAllBookmarks(auth);

    if (!allIllusts.length) {
      return c.json({ data: [], offset: 0, hasMore: false, total: 0, seed });
    }

    const filteredByTags = filterByTags(allIllusts, tags, mode);
    const filteredByAi = filterByAi(filteredByTags, ai);
    const shuffled = seededShuffle(filteredByAi, seed);
    const total = shuffled.length;
    const selected = shuffled.slice(offset, offset + limit);
    const nextOffset = offset + selected.length;
    const hasMore = nextOffset < total;

    const payload = selected.map((illust) => {
      const pageCount = illust.page_count || 1;
      const pages =
        pageCount > 1 && illust.meta_pages
          ? illust.meta_pages
              .map(
                (page) =>
                  page.image_urls?.original ||
                  page.image_urls?.large ||
                  page.image_urls?.medium
              )
              .filter((url): url is string => !!url)
          : undefined;

      return {
        id: illust.id,
        source: "pixiv",
        title: illust.title,
        user: {
          id: illust.user?.id ?? 0,
          name: illust.user?.name ?? "",
        },
        imageUrl: illust.image_urls?.large || illust.image_urls?.medium,
        artworkUrl: `https://www.pixiv.net/artworks/${illust.id}`,
        userUrl: illust.user?.id
          ? `https://www.pixiv.net/users/${illust.user.id}`
          : undefined,
        pageCount,
        pages,
        tags: (illust.tags || []).map((tag) => tag.name),
        aiType: illust.illust_ai_type,
      } satisfies FavoriteItem;
    });

    return c.json({
      data: payload,
      offset: nextOffset,
      hasMore,
      total,
      seed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "API error";
    console.error("API error:", error);
    return c.json({ error: message }, 500);
  }
});

app.get("/image", async (c) => {
  const target = c.req.query("url");
  if (!target) {
    return c.json({ error: "url query is required" }, 400);
  }

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return c.json({ error: "invalid url" }, 400);
  }

  if (!url.hostname.endsWith("pximg.net")) {
    return c.json({ error: "unsupported image host" }, 400);
  }

  const imageResponse = await fetch(url.toString(), {
    headers: {
      Referer: "https://www.pixiv.net/",
    },
  });

  const headers = new Headers();
  const contentType = imageResponse.headers.get("Content-Type");
  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  headers.set("Cache-Control", "public, max-age=86400");

  return new Response(imageResponse.body as ReadableStream, {
    status: imageResponse.status,
    headers,
  });
});

type PixivAuth = {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
  };
};

type PixivIllust = {
  id: number;
  title: string;
  type?: string;
  illust_ai_type?: number;
  page_count?: number;
  image_urls?: {
    medium?: string;
    large?: string;
  };
  meta_single_page?: {
    original_image_url?: string;
  };
  meta_pages?: Array<{
    image_urls?: {
      medium?: string;
      large?: string;
      original?: string;
    };
  }>;
  user?: {
    id: number;
    name: string;
  };
  tags?: Array<{ name: string }>;
};

type PixivBookmarkResponse = {
  illusts: PixivIllust[];
  next_url?: string | null;
};

type RaindropItem = {
  _id: number;
  title?: string;
  excerpt?: string;
  link?: string;
  tags?: string[];
  cover?: string | string[];
  media?: Array<{
    link?: string;
  }>;
};

type RaindropResponse = {
  items: RaindropItem[];
  count: number;
};

async function refreshAccessToken(refreshToken: string): Promise<PixivAuth> {
  const payload = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    get_secure_url: "true",
    include_policy: "true",
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(AUTH_URL, {
    method: "POST",
    headers: buildHeaders({
      "Content-Type": "application/x-www-form-urlencoded",
    }),
    body: payload,
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("Pixiv auth error:", response.status, text);
    throw new Error(`Pixiv auth failed: ${response.status}`);
  }

  const data = await response.json();
  return data.response as PixivAuth;
}

async function fetchAllBookmarks(auth: PixivAuth): Promise<PixivIllust[]> {
  const results: PixivIllust[] = [];
  let nextUrl: string | null = `${BASE_URL}/v1/user/bookmarks/illust?user_id=${auth.user.id}&restrict=public`;

  while (nextUrl) {
    const data = await pixivRequest<PixivBookmarkResponse>(nextUrl, auth);
    if (data.illusts?.length) {
      results.push(...data.illusts);
    }
    nextUrl = normalizeNextUrl(data.next_url, auth.user.id);
  }

  return results;
}

async function fetchAllRaindrops(token: string): Promise<FavoriteItem[]> {
  const results: FavoriteItem[] = [];
  const perPage = 50;
  let page = 0;
  let total = Infinity;

  while (results.length < total) {
    const url = `${RAINDROP_BASE_URL}/raindrops/0?perpage=${perPage}&page=${page}`;
    const data = await raindropRequest<RaindropResponse>(url, token);
    total = data.count || 0;
    if (!data.items?.length) {
      break;
    }
    results.push(...data.items.map(mapRaindropItem));
    if (data.items.length < perPage) {
      break;
    }
    page += 1;
  }

  return results;
}

function normalizeNextUrl(nextUrl: string | null | undefined, userId: string) {
  if (!nextUrl) {
    return null;
  }
  const url = new URL(nextUrl);
  url.searchParams.delete("user_id");
  url.searchParams.delete("restrict");
  const filtered = url.searchParams.toString();
  const base = `${BASE_URL}/v1/user/bookmarks/illust?user_id=${userId}&restrict=public`;
  return filtered ? `${base}&${filtered}` : base;
}

async function pixivRequest<T>(url: string, auth: PixivAuth): Promise<T> {
  const response = await fetch(url, {
    headers: buildHeaders({
      Authorization: `Bearer ${auth.access_token}`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Pixiv API error: ${response.status}`);
  }

  return (await response.json()) as T;
}

async function raindropRequest<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Raindrop API error: ${response.status} ${text}`);
  }

  return (await response.json()) as T;
}

function buildHeaders(extra: Record<string, string>) {
  const time = new Date().toISOString();
  return {
    "User-Agent": USER_AGENT,
    "Accept-Language": "en-us",
    "App-OS": "android",
    "App-OS-Version": "9.0",
    "App-Version": "5.0.234",
    "X-Client-Time": time,
    "X-Client-Hash": md5(`${time}${HASH_SECRET}`),
    ...extra,
  };
}

function filterByTags(illusts: PixivIllust[], tags: string[], mode: "or" | "and") {
  if (!tags.length) {
    return illusts;
  }
  return illusts.filter((illust) => {
    const illustTags = (illust.tags || []).map((tag) => tag.name.toLowerCase());
    if (mode === "and") {
      return tags.every((tag) => illustTags.includes(tag));
    }
    return tags.some((tag) => illustTags.includes(tag));
  });
}

function filterByTagNames(items: FavoriteItem[], tags: string[], mode: "or" | "and") {
  if (!tags.length) {
    return items;
  }
  return items.filter((item) => {
    const itemTags = (item.tags || []).map((tag) => tag.toLowerCase());
    if (mode === "and") {
      return tags.every((tag) => itemTags.includes(tag));
    }
    return tags.some((tag) => itemTags.includes(tag));
  });
}

function filterByAi(illusts: PixivIllust[], ai: string) {
  if (ai === "all") {
    return illusts;
  }
  if (ai === "ai") {
    return illusts.filter((illust) => illust.illust_ai_type === 2);
  }
  if (ai === "non-ai") {
    return illusts.filter((illust) => !illust.illust_ai_type || illust.illust_ai_type !== 2);
  }
  return illusts;
}

function mapRaindropItem(item: RaindropItem): FavoriteItem {
  const imageUrl = extractRaindropImageUrl(item);
  const title = item.title?.trim() || item.excerpt?.trim() || "Untitled";
  return {
    id: item._id,
    source: "raindrop",
    title,
    imageUrl,
    artworkUrl: item.link || "",
    tags: item.tags || [],
  };
}

function extractRaindropImageUrl(item: RaindropItem): string | undefined {
  if (typeof item.cover === "string" && item.cover) {
    return item.cover;
  }
  if (Array.isArray(item.cover) && item.cover.length > 0) {
    return item.cover[0];
  }
  const media = item.media || [];
  const first = media.find((entry) => entry.link && entry.link.length > 0);
  return first?.link;
}

function sampleArray<T>(items: T[], count: number) {
  if (items.length <= count) {
    return items;
  }
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

function generateSeed(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function seededShuffle<T>(items: T[], seed: string): T[] {
  if (items.length <= 1) {
    return [...items];
  }

  const copy = [...items];
  let rng = createSeededRng(seed);

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function createSeededRng(seed: string): () => number {
  let h = 0xdeadbeef;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 2654435761);
  }
  h = (h ^ (h >>> 16)) >>> 0;

  return function() {
    h = (h + 0x6D2B79F5) >>> 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function md5(message: string) {
  return md5Hex(md5Bytes(message));
}

function md5Bytes(message: string) {
  const data = new TextEncoder().encode(message);
  const length = data.length;
  const withPadding = new Uint8Array(((length + 8) >> 6 << 6) + 64);
  withPadding.set(data);
  withPadding[length] = 0x80;
  const bitLen = length * 8;
  for (let i = 0; i < 8; i += 1) {
    withPadding[withPadding.length - 8 + i] = (bitLen >>> (8 * i)) & 0xff;
  }

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  const chunk = new Uint32Array(16);
  for (let i = 0; i < withPadding.length; i += 64) {
    for (let j = 0; j < 16; j += 1) {
      chunk[j] =
        withPadding[i + j * 4] |
        (withPadding[i + j * 4 + 1] << 8) |
        (withPadding[i + j * 4 + 2] << 16) |
        (withPadding[i + j * 4 + 3] << 24);
    }

    let aa = a;
    let bb = b;
    let cc = c;
    let dd = d;

    aa = md5Step(aa, bb, cc, dd, chunk[0], 7, 0xd76aa478);
    dd = md5Step(dd, aa, bb, cc, chunk[1], 12, 0xe8c7b756);
    cc = md5Step(cc, dd, aa, bb, chunk[2], 17, 0x242070db);
    bb = md5Step(bb, cc, dd, aa, chunk[3], 22, 0xc1bdceee);
    aa = md5Step(aa, bb, cc, dd, chunk[4], 7, 0xf57c0faf);
    dd = md5Step(dd, aa, bb, cc, chunk[5], 12, 0x4787c62a);
    cc = md5Step(cc, dd, aa, bb, chunk[6], 17, 0xa8304613);
    bb = md5Step(bb, cc, dd, aa, chunk[7], 22, 0xfd469501);
    aa = md5Step(aa, bb, cc, dd, chunk[8], 7, 0x698098d8);
    dd = md5Step(dd, aa, bb, cc, chunk[9], 12, 0x8b44f7af);
    cc = md5Step(cc, dd, aa, bb, chunk[10], 17, 0xffff5bb1);
    bb = md5Step(bb, cc, dd, aa, chunk[11], 22, 0x895cd7be);
    aa = md5Step(aa, bb, cc, dd, chunk[12], 7, 0x6b901122);
    dd = md5Step(dd, aa, bb, cc, chunk[13], 12, 0xfd987193);
    cc = md5Step(cc, dd, aa, bb, chunk[14], 17, 0xa679438e);
    bb = md5Step(bb, cc, dd, aa, chunk[15], 22, 0x49b40821);

    aa = md5Step(aa, bb, cc, dd, chunk[1], 5, 0xf61e2562, md5G);
    dd = md5Step(dd, aa, bb, cc, chunk[6], 9, 0xc040b340, md5G);
    cc = md5Step(cc, dd, aa, bb, chunk[11], 14, 0x265e5a51, md5G);
    bb = md5Step(bb, cc, dd, aa, chunk[0], 20, 0xe9b6c7aa, md5G);
    aa = md5Step(aa, bb, cc, dd, chunk[5], 5, 0xd62f105d, md5G);
    dd = md5Step(dd, aa, bb, cc, chunk[10], 9, 0x02441453, md5G);
    cc = md5Step(cc, dd, aa, bb, chunk[15], 14, 0xd8a1e681, md5G);
    bb = md5Step(bb, cc, dd, aa, chunk[4], 20, 0xe7d3fbc8, md5G);
    aa = md5Step(aa, bb, cc, dd, chunk[9], 5, 0x21e1cde6, md5G);
    dd = md5Step(dd, aa, bb, cc, chunk[14], 9, 0xc33707d6, md5G);
    cc = md5Step(cc, dd, aa, bb, chunk[3], 14, 0xf4d50d87, md5G);
    bb = md5Step(bb, cc, dd, aa, chunk[8], 20, 0x455a14ed, md5G);
    aa = md5Step(aa, bb, cc, dd, chunk[13], 5, 0xa9e3e905, md5G);
    dd = md5Step(dd, aa, bb, cc, chunk[2], 9, 0xfcefa3f8, md5G);
    cc = md5Step(cc, dd, aa, bb, chunk[7], 14, 0x676f02d9, md5G);
    bb = md5Step(bb, cc, dd, aa, chunk[12], 20, 0x8d2a4c8a, md5G);

    aa = md5Step(aa, bb, cc, dd, chunk[5], 4, 0xfffa3942, md5H);
    dd = md5Step(dd, aa, bb, cc, chunk[8], 11, 0x8771f681, md5H);
    cc = md5Step(cc, dd, aa, bb, chunk[11], 16, 0x6d9d6122, md5H);
    bb = md5Step(bb, cc, dd, aa, chunk[14], 23, 0xfde5380c, md5H);
    aa = md5Step(aa, bb, cc, dd, chunk[1], 4, 0xa4beea44, md5H);
    dd = md5Step(dd, aa, bb, cc, chunk[4], 11, 0x4bdecfa9, md5H);
    cc = md5Step(cc, dd, aa, bb, chunk[7], 16, 0xf6bb4b60, md5H);
    bb = md5Step(bb, cc, dd, aa, chunk[10], 23, 0xbebfbc70, md5H);
    aa = md5Step(aa, bb, cc, dd, chunk[13], 4, 0x289b7ec6, md5H);
    dd = md5Step(dd, aa, bb, cc, chunk[0], 11, 0xeaa127fa, md5H);
    cc = md5Step(cc, dd, aa, bb, chunk[3], 16, 0xd4ef3085, md5H);
    bb = md5Step(bb, cc, dd, aa, chunk[6], 23, 0x04881d05, md5H);
    aa = md5Step(aa, bb, cc, dd, chunk[9], 4, 0xd9d4d039, md5H);
    dd = md5Step(dd, aa, bb, cc, chunk[12], 11, 0xe6db99e5, md5H);
    cc = md5Step(cc, dd, aa, bb, chunk[15], 16, 0x1fa27cf8, md5H);
    bb = md5Step(bb, cc, dd, aa, chunk[2], 23, 0xc4ac5665, md5H);

    aa = md5Step(aa, bb, cc, dd, chunk[0], 6, 0xf4292244, md5I);
    dd = md5Step(dd, aa, bb, cc, chunk[7], 10, 0x432aff97, md5I);
    cc = md5Step(cc, dd, aa, bb, chunk[14], 15, 0xab9423a7, md5I);
    bb = md5Step(bb, cc, dd, aa, chunk[5], 21, 0xfc93a039, md5I);
    aa = md5Step(aa, bb, cc, dd, chunk[12], 6, 0x655b59c3, md5I);
    dd = md5Step(dd, aa, bb, cc, chunk[3], 10, 0x8f0ccc92, md5I);
    cc = md5Step(cc, dd, aa, bb, chunk[10], 15, 0xffeff47d, md5I);
    bb = md5Step(bb, cc, dd, aa, chunk[1], 21, 0x85845dd1, md5I);
    aa = md5Step(aa, bb, cc, dd, chunk[8], 6, 0x6fa87e4f, md5I);
    dd = md5Step(dd, aa, bb, cc, chunk[15], 10, 0xfe2ce6e0, md5I);
    cc = md5Step(cc, dd, aa, bb, chunk[6], 15, 0xa3014314, md5I);
    bb = md5Step(bb, cc, dd, aa, chunk[13], 21, 0x4e0811a1, md5I);
    aa = md5Step(aa, bb, cc, dd, chunk[4], 6, 0xf7537e82, md5I);
    dd = md5Step(dd, aa, bb, cc, chunk[11], 10, 0xbd3af235, md5I);
    cc = md5Step(cc, dd, aa, bb, chunk[2], 15, 0x2ad7d2bb, md5I);
    bb = md5Step(bb, cc, dd, aa, chunk[9], 21, 0xeb86d391, md5I);

    a = (a + aa) >>> 0;
    b = (b + bb) >>> 0;
    c = (c + cc) >>> 0;
    d = (d + dd) >>> 0;
  }

  return [a, b, c, d];
}

function md5Hex(words: number[]) {
  let hex = "";
  for (const word of words) {
    for (let i = 0; i < 4; i += 1) {
      const byte = (word >>> (i * 8)) & 0xff;
      hex += byte.toString(16).padStart(2, "0");
    }
  }
  return hex;
}

function md5Step(
  a: number,
  b: number,
  c: number,
  d: number,
  x: number,
  s: number,
  t: number,
  fn: (b: number, c: number, d: number) => number = md5F
) {
  const tmp = (a + fn(b, c, d) + x + t) >>> 0;
  return (b + ((tmp << s) | (tmp >>> (32 - s)))) >>> 0;
}

function md5F(b: number, c: number, d: number) {
  return (b & c) | (~b & d);
}

function md5G(b: number, c: number, d: number) {
  return (b & d) | (c & ~d);
}

function md5H(b: number, c: number, d: number) {
  return b ^ c ^ d;
}

function md5I(b: number, c: number, d: number) {
  return c ^ (b | ~d);
}

console.log(`Starting server on http://0.0.0.0:${PORT}`);
serve({
  fetch: app.fetch,
  hostname: "0.0.0.0",
  port: PORT,
});
