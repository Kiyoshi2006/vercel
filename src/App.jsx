import React, { useState, useRef, useEffect } from 'react';
import Hls from 'hls.js';

export default function App() {
  const [m3u8Content, setM3u8Content] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [subName, setSubName] = useState('');
  const [cues, setCues] = useState([]);
  const [activeSubtitle, setActiveSubtitle] = useState('');

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const blobUrlRef = useRef(null);

  // Chuyển đổi timestamp dạng HH:MM:SS,mmm hoặc HH:MM:SS.mmm sang giây
  const timeToSeconds = (timeStr) => {
    const parts = timeStr.trim().replace(',', '.').split(':');
    if (parts.length === 3) {
      return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
      return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return 0;
  };

  // Parser đọc trực tiếp cả file .srt và .vtt thành danh sách mốc thời gian
  const parseSubtitleText = (text) => {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = normalized.split('\n\n');
    const parsedCues = [];

    const timeRegex = /((?:\d{2}:)?\d{2}:\d{2}[,.]\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}[,.]\d{3})/;

    blocks.forEach((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(timeRegex);
        if (match) {
          const start = timeToSeconds(match[1]);
          const end = timeToSeconds(match[2]);
          const content = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, ''); // Bỏ mã html màu mè nếu có
          if (content) {
            parsedCues.push({ start, end, text: content });
          }
          break;
        }
      }
    });

    return parsedCues;
  };

  const handleSubtitleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target.result;
      const parsed = parseSubtitleText(content);
      setCues(parsed);
      setSubName(file.name);
    };
    reader.readAsText(file);
  };

  const handlePlayStream = () => {
    setErrorMsg('');
    const trimmed = m3u8Content.trim();
    if (!trimmed.startsWith('#EXTM3U')) {
      setErrorMsg('Nội dung phải bắt đầu bằng #EXTM3U');
      return;
    }

    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
    }

    const blob = new Blob([trimmed], { type: 'application/vnd.apple.mpegurl' });
    const playlistUrl = URL.createObjectURL(blob);
    blobUrlRef.current = playlistUrl;

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
        video.play().catch((err) => console.log('Chặn autoplay:', err));
      });
    } else {
      setErrorMsg('Trình duyệt không hỗ trợ HLS.');
    }
  };

  // Cập nhật text phụ đề tương ứng với thời gian video đang phát
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || cues.length === 0) {
      setActiveSubtitle('');
      return;
    }
    const currentTime = video.currentTime;
    const currentCue = cues.find(
      (cue) => currentTime >= cue.start && currentTime <= cue.end
    );
    setActiveSubtitle(currentCue ? currentCue.text : '');
  };

  useEffect(() => {
    return () => {
      if (hlsRef.current) hlsRef.current.destroy();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h2>Trình phát M3U8 kèm Phụ đề Overlay (.srt / .vtt)</h2>

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
            Đã nạp: {subName} ({cues.length} câu)
          </span>
        )}
      </div>

      {errorMsg && (
        <div style={{ color: '#ef4444', marginTop: 15 }}>{errorMsg}</div>
      )}

      {/* Khung chứa Video & Lớp đè phụ đề */}
      <div
        style={{
          position: 'relative',
          background: '#000',
          borderRadius: 8,
          overflow: 'hidden',
          marginTop: 20,
        }}
      >
        <video
          ref={videoRef}
          controls
          onTimeUpdate={handleTimeUpdate}
          style={{ width: '100%', maxHeight: '520px', display: 'block' }}
        />

        {/* Lớp hiển thị phụ đề nổi trên video */}
        {activeSubtitle && (
          <div
            style={{
              position: 'absolute',
              bottom: '55px',
              left: '50%',
              transform: 'translateX(-50%)',
              textAlign: 'center',
              pointerEvents: 'none',
              width: '90%',
              zIndex: 10,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                backgroundColor: 'rgba(0, 0, 0, 0.75)',
                color: '#ffffff',
                padding: '4px 12px',
                borderRadius: '4px',
                fontSize: '18px',
                fontWeight: '600',
                lineHeight: '1.4',
                whiteSpace: 'pre-line',
                textShadow: '0 0 2px #000, 1px 1px 2px #000',
              }}
            >
              {activeSubtitle}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
