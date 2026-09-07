export const dynamic = "force-dynamic";

export async function GET() {
  const target = "https://animevietsub.li/";

  try {
    const r = await fetch(target, {
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    const body = await r.text();

    return new Response(body, {
      status: r.status,
      headers: {
        "Content-Type": "text/html; charset=UTF-8"
      }
    });
  } catch (e) {
    return new Response(
      `<h1>Proxy Error</h1><pre>${String(e)}</pre>`,
      {
        status: 502,
        headers: {
          "Content-Type": "text/html; charset=UTF-8"
        }
      }
    );
  }
}
