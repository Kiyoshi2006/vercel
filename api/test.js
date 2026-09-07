export default async function handler(req, res) {
  const target = "https://animevietsub.li";

  const start = Date.now();

  try {
    const r = await fetch(target, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const body = await r.text();

    res.status(200).json({
      ok: r.ok,
      status: r.status,
      finalUrl: r.url,
      contentType: r.headers.get("content-type"),
      length: body.length,
      ms: Date.now() - start,
      preview: body.slice(0, 200),
    });
  } catch (e) {
    res.status(502).json({
      ok: false,
      error: String(e),
      ms: Date.now() - start,
    });
  }
}
