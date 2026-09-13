export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Xử lý preflight CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
        },
      });
    }

    // Endpoint nhận mã Base64 qua query param: /playlist.m3u8?data=<base64>
    if (url.pathname.endsWith(".m3u8")) {
      const encodedData = url.searchParams.get("data");
      if (!encodedData) {
        return new Response("Missing data", { status: 400 });
      }

      try {
        // Giải mã nội dung m3u8 từ chuỗi base64 UTF-8
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

    return new Response("Worker is running", { status: 200 });
  },
};
