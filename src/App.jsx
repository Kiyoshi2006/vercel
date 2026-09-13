import React, { useState, useRef, useEffect } from 'react';
import Hls from 'hls.js';

export default function App() {
  const [m3u8Content, setM3u8Content] = useState('');
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const blobUrlRef = useRef(null);

  const cleanUpPlayer = () => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  };

  const processM3U8Content = () => {
    let trimmed = m3u8Content.trim();
    if (!trimmed.startsWith('#EXTM3U')) {
      setErrorMsg('Lỗi: Nội dung playlist phải bắt đầu bằng #EXTM3U');
      return null;
    }
    if (!trimmed.includes('#EXT-X-ENDLIST')) {
      trimmed += '\n#EXT-X-ENDLIST';
    }
    return trimmed;
  };

  // Phát trực tiếp trên trình duyệt
  const handlePlayStream = () => {
    setErrorMsg('');
    const validContent = processM3U8Content();
    if (!validContent) return;

    cleanUpPlayer();

    const blob = new Blob([validContent], { type: 'application/x-mpegURL' });
    const playlistUrl = URL.createObjectURL(blob);
    blobUrlRef.current = playlistUrl;

    const video = videoRef.current;
    if (!video) return;

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 60,
        maxBufferLength: 30,
        xhrSetup: (xhr) => {
          xhr.withCredentials = false;
        },
      });
      hlsRef.current = hls;

      hls.loadSource(playlistUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => console.warn('Cần tương tác để phát video.'));
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            setErrorMsg('Lỗi mạng hoặc CDN chặn CORS.');
            hls.startLoad();
          } else {
            setErrorMsg(`Lỗi media: ${data.details}`);
            hls.recoverMediaError();
          }
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playlistUrl;
      video.addEventListener('loadedmetadata', () => video.play().catch(() => {}));
    } else {
      setErrorMsg('Trình duyệt không hỗ trợ HLS.');
    }
  };

  // Tạo link ngắn cho nPlayer
  const handleGenerateLink = async () => {
    setErrorMsg('');
    const validContent = processM3U8Content();
    if (!validContent) return;

    try {
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
      // Dùng domain chính thức của Pages, không dùng subdomain commit
const BASE_DOMAIN = "https://vercel-1z4.pages.dev";
const finalUrl = `${BASE_DOMAIN}/p/${data.id}.m3u8`;

      setGeneratedUrl(finalUrl);
      setCopied(false);
    } catch (err) {
      setErrorMsg('Lỗi tạo link: ' + err.message);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getNPlayerUrl = () => {
    if (!generatedUrl) return '#';
    return generatedUrl.replace(/^https?:\/\//, (match) => 
      match.startsWith('https') ? 'nplayer-https://' : 'nplayer-http://'
    );
  };

  useEffect(() => {
    return () => cleanUpPlayer();
  }, []);

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <h2>Trình phát & Tạo Link M3U8 cho nPlayer</h2>

      <textarea
        rows={9}
        style={{
          width: '100%',
          backgroundColor: '#0f172a',
          color: '#38bdf8',
          borderRadius: 8,
          padding: 12,
          boxSizing: 'border-box',
          border: '1px solid #334155',
          fontFamily: 'monospace',
          fontSize: 13,
          lineHeight: '1.4',
        }}
        placeholder="Dán nội dung #EXTM3U vào đây..."
        value={m3u8Content}
        onChange={(e) => setM3u8Content(e.target.value)}
      />

      <div style={{ display: 'flex', gap: 10, marginTop: 12, marginBottom: 16 }}>
        <button
          onClick={handlePlayStream}
          style={{
            padding: '10px 18px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Phát Trực Tiếp
        </button>

        <button
          onClick={handleGenerateLink}
          style={{
            padding: '10px 18px',
            background: '#059669',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Tạo Link cho nPlayer
        </button>
      </div>

      {generatedUrl && (
        <div style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: 12, borderRadius: 6, marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#334155', marginBottom: 6, fontWeight: 600 }}>Link M3U8 online:</div>
          <input
            type="text"
            readOnly
            value={generatedUrl}
            style={{ width: '100%', padding: '6px 8px', fontSize: 12, boxSizing: 'border-box', borderRadius: 4, border: '1px solid #cbd5e1' }}
          />
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button
              onClick={copyToClipboard}
              style={{
                padding: '6px 12px',
                background: copied ? '#15803d' : '#475569',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              {copied ? '✓ Đã sao chép' : 'Sao chép Link'}
            </button>

            <a
              href={getNPlayerUrl()}
              style={{
                display: 'inline-block',
                padding: '6px 12px',
                background: '#e11d48',
                color: '#fff',
                textDecoration: 'none',
                borderRadius: 4,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Mở bằng nPlayer App
            </a>
          </div>
        </div>
      )}

      {errorMsg && (
        <div style={{ background: '#fee2e2', color: '#b91c1c', padding: 10, borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
          {errorMsg}
        </div>
      )}

      <div style={{ background: '#000', borderRadius: 8, overflow: 'hidden' }}>
        <video
          ref={videoRef}
          controls
          playsInline
          style={{ width: '100%', maxHeight: '500px', display: 'block' }}
        />
      </div>
    </div>
  );
  }
