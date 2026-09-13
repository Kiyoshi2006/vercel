export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Xử lý preflight CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    // 2. Chỉ xử lý các link kết thúc bằng .m3u8
    if (url.pathname.endsWith(".m3u8")) {
      const encodedData = url.searchParams.get("data");
      if (!encodedData) {
        return new Response("Missing data parameter", { status: 400 });
      }

      try {
        // Giải mã chuỗi base64 UTF-8
        const decodedText = decodeURIComponent(escape(atob(encodedData)));
        return new Response(decodedText, {
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=86400",
          },
        });
      } catch (err) {
        return new Response("Invalid base64 payload", { status: 400 });
      }
    }

    // 3. QUAN TRỌNG: Nếu là các trang khác hoặc file giao diện (HTML/JS/CSS),
    // chuyển tiếp cho Cloudflare Pages tự trả về giao diện web:
    return env.ASSETS.fetch(request);
  },
};
