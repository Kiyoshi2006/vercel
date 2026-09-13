  import React, { useState, useRef, useEffect } from 'react';
import Hls from 'hls.js';

export default function App() {
  const [m3u8Content, setM3u8Content] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [subName, setSubName] = useState('');
  
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const playlistBlobUrlRef = useRef(null);
  const subBlobUrlRef = useRef(null);

  // Chuyển đổi định dạng SRT sang WebVTT nếu tải tệp .srt
  const convertSrtToVtt = (srtText) => {
    let vtt = 'WEBVTT\n\n' + srtText
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
      .replace(/\{[^\}]+\}/g, '');
    return vtt;
  };

  const handleSubtitleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      let content = event.target.result;
      const isSrt = file.name.endsWith('.srt');

      if (isSrt) {
        content = convertSrtToVtt(content);
      }

      if (subBlobUrlRef.current) {
        URL.revokeObjectURL(subBlobUrlRef.current);
      }

      const blob = new Blob([content], { type: 'text/vtt' });
      subBlobUrlRef.current = URL.createObjectURL(blob);
      setSubName(file.name);
      attachSubtitleTrack(subBlobUrlRef.current, file.name);
    };
    reader.readAsText(file);
  };

  const attachSubtitleTrack = (url, label) => {
    const video = videoRef.current;
    if (!video) return;

    // Xóa các track phụ đề cũ đã thêm trước đó
    const oldTracks = video.querySelectorAll('track');
    oldTracks.forEach((t) => t.remove());

    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = label || 'Phụ đề';
    track.srclang = 'vi';
    track.src = url;
    track.default = true;

    video.appendChild(track);

    // Kích hoạt hiển thị track
    setTimeout(() => {
      if (video.textTracks && video.textTracks.length > 0) {
        for (let i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = 'showing';
        }
      }
    }, 100);
  };

  const handlePlayStream = () => {
    setErrorMsg('');
    const trimmed = m3u8Content.trim();
    if (!trimmed.startsWith('#EXTM3U')) {
      setErrorMsg('Nội dung phải bắt đầu bằng #EXTM3U');
      return;
    }

    if (playlistBlobUrlRef.current) {
      URL.revokeObjectURL(playlistBlobUrlRef.current);
    }

    const blob = new Blob([trimmed], { type: 'application/vnd.apple.mpegurl' });
    const playlistUrl = URL.createObjectURL(blob);
    playlistBlobUrlRef.current = playlistUrl;

    const video = videoRef.current;
    if (!video) return;

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
        // Nạp lại phụ đề nếu đã chọn tệp trước khi bấm phát
        if (subBlobUrlRef.current) {
          attachSubtitleTrack(subBlobUrlRef.current, subName);
        }
        video.play().catch((err) => console.log('Chặn autoplay:', err));
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setErrorMsg(`Lỗi luồng phát: ${data.details}`);
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playlistUrl;
      video.addEventListener('loadedmetadata', () => {
        if (subBlobUrlRef.current) {
          attachSubtitleTrack(subBlobUrlRef.current, subName);
        }
        video.play().catch((err) => console.log('Chặn autoplay:', err));
      });
    } else {
      setErrorMsg('Trình duyệt không hỗ trợ HLS.');
    }
  };

  useEffect(() => {
    return () => {
      if (hlsRef.current) hlsRef.current.destroy();
      if (playlistBlobUrlRef.current) URL.revokeObjectURL(playlistBlobUrlRef.current);
      if (subBlobUrlRef.current) URL.revokeObjectURL(subBlobUrlRef.current);
    };
  }, []);

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h2>Trình phát M3U8 kèm Phụ đề (.srt / .vtt)</h2>

      <textarea
        rows={8}
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

      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          onClick={handlePlayStream}
          style={{
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

        <label
          style={{
            padding: '9px 16px',
            background: '#334155',
            color: '#f8fafc',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14,
            border: '1px solid #475569',
          }}
        >
          Chọn tệp phụ đề (.srt, .vtt)
          <input
            type="file"
            accept=".srt,.vtt"
            style={{ display: 'none' }}
            onChange={handleSubtitleFile}
          />
        </label>

        {subName && (
          <span style={{ fontSize: 13, color: '#38bdf8' }}>
            Đã nạp: {subName}
          </span>
        )}
      </div>

      {errorMsg && (
        <div style={{ color: '#ef4444', marginTop: 15 }}>{errorMsg}</div>
      )}

      <div style={{ background: '#000', borderRadius: 8, overflow: 'hidden', marginTop: 20 }}>
        <video
          ref={videoRef}
          controls
          crossOrigin="anonymous"
          style={{ width: '100%', maxHeight: '500px', display: 'block' }}
        />
      </div>
    </div>
  );
}
