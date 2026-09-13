export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Xử lý CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    // 2. API Lưu M3U8 từ giao diện Web
    if (url.pathname === "/api/save" && request.method === "POST") {
      try {
        const body = await request.json();
        if (!body.content) return new Response("Thiếu nội dung", { status: 400 });

        const id = Math.random().toString(36).substring(2, 8);

        // Chuyển toàn bộ link ibyteimg thành link proxy qua worker để nPlayer không bị chặn
        const origin = url.origin;
        const modifiedContent = body.content.replace(
          /https:\/\/p16-lp-sg\.ibyteimg\.com\//g,
          `${origin}/proxy/`
        );

        if (env.M3U8_KV) {
          await env.M3U8_KV.put(id, modifiedContent, { expirationTtl: 86400 });
        } else {
          return new Response("Chưa liên kết KV namespace", { status: 500 });
        }

        return new Response(JSON.stringify({ id }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      } catch (err) {
        return new Response(err.message, { status: 500 });
      }
    }

    // 3. Endpoint proxy segment chống chặn cho nPlayer
    if (url.pathname.startsWith("/proxy/")) {
      const realPath = url.pathname.replace("/proxy/", "");
      const targetUrl = `https://p16-lp-sg.ibyteimg.com/${realPath}${url.search}`;

      // Giả lập request từ trình duyệt Chrome
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://www.tiktok.com/",
        },
      });

      const newHeaders = new Headers(response.headers);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });
    }

    // 4. Trả về playlist .m3u8 cho nPlayer
    if (url.pathname.startsWith("/p/") && url.pathname.endsWith(".m3u8")) {
      const parts = url.pathname.split("/");
      const id = parts[2].replace(".m3u8", "");

      if (env.M3U8_KV) {
        const content = await env.M3U8_KV.get(id);
        if (content) {
          return new Response(content, {
            headers: {
              "Content-Type": "application/vnd.apple.mpegurl",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "no-cache",
            },
          });
        }
      }
      return new Response("Link không tồn tại hoặc đã hết hạn", { status: 404 });
    }

    // 5. Trả về giao diện web
    return env.ASSETS.fetch(request);
  },
};
