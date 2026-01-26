import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";

type Env = {
  Bindings: {
    PIXIV_REFRESH_TOKEN: string;
    AUTH_PASSWORD: string;
  };
};

const BASE_URL = "https://app-api.pixiv.net";
const AUTH_URL = "https://oauth.secure.pixiv.net/auth/token";
const CLIENT_ID = "MOBrBDS8blbauoSck0ZfDbtuzpyT";
const CLIENT_SECRET = "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj";
const HASH_SECRET =
  "28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c";
const USER_AGENT = "PixivAndroidApp/5.0.234 (Android 9.0; Pixel 3)";
const AUTH_COOKIE = "pixiv_gallery_auth";
const AUTH_TTL_SECONDS = 60 * 60 * 24 * 30;

const app = new Hono<Env>();

app.use("*", async (c, next) => {
  if (c.req.path.startsWith("/api")) {
    return next();
  }

  const isAuthed = await isAuthenticated(c);
  if (!isAuthed) {
    return renderLoginPage();
  }

  const assets = c.env.ASSETS;
  if (!assets) {
    return c.text("Assets binding not configured", 500);
  }
  const res = await assets.fetch(c.req.raw);
  if (res.status !== 404) {
    return res;
  }
  const url = new URL(c.req.url);
  url.pathname = "/";
  return assets.fetch(new Request(url.toString(), c.req.raw));
});

app.use(
  "/api/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST"],
    allowHeaders: ["Content-Type"],
  })
);

app.use("/api/*", async (c, next) => {
  const path = c.req.path;
  if (path === "/api/health" || path === "/api/login" || path === "/api/me") {
    return next();
  }
  const isAuthed = await isAuthenticated(c);
  if (!isAuthed) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.post("/api/login", async (c) => {
  const configuredPassword = c.env.AUTH_PASSWORD;
  if (!configuredPassword) {
    return c.json({ error: "AUTH_PASSWORD is not configured" }, 500);
  }

  let password = "";
  try {
    const body = await c.req.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  if (!password) {
    return c.json({ error: "password is required" }, 400);
  }

  if (password !== configuredPassword) {
    return c.json({ error: "invalid password" }, 401);
  }

  const hash = await hashPassword(configuredPassword);
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    buildAuthCookie(hash, c.req.url)
  );
  return new Response(null, { status: 204, headers });
});

app.post("/api/logout", (c) => {
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
  return new Response(null, { status: 204, headers });
});

app.get("/api/me", async (c) => {
  const isAuthed = await isAuthenticated(c);
  return c.json({ authenticated: isAuthed });
});

app.get("/api/favorites", async (c) => {
  const cache = caches.default;
  const cacheKey = new Request(c.req.url, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  const refreshToken = c.env.PIXIV_REFRESH_TOKEN;
  if (!refreshToken) {
    return c.json(
      { error: "PIXIV_REFRESH_TOKEN is not configured" },
      500
    );
  }

  const count = clampNumber(parseInt(c.req.query("count") || "20", 10), 10, 30);
  const tags = (c.req.query("tags") || "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  const mode = c.req.query("mode") === "and" ? "and" : "or";

  try {
    const auth = await refreshAccessToken(refreshToken);
    const allIllusts = await fetchAllBookmarks(auth);

    if (!allIllusts.length) {
      return c.json({ data: [] });
    }

    const filtered = filterByTags(allIllusts, tags, mode);
    const selected = sampleArray(filtered, count);

    const payload = selected.map((illust) => {
      const pageCount = illust.page_count || 1;
      const pages =
        pageCount > 1 && illust.meta_pages
          ? illust.meta_pages
              .map((page) => page.image_urls?.large || page.image_urls?.medium)
              .filter((url): url is string => !!url)
          : undefined;

      return {
        id: illust.id,
        title: illust.title,
        user: {
          id: illust.user?.id,
          name: illust.user?.name,
        },
        imageUrl: illust.image_urls?.medium,
        artworkUrl: `https://www.pixiv.net/artworks/${illust.id}`,
        userUrl: illust.user?.id
          ? `https://www.pixiv.net/users/${illust.user.id}`
          : undefined,
        pageCount,
        pages,
        tags: (illust.tags || []).map((tag) => tag.name),
      };
    });

    const response = c.json(
      { data: payload },
      200,
      {
        "Cache-Control": "public, max-age=300",
      }
    );
    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pixiv API error";
    return c.json({ error: message }, 500);
  }
});

app.get("/api/image", async (c) => {
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

  return new Response(imageResponse.body, {
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

function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function md5(message: string) {
  return md5Hex(md5Bytes(message));
}

async function hashPassword(password: string) {
  const data = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseCookies(cookieHeader: string | null) {
  if (!cookieHeader) {
    return new Map<string, string>();
  }
  return cookieHeader.split(";").reduce((map, part) => {
    const [rawName, ...rest] = part.trim().split("=");
    if (!rawName) {
      return map;
    }
    map.set(rawName, rest.join("="));
    return map;
  }, new Map<string, string>());
}

async function isAuthenticated(c: Context<Env>) {
  const configuredPassword = c.env.AUTH_PASSWORD;
  if (!configuredPassword) {
    return false;
  }
  const cookies = parseCookies(c.req.header("Cookie"));
  const token = cookies.get(AUTH_COOKIE);
  if (!token) {
    return false;
  }
  const expected = await hashPassword(configuredPassword);
  return token === expected;
}

function buildAuthCookie(token: string, url: string) {
  const isSecure = new URL(url).protocol === "https:";
  const secure = isSecure ? "; Secure" : "";
  return `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_TTL_SECONDS}${secure}`;
}

function renderLoginPage() {
  const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Pixiv Favorite Gallery</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Helvetica Neue", Arial, sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(140deg, #f5f5f5, #e8eef7);
      }
      .card {
        width: min(360px, 90vw);
        background: #ffffff;
        border-radius: 16px;
        padding: 28px;
        box-shadow: 0 18px 60px rgba(15, 23, 42, 0.12);
      }
      h1 {
        font-size: 20px;
        margin: 0 0 6px;
      }
      p {
        margin: 0 0 18px;
        color: #475569;
        font-size: 14px;
      }
      input {
        width: 100%;
        border: 1px solid #cbd5f5;
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 14px;
        box-sizing: border-box;
      }
      button {
        width: 100%;
        margin-top: 14px;
        border: none;
        border-radius: 10px;
        padding: 10px 12px;
        font-weight: 600;
        font-size: 14px;
        color: #ffffff;
        background: #3b82f6;
        cursor: pointer;
      }
      .error {
        margin-top: 12px;
        font-size: 12px;
        color: #dc2626;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Pixiv Favorite Gallery</h1>
      <p>閲覧にはパスワードが必要です。</p>
      <form id="login-form">
        <input id="password" type="password" placeholder="Password" autocomplete="current-password" />
        <button type="submit">ログイン</button>
      </form>
      <div id="error" class="error" aria-live="polite"></div>
    </div>
    <script>
      const form = document.getElementById("login-form");
      const passwordInput = document.getElementById("password");
      const errorEl = document.getElementById("error");

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        errorEl.textContent = "";
        const password = passwordInput.value.trim();
        if (!password) {
          errorEl.textContent = "パスワードを入力してください。";
          return;
        }
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password })
        });
        if (!res.ok) {
          errorEl.textContent = "パスワードが正しくありません。";
          return;
        }
        window.location.reload();
      });
    </script>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
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

export default app;
