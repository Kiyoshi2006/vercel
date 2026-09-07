export const dynamic = "force-dynamic";

export async function GET() {
  const target = "https://animevietsub.li";
  const start = Date.now();

  try {
    const r = await fetch(target, {
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    const body = await r.text();

    const headers = {};
    r.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return Response.json({
      ok: r.ok,
      status: r.status,
      statusText: r.statusText,
      finalUrl: r.url,
      contentType: r.headers.get("content-type"),
      server: r.headers.get("server"),
      cfRay: r.headers.get("cf-ray"),
      cfCache: r.headers.get("cf-cache-status"),
      location: r.headers.get("location"),
      headers,
      length: body.length,
      ms: Date.now() - start,
      preview: body.slice(0, 500)
    });
  } catch (e) {
    return Response.json({
      ok: false,
      error: String(e),
      ms: Date.now() - start
    }, { status: 502 });
  }
}
