export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Xử lý CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    // 1. API Lưu nội dung M3U8 từ giao diện web lên
    if (url.pathname === "/api/save" && request.method === "POST") {
      try {
        const body = await request.json();
        if (!body.content) {
          return new Response("Thiếu nội dung", { status: 400 });
        }
        
        // Tạo ID ngẫu nhiên 6 ký tự
        const id = Math.random().toString(36).substring(2, 8);
        
        // Lưu vào KV (tự động xóa sau 24 giờ = 86400 giây)
        if (env.M3U8_KV) {
          await env.M3U8_KV.put(id, body.content, { expirationTtl: 86400 });
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

    // 2. Endpoint trả về file .m3u8 cho nPlayer đọc: /p/<id>.m3u8
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
              "Cache-Control": "public, max-age=86400",
            },
          });
        }
      }
      return new Response("Link không tồn tại hoặc đã hết hạn", { status: 404 });
    }

    // 3. Trả về giao diện web thông thường
    return env.ASSETS.fetch(request);
  },
};
