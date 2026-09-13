import React, { useState, useRef, useEffect } from 'react';
import Hls from 'hls.js';

export default function App() {
  const [m3u8Content, setM3u8Content] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const blobUrlRef = useRef(null);

  const handlePlayStream = () => {
    setErrorMsg('');
    const trimmed = m3u8Content.trim();
    if (!trimmed.startsWith('#EXTM3U')) {
      setErrorMsg('Nội dung phải bắt đầu bằng #EXTM3U');
      return;
    }

    // Thu hồi URL Blob cũ nếu có
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
    }

    // Tạo blob URL giả lập file playlist .m3u8
    const blob = new Blob([trimmed], { type: 'application/vnd.apple.mpegurl' });
    const playlistUrl = URL.createObjectURL(blob);
    blobUrlRef.current = playlistUrl;

    const video = videoRef.current;
    if (!video) return;

    // Hủy Hls instance cũ nếu đang chạy
    if (hlsRef.current) {
      hlsRef.current.destroy();
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });
      hlsRef.current = hls;

      hls.loadSource(playlistUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch((err) => console.log('Chặn autoplay:', err));
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setErrorMsg(`Lỗi luồng phát: ${data.details}`);
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Hỗ trợ Safari native HLS
      video.src = playlistUrl;
      video.addEventListener('loadedmetadata', () => {
        video.play().catch((err) => console.log('Chặn autoplay:', err));
      });
    } else {
      setErrorMsg('Trình duyệt không hỗ trợ HLS.');
    }
  };

  useEffect(() => {
    return () => {
      if (hlsRef.current) hlsRef.current.destroy();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: '0 auto' }}>
      <h2>Trình phát luồng M3U8 từ văn bản</h2>

      <textarea
        rows={10}
        style={{
          width: '100%',
          backgroundColor: '#1e293b',
          color: '#e2e8f0',
          borderRadius: 6,
          padding: 10,
          boxSizing: 'border-box',
          border: '1px solid #334155',
          fontFamily: 'monospace',
          fontSize: 13,
        }}
        placeholder="Dán toàn bộ nội dung #EXTM3U vào đây..."
        value={m3u8Content}
        onChange={(e) => setM3u8Content(e.target.value)}
      />

      <button
        onClick={handlePlayStream}
        style={{
          marginTop: 10,
          marginBottom: 20,
          padding: '10px 24px',
          background: '#2563eb',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        Nạp luồng & Phát
      </button>

      {errorMsg && (
        <div style={{ color: '#ef4444', marginBottom: 15 }}>{errorMsg}</div>
      )}

      <div style={{ background: '#000', borderRadius: 8, overflow: 'hidden' }}>
        <video
          ref={videoRef}
          controls
          style={{ width: '100%', maxHeight: '500px', display: 'block' }}
        />
      </div>
    </div>
  );
}
