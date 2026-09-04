const UPSTREAM = "https://animevietsub.li";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. ENDPOINT GIẢI MÃ M3U8 STREAM
    if (url.pathname === "/stream") {
      const id = url.searchParams.get("id");
      const hash = url.searchParams.get("hash");

      if (!id || !hash) {
        return new Response("Thiếu data-id hoặc data-hash", { status: 400 });
      }

      try {
        const m3u8Content = await resolveStream(UPSTREAM, id, hash);
        return new Response(m3u8Content, {
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache"
          }
        });
      } catch (err) {
        return new Response(`Lỗi giải mã: ${err.message}`, { status: 500 });
      }
    }

    // 2. PROXY & REWRITE GIAO DIỆN WEB GỐC
    const targetUrl = new URL(url.pathname + url.search, UPSTREAM);
    
    // Copy headers từ client và giả lập trình duyệt hợp lệ
    const forwardHeaders = new Headers(request.headers);
    forwardHeaders.set("Host", targetUrl.host);
    forwardHeaders.set("Referer", UPSTREAM);
    forwardHeaders.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36");

    let response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: forwardHeaders,
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
      redirect: "follow"
    });

    const contentType = response.headers.get("content-type") || "";

    // Nếu không phải HTML (CSS, JS, PNG, JPG,...), trả về trực tiếp
    if (!contentType.includes("text/html")) {
      return response;
    }

    // Rewrite HTML: Chèn thư viện Hls.js và script hook chọn tập vào Player
    const playerInjector = `
      <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
      <script>
        let currentHls = null;

        function playEpisode(id, hash) {
          if (!id || !hash) return;
          const streamUrl = '/stream?id=' + encodeURIComponent(id) + '&hash=' + encodeURIComponent(hash);
          
          let container = document.querySelector('#media-player, #player, .player, .media-player');
          if (!container) {
            container = document.createElement('div');
            container.id = 'custom-player-wrapper';
            document.body.prepend(container);
          }
          
          container.innerHTML = '<video id="cf-video" controls autoplay style="width:100%;height:100%;min-height:360px;background:#000;border-radius:6px;"></video>';
          const video = document.getElementById('cf-video');

          if (currentHls) currentHls.destroy();

          if (Hls.isSupported()) {
            currentHls = new Hls();
            currentHls.loadSource(streamUrl);
            currentHls.attachMedia(video);
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = streamUrl;
          }
        }

        document.addEventListener('DOMContentLoaded', () => {
          // Bắt sự kiện click vào các nút tập phim
          document.body.addEventListener('click', (e) => {
            const epBtn = e.target.closest('a[data-hash], a[data-id], .btn-episode');
            if (epBtn) {
              const id = epBtn.getAttribute('data-id');
              const hash = epBtn.getAttribute('data-hash');
              if (hash) {
                e.preventDefault();
                e.stopPropagation();
                
                // Cập nhật trạng thái active của nút
                document.querySelectorAll('.btn-episode').forEach(el => el.classList.remove('active'));
                epBtn.classList.add('active');

                playEpisode(id, hash);
              }
            }
          });

          // Tự động phát tập đầu tiên nếu đang ở trang xem phim
          setTimeout(() => {
            const firstEp = document.querySelector('ul.list-episode a[data-hash], .list-episode a[data-hash]');
            if (firstEp) {
              firstEp.click();
            }
          }, 800);
        });
      </script>
    `;

    return new HTMLRewriter()
      .on("body", {
        element(e) {
          e.append(playerInjector, { html: true });
        }
      })
      .transform(response);
  }
};

// --- LOGIC GIẢI MÃ NGUỒN PHÁT (TRÍCH TỪ DECOMPILED DEDEX) ---
async function resolveStream(baseUrl, id, hash) {
  const ajaxHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": baseUrl
  };

  const postBody = new URLSearchParams({ link: hash, id: id });
  const playerRes = await fetch(`${baseUrl}/ajax/player`, {
    method: "POST",
    headers: ajaxHeaders,
    body: postBody.toString()
  });

  const playerData = await playerRes.json();
  const link = playerData.link;

  if (!link.includes("googleapiscdn.com")) {
    const directRes = await fetch(link, { headers: { Referer: baseUrl } });
    return await directRes.text();
  }

  return await decryptGoogleApis(link);
}

async function decryptGoogleApis(playerUrl) {
  const res = await fetch(playerUrl, {
    headers: { "Referer": "https://stream.googleapiscdn.com/" }
  });
  const html = await res.text();

  const tokenMatch = html.match(/const\s+avsToken\s*=\s*"([^"]+)/);
  const hashMatch = playerUrl.match(/\/player\/([0-9a-f]+)/);
  const baseMatch = playerUrl.match(/^(https?:\/\/[^\/]+)/);

  if (!tokenMatch || !hashMatch || !baseMatch) {
    throw new Error("Không thể trích xuất metadata từ CDN");
  }

  const avsToken = tokenMatch[1];
  const videoHash = hashMatch[1];
  const cdnBase = baseMatch[1];

  const m3u8Url = `${cdnBase}/playlist/${videoHash}/playlist.m3u8?token=${encodeURIComponent(avsToken)}`;
  const m3u8Res = await fetch(m3u8Url, {
    headers: { "Referer": playerUrl }
  });

  const encryptedM3u8 = await m3u8Res.text();
  return await decryptSegmentUrls(encryptedM3u8, avsToken);
}

async function decryptSegmentUrls(m3u8Content, jtiOdd) {
  const lines = m3u8Content.split("\n");
  const hlsRe = /\/hls\/([0-9a-f]{24})\.ts/;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const outLines = [];

  for (let line of lines) {
    line = line.trim();
    if (line.startsWith("#") || line.length === 0) {
      if (!line.includes("urn:avs:shield")) {
        outLines.push(line);
      }
      continue;
    }

    const match = line.match(hlsRe);
    if (!match) {
      outLines.push(line);
      continue;
    }

    const fileId = match[1];
    const qIndex = line.indexOf("?");
    if (qIndex === -1) {
      outLines.push(line);
      continue;
    }

    const params = new URLSearchParams(line.substring(qIndex + 1));
    const eParam = params.get("e");
    const iParam = parseInt(params.get("i") || "0", 10);

    if (!eParam) {
      outLines.push(line);
      continue;
    }

    try {
      const hmacKey = await crypto.subtle.importKey(
        "raw",
        enc.encode(jtiOdd),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );

      const aesKeyRaw = await crypto.subtle.sign(
        "HMAC",
        hmacKey,
        enc.encode(`url-cipher|${fileId}`)
      );

      const counter = new Uint8Array(16);
      counter[12] = (iParam >> 24) & 0xff;
      counter[13] = (iParam >> 16) & 0xff;
      counter[14] = (iParam >> 8) & 0xff;
      counter[15] = iParam & 0xff;

      const aesKey = await crypto.subtle.importKey(
        "raw",
        aesKeyRaw,
        { name: "AES-CTR" },
        false,
        ["decrypt"]
      );

      let base64 = eParam.replace(/-/g, "+").replace(/_/g, "/");
      while (base64.length % 4 !== 0) base64 += "=";
      
      const cipherData = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-CTR", counter: counter, length: 64 },
        aesKey,
        cipherData
      );

      const realUrl = dec.decode(decrypted);
      if (realUrl.startsWith("http")) {
        outLines.push(realUrl);
      }
    } catch (e) {
      outLines.push(line);
    }
  }

  return outLines.join("\n");
}
