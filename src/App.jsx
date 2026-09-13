  const handleGenerateLink = async () => {
    setErrorMsg('');
    const validContent = processM3U8Content();
    if (!validContent) return;

    try {
      // Gửi nội dung lên Worker để lấy link ngắn
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: validContent }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || 'Không thể tạo link');
      }

      const data = await res.json();
      // Tạo link chuẩn dạng: https://domain-cua-ban.pages.dev/p/abc123.m3u8
      const finalUrl = `${window.location.origin}/p/${data.id}.m3u8`;
      
      setGeneratedUrl(finalUrl);
      setCopied(false);
    } catch (err) {
      setErrorMsg('Lỗi tạo link: ' + err.message);
    }
  };
