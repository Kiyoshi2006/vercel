export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // Headers CORS & WebDAV
    const headers = new Headers({
      "DAV": "1, 2",
      "MS-Author-Via": "DAV",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "OPTIONS, GET, HEAD, PROPFIND, LOCK, UNLOCK, PROPPATCH",
      "Access-Control-Allow-Headers": "*",
    });

    if (method === "OPTIONS") {
      return new Response(null, { status: 200, headers });
    }

    if (method === "LOCK") {
      headers.set("Content-Type", "application/xml; charset=utf-8");
      headers.set("Lock-Token", "<opaquelocktoken:dummy-token>");
      const lockXml = `<?xml version="1.0" encoding="utf-8"?><D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope><D:depth>Infinity</D:depth><D:timeout>Second-3600</D:timeout><D:locktoken><D:href>opaquelocktoken:dummy-token</D:href></D:locktoken></D:activelock></D:lockdiscovery></D:prop>`;
      return new Response(lockXml, { status: 200, headers });
    }

    if (method === "UNLOCK" || method === "PROPPATCH") {
      return new Response(null, { status: 204, headers });
    }

    try {
      // 1. Lấy Access Token từ Refresh Token
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.CLIENT_ID,
          client_secret: env.CLIENT_SECRET,
          refresh_token: env.REFRESH_TOKEN,
          grant_type: "refresh_token",
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        return new Response(tokenData.error_description || "Auth Error", { status: 401, headers });
      }
      const token = tokenData.access_token;

      // 2. Tìm ID theo từng cấp thư mục
      const segments = url.pathname.split("/").map(decodeURIComponent).filter(Boolean);
      let parentId = "root";
      let currentItem = { id: "root", name: "root", mimeType: "application/vnd.google-apps.folder" };

      for (const seg of segments) {
        const safeName = seg.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        const q = `'${parentId}' in parents and name = '${safeName}' and trashed = false`;
        const searchRes = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=1`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const searchData = await searchRes.json();
        if (!searchData.files || searchData.files.length === 0) {
          return new Response("Not Found", { status: 404, headers });
        }
        currentItem = searchData.files[0];
        parentId = currentItem.id;
      }

      const isFolder = currentItem.mimeType === "application/vnd.google-apps.folder";

      // 3. Xử lý PROPFIND (Duyệt thư mục cho nPlayer)
      if (method === "PROPFIND") {
        const depth = request.headers.get("depth") || "1";
        const basePath = "/" + segments.map(encodeURIComponent).join("/");
        const selfHref = isFolder ? (basePath === "/" ? "/" : `${basePath}/`) : basePath;

        let itemsList = [currentItem];

        if (isFolder && depth !== "0") {
          const q = `'${currentItem.id}' in parents and trashed = false`;
          const listRes = await fetch(
            `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,modifiedTime)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=1000`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const listData = await listRes.json();
          if (listData.files) {
            itemsList = [currentItem, ...listData.files];
          }
        }

        const xmlEntries = itemsList.map((f) => {
          const isSelf = f.id === currentItem.id;
          const isDir = f.mimeType === "application/vnd.google-apps.folder";
          const href = isSelf
            ? selfHref
            : `${selfHref.replace(/\/$/, "")}/${encodeURIComponent(f.name)}${isDir ? "/" : ""}`;

          return `
          <D:response>
            <D:href>${href}</D:href>
            <D:propstat>
              <D:prop>
                <D:displayname><![CDATA[${f.name || "Root"}]]></D:displayname>
                <D:getcontenttype>${isDir ? "httpd/unix-directory" : f.mimeType || "application/octet-stream"}</D:getcontenttype>
                <D:resourcetype>${isDir ? "<D:collection/>" : ""}</D:resourcetype>
                ${f.size ? `<D:getcontentlength>${f.size}</D:getcontentlength>` : ""}
                ${f.modifiedTime ? `<D:getlastmodified>${new Date(f.modifiedTime).toUTCString()}</D:getlastmodified>` : ""}
              </D:prop>
              <D:status>HTTP/1.1 200 OK</D:status>
            </D:propstat>
          </D:response>`;
        }).join("");

        const xml = `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${xmlEntries}</D:multistatus>`;
        headers.set("Content-Type", "application/xml; charset=utf-8");
        return new Response(xml, { status: 207, headers });
      }

      // 4. Xử lý HEAD
      if (method === "HEAD") {
        if (isFolder) return new Response(null, { status: 404, headers });
        headers.set("Content-Length", currentItem.size || "0");
        headers.set("Content-Type", currentItem.mimeType || "application/octet-stream");
        headers.set("Accept-Ranges", "bytes");
        return new Response(null, { status: 200, headers });
      }

      // 5. Xử lý GET (Stream video Google Drive)
      if (method === "GET") {
        if (isFolder) return new Response("Cannot download folder", { status: 404, headers });

        const fetchHeaders = { Authorization: `Bearer ${token}` };
        const range = request.headers.get("range");
        if (range) fetchHeaders["Range"] = range;

        const driveRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${currentItem.id}?alt=media&supportsAllDrives=true`,
          { headers: fetchHeaders }
        );

        headers.set("Content-Type", driveRes.headers.get("Content-Type") || currentItem.mimeType || "application/octet-stream");
        headers.set("Accept-Ranges", "bytes");
        if (driveRes.headers.has("Content-Length")) headers.set("Content-Length", driveRes.headers.get("Content-Length"));
        if (driveRes.headers.has("Content-Range")) headers.set("Content-Range", driveRes.headers.get("Content-Range"));

        return new Response(driveRes.body, { status: driveRes.status, headers });
      }

      return new Response("Method Not Allowed", { status: 405, headers });
    } catch (err) {
      return new Response(err.message, { status: 500, headers });
    }
  },
};
