/**
 * AnimeVietsub Provider for SkyStream
 * Migrated from CloudStream extension
 */

const DEFAULT_ENTRY_URL = "https://bit.ly/animevietsubtv";
const FALLBACK_DOMAIN = "https://animevietsub.site";

let activeDomain = null;
let globalCookies = "";

const headersBypass = (referer = "") => {
  const h = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "vi,en-US;q=0.9,en;q=0.8",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
  };
  if (referer) h["Referer"] = referer;
  if (globalCookies) h["Cookie"] = globalCookies;
  return h;
};

// --- Cookie & Request Helper ---
function mergeCookies(existing, setCookieHeaders = []) {
  const cookieMap = new Map();
  if (existing) {
    existing.split(";").forEach(pair => {
      const parts = pair.split("=");
      if (parts.length >= 2) cookieMap.set(parts[0].trim(), parts.slice(1).join("=").trim());
    });
  }
  for (const header of setCookieHeaders) {
    const clean = header.split(";")[0];
    const parts = clean.split("=");
    if (parts.length >= 2) cookieMap.set(parts[0].trim(), parts.slice(1).join("=").trim());
  }
  return Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function fetchWithBypass(url, referer = "") {
  let currentUrl = url;
  let attempts = 0;
  let lastHtml = "";

  while (attempts < 4) {
    const res = await fetch(currentUrl, {
      headers: headersBypass(referer || currentUrl),
      redirect: "manual"
    });

    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
    if (setCookies.length) {
      globalCookies = mergeCookies(globalCookies, setCookies);
    }

    // Xử lý HTTP redirect nếu có
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      currentUrl = new URL(res.headers.get("location"), currentUrl).href;
      attempts++;
      continue;
    }

    lastHtml = await res.text();

    // Xử lý JS redirect (window.location.href)
    if (lastHtml.includes("window.location.href")) {
      const match = lastHtml.match(/window\.location\.href\s*=\s*["']([^"']+)["']/);
      if (match && match[1]) {
        currentUrl = new URL(match[1], currentUrl).href;
        await new Promise(r => setTimeout(r, 300));
        attempts++;
        continue;
      }
    }
    break;
  }
  return lastHtml;
}

async function getBaseUrl() {
  if (activeDomain) return activeDomain;
  try {
    const res = await fetch(DEFAULT_ENTRY_URL, {
      headers: headersBypass(),
      redirect: "follow"
    });
    const finalUrl = res.url;
    if (finalUrl && finalUrl.startsWith("http") && !finalUrl.includes("bit.ly")) {
      const u = new URL(finalUrl);
      activeDomain = `${u.protocol}//${u.host}`;
      return activeDomain;
    }
  } catch (e) {
    // fallback
  }
  activeDomain = FALLBACK_DOMAIN;
  return activeDomain;
}

function fixUrl(url, base) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return `https:${url}`;
  return new URL(url, base).href;
}

// --- Crypto & Algorithm Decryption (GoogleApis CDN) ---
function createPrng(seedStr) {
  let hash = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    hash = Math.imul(16777619, (seedStr.charCodeAt(i) ^ hash) >>> 0) >>> 0;
  }
  let state = hash === 0 ? 1 : hash;
  return function next() {
    state ^= (state << 13) >>> 0;
    state ^= (state >>> 17);
    state ^= (state << 5) >>> 0;
    return (state >>> 0);
  };
}

function lcgNext(state) {
  return ((Math.imul(state, 1664525) + 1013904223) >>> 0);
}

function deriveSeed(sk) {
  const sub = sk.substring(0, Math.min(8, sk.length));
  let hexPrefix = "";
  for (let i = 0; i < sub.length; i++) {
    const c = sub[i];
    if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
      hexPrefix += c;
    } else break;
  }
  return hexPrefix.length ? parseInt(hexPrefix, 16) : 0;
}

function stringUnshuffle(str, seed) {
  const chars = str.split("");
  const len = chars.length;
  let state = deriveSeed(seed);
  const swaps = [];

  for (let i = len - 1; i > 0; i--) {
    state = lcgNext(state);
    const j = (state >>> 0) % (i + 1);
    swaps.push([i, j]);
  }

  for (let idx = swaps.length - 1; idx >= 0; idx--) {
    const [a, b] = swaps[idx];
    const temp = chars[a];
    chars[a] = chars[b];
    chars[b] = temp;
  }
  return chars.join("");
}

function descramble(dataBytes, permKey, permSalt) {
  const len = dataBytes.length;
  if (len === 0) return new Uint8Array(0);

  const rng = createPrng(`${permKey}|${permSalt}`);
  const perm = Array.from({ length: len }, (_, i) => i);

  for (let i = len - 1; i > 0; i--) {
    const j = rng() % (i + 1);
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }

  const output = new Uint8Array(len);
  let xorState = 0;
  for (let i = 0; i < len; i++) {
    if ((i & 3) === 0) xorState = rng();
    const xorByte = (xorState >>> ((i & 3) * 8)) & 0xff;
    output[perm[i]] = dataBytes[i] ^ xorByte;
  }
  return output;
}

