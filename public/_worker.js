
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    // 2. API Lưu M3U8 từ Web
    if (url.pathname === "/api/save" && request.method === "POST") {
      try {
        const body = await request.json();
        if (!body.content) return new Response("Thiếu nội dung", { status: 400 });

        const id = Math.random().toString(36).substring(2, 8);
        const origin = url.origin;

        // Biến đổi các link segment: thêm /proxy/ ở trước và thêm đuôi .ts ở sau
        // Ví dụ: https://p16.../hash -> https://domain/proxy/hash.ts
        const lines = body.content.split("\n");
        const convertedLines = lines.map((line) => {
          const trimmed = line.trim();
          if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            const cleanUrl = trimmed.replace("https://p16-lp-sg.ibyteimg.com/", "");
            return `${origin}/proxy/${cleanUrl}.ts`;
          }
          return line;
        });

        const modifiedContent = convertedLines.join("\n");

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

    // 3. Endpoint Proxy Segment (Loại bỏ đuôi .ts ảo trước khi tải từ ByteDance)
    if (url.pathname.startsWith("/proxy/")) {
      let realPath = url.pathname.replace("/proxy/", "");
      if (realPath.endsWith(".ts")) {
        realPath = realPath.slice(0, -3); // Cắt bỏ .ts ảo đi
      }

      const targetUrl = `https://p16-lp-sg.ibyteimg.com/${realPath}${url.search}`;

      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://www.tiktok.com/",
        },
      });

      const newHeaders = new Headers(response.headers);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      // Đặt Content-Type chuẩn video MPEG-TS để ép nPlayer nhận diện đúng stream
      newHeaders.set("Content-Type", "video/mp2t");

      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });
    }

    // 4. Trả về playlist .m3u8
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

    return env.ASSETS.fetch(request);
  },
};