async function hmacSha256(keyStr, dataStr) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyStr),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(dataStr));
  return new Uint8Array(signature);
}

function b64UrlToBytes(str) {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4 !== 0) s += "=";
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// AES-CTR Decryption cho các file đoạn .ts
async function decryptSegmentUrl(eParam, iParam, fileId, jtiOdd) {
  try {
    const aesKey = await hmacSha256(jtiOdd, `url-cipher|${fileId}`);
    const counter = new Uint8Array(16);
    counter[12] = (iParam >>> 24) & 0xff;
    counter[13] = (iParam >>> 16) & 0xff;
    counter[14] = (iParam >>> 8) & 0xff;
    counter[15] = iParam & 0xff;

    const key = await crypto.subtle.importKey(
      "raw",
      aesKey,
      { name: "AES-CTR" },
      false,
      ["decrypt"]
    );

    const ciphertext = b64UrlToBytes(eParam);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-CTR", counter, length: 64 },
      key,
      ciphertext
    );

    const decUrl = new TextDecoder().decode(decrypted);
    return decUrl.startsWith("http") ? decUrl : null;
  } catch (e) {
    return null;
  }
}

// Giải mã M3U8 trả về từ CDN
async function decryptGoogleApisCdn(playerUrl) {
  try {
    const html = await fetchWithBypass(playerUrl, playerUrl);
    const tokenMatch = html.match(/const\s+avsToken\s*=\s*"([^"]+)/);
    const hashMatch = playerUrl.match(/\/player\/([0-9a-f]+)/);

    if (!tokenMatch || !hashMatch) return null;
    const avsToken = tokenMatch[1];
    const videoHash = hashMatch[1];

    const baseUrlMatch = playerUrl.match(/^(https?:\/\/[^\/]+)/);
    if (!baseUrlMatch) return null;
    const cdnBase = baseUrlMatch[1];

    const m3u8Url = `${cdnBase}/playlist/${videoHash}/playlist.m3u8?token=${encodeURIComponent(avsToken)}`;
    const m3u8Res = await fetch(m3u8Url, {
      headers: { ...headersBypass(), Referer: playerUrl }
    });

    const m3u8Text = await m3u8Res.text();
    const lines = m3u8Text.split("\n");
    const hlsRe = /\/hls\/([0-9a-f]{24})\.ts/;
    const outLines = [...lines];

    // JTI / Odd secret dùng cho Mac key
    const jtiOdd = m3u8Res.headers.get("x-jti-odd") || avsToken.split("").reverse().join("");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("#") || line.length === 0) continue;

      const m = line.match(hlsRe);
      if (m) {
        const fileId = m[1];
        const qIdx = line.indexOf("?");
        if (qIdx >= 0) {
          const params = new URLSearchParams(line.substring(qIdx + 1));
          const eParam = params.get("e");
          const iParam = parseInt(params.get("i") || "0", 10);
          if (eParam) {
            const decUrl = await decryptSegmentUrl(eParam, iParam, fileId, jtiOdd);
            if (decUrl) outLines[i] = decUrl;
          }
        }
      }
    }

    // Loại bỏ shield marker
    const cleanLines = outLines.filter(l => !l.includes("urn:avs:shield") && !/\/hls\/[0-9a-f]{24}\.ts/.test(l));
    return cleanLines.join("\n");
  } catch (e) {
    return null;
  }
}

// --- Main Provider Exports ---
export default {
  id: "animevietsub",
  name: "AnimeVietsub",
  version: "1.0.0",
  lang: "vi",
  type: ["anime", "movie"],

  // 1. Khám phá & Trang chủ
  async getMainPage() {
    const base = await getBaseUrl();
    const sections = [
      { path: "/anime-moi/", title: "Mới Cập Nhật" },
      { path: "/anime-sap-chieu/", title: "Sắp Chiếu" },
      { path: "/bang-xep-hang/day.html", title: "Xem Nhiều Trong Ngày" }
    ];

    const result = [];
    for (const sec of sections) {
      try {
        const html = await fetchWithBypass(fixUrl(sec.path, base));
        const items = [];
        const matches = [...html.matchAll(/<article[^>]*class="[^"]*TPostMv[^"]*"[^>]*>([\s\S]*?)<\/article>/g)];

        for (const item of matches) {
          const itemHtml = item[1];
          const linkM = itemHtml.match(/<a\s+href="([^"]+)"/);
          const titleM = itemHtml.match(/<h2[^>]*class="Title"[^>]*>([^<]+)<\/h2>/) || itemHtml.match(/class="Title">([^<]+)</);
          const posterM = itemHtml.match(/data-src="([^"]+)"/) || itemHtml.match(/src="([^"]+)"/);
          const epM = itemHtml.match(/class="(?:mli-eps|mli-quality|label)">([^<]+)</);

          if (linkM && titleM) {
            items.push({
              title: titleM[1].trim(),
              url: fixUrl(linkM[1], base),
              poster: posterM ? fixUrl(posterM[1], base) : "",
              statusText: epM ? epM[1].trim() : ""
            });
          }
        }
        result.push({ title: sec.title, items });
      } catch (e) {}
    }
    return result;
  },

  // 2. Tìm kiếm
  async search(query) {
    const base = await getBaseUrl();
    const searchUrl = `${base}/tim-kiem/${encodeURIComponent(query)}/`;
    const html = await fetchWithBypass(searchUrl);

    const items = [];
    const matches = [...html.matchAll(/<article[^>]*class="[^"]*TPostMv[^"]*"[^>]*>([\s\S]*?)<\/article>/g)];

    for (const item of matches) {
      const block = item[1];
      const linkM = block.match(/<a\s+href="([^"]+)"/);
      const titleM = block.match(/class="Title">([^<]+)</);
      const posterM = block.match(/data-src="([^"]+)"/) || block.match(/src="([^"]+)"/);

      if (linkM && titleM) {
        items.push({
          title: titleM[1].trim(),
          url: fixUrl(linkM[1], base),
          poster: posterM ? fixUrl(posterM[1], base) : ""
        });
      }
    }
    return items;
  },

  // 3. Chi tiết phim & Danh sách tập
  async getDetail(url) {
    const base = await getBaseUrl();
    const html = await fetchWithBypass(url);

    // Metadata
    const titleM = html.match(/<h1[^>]*class="Title"[^>]*>([^<]+)<\/h1>/);
    const plotM = html.match(/<div[^>]*class="Description"[^>]*>([\s\S]*?)<\/div>/);
    const posterM = html.match(/class="Image[^"]*">\s*<figure[^>]*>\s*<img[^>]*src="([^"]+)"/) || html.match(/property="og:image"\s+content="([^"]+)"/);

    // Parse Episodes & Servers
    const episodes = [];
    const epGroupMatches = [...html.matchAll(/<div[^>]*class="server-group[^"]*"[^>]*>([\s\S]*?)<\/div>/g)];

    for (const grp of epGroupMatches) {
      const grpHtml = grp[1];
      const serverNameM = grpHtml.match(/class="server-name">([^<]+)</);
      const groupName = serverNameM ? serverNameM[1].trim() : "VIP";

      const btnMatches = [...grpHtml.matchAll(/<a[^>]*class="[^"]*btn-episode[^"]*"[^>]*data-hash="([^"]+)"[^>]*data-id="([^"]+)"[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)];

      for (const btn of btnMatches) {
        const hash = btn[1];
        const id = btn[2];
        const href = fixUrl(btn[3], base);
        const epName = btn[4].trim() || "Tập";

        episodes.push({
          name: epName,
          group: groupName,
          // Đóng gói data để load video
          data: JSON.stringify({ hash, id, href, groupName })
        });
      }
    }

    return {
      title: titleM ? titleM[1].trim() : "",
      plot: plotM ? plotM[1].replace(/<[^>]+>/g, "").trim() : "",
      poster: posterM ? fixUrl(posterM[1], base) : "",
      episodes
    };
  },

  // 4. Giải mã Link Video (Stream)
  async getSources(epDataStr) {
    const serverData = JSON.parse(epDataStr);
    const base = await getBaseUrl();

    // 1. Gửi Ajax lấy player
    const formParams = new URLSearchParams();
    formParams.append("link", serverData.hash);
    formParams.append("id", serverData.id);

    const ajaxRes = await fetch(`${base}/ajax/player`, {
      method: "POST",
      headers: {
        ...headersBypass(base),
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: formParams.toString()
    });

    const playerJson = await ajaxRes.json();
    const rawLink = playerJson.link;
    const playTech = playerJson.playTech;

    // 2. Phân nhánh Player
    if (playTech === "iframe" && rawLink.includes("googleapiscdn.com")) {
      const decryptedM3u8 = await decryptGoogleApisCdn(rawLink);
      if (decryptedM3u8) {
        // Upload Pacebin trung chuyển cho player chạy mượt mà
        let pacebinUrl = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const pbRes = await fetch("https://pacebin.onrender.com/animevietsub.m3u8", {
              method: "POST",
              headers: { "Content-Type": "text/plain" },
              body: decryptedM3u8
            });
            const text = await pbRes.text();
            const firstHttp = text.split("\n").map(l => l.trim()).find(l => l.startsWith("http"));
            if (firstHttp) {
              pacebinUrl = firstHttp;
              break;
            }
          } catch (e) {
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        if (pacebinUrl) {
          return [{
            file: pacebinUrl,
            type: "hls",
            label: `${serverData.groupName} - Full HD`
          }];
        }
      }
    }

    // Direct M3U8 hoặc Mp4
    if (rawLink && rawLink.startsWith("http")) {
      return [{
        file: rawLink,
        type: rawLink.includes(".m3u8") ? "hls" : "mp4",
        label: serverData.groupName
      }];
    }

    return [];
  }
};
