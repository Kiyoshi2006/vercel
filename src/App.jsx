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

  const parseTimeToSeconds = (str) => {
    if (!str) return 0;
    const parts = str.trim().replace(',', '.').split(':');
    if (parts.length === 3) {
      return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) {
      return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return parseFloat(str) || 0;
  };

  const parseAssSubtitle = (text) => {
    const lines = text.split(/\r?\n/);
    const parsedCues = [];
    let formatIndexMap = null;

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      if (line.startsWith('Format:')) {
        const fields = line.substring(7).split(',').map((f) => f.trim().toLowerCase());
        formatIndexMap = {
          start: fields.indexOf('start'),
          end: fields.indexOf('end'),
          text: fields.indexOf('text'),
        };
      }

      if (line.startsWith('Dialogue:')) {
        const valueStr = line.substring(9).trim();
        let parts;

        if (formatIndexMap && formatIndexMap.text !== -1) {
          const splitLimit = formatIndexMap.text;
          const temp = valueStr.split(',');
          const prefix = temp.slice(0, splitLimit);
          const textPart = temp.slice(splitLimit).join(',');
          parts = [...prefix, textPart];
        } else {
          const temp = valueStr.split(',');
          parts = [...temp.slice(0, 9), temp.slice(9).join(',')];
        }

        const startIdx = formatIndexMap ? formatIndexMap.start : 1;
        const endIdx = formatIndexMap ? formatIndexMap.end : 2;
        const textIdx = formatIndexMap ? formatIndexMap.text : 9;

        if (parts.length > Math.max(startIdx, endIdx, textIdx)) {
          const start = parseTimeToSeconds(parts[startIdx]);
          const end = parseTimeToSeconds(parts[endIdx]);
          const cleanText = parts[textIdx]
            .replace(/\{[^}]+\}/g, '')
            .replace(/\\N/gi, '\n')
            .replace(/\\n/gi, '\n')
            .replace(/\\h/gi, ' ')
            .trim();

          if (cleanText) {
            parsedCues.push({ start, end, text: cleanText });
          }
        }
      }
    }
    return parsedCues;
  };

  const parseSrtOrVtt = (text) => {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = normalized.split('\n\n');
    const parsedCues = [];
    const timeRegex = /((?:\d{2}:)?\d{2}:\d{2}[,.]\d{2,3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}[,.]\d{2,3})/;

    blocks.forEach((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(timeRegex);
        if (match) {
          const start = parseTimeToSeconds(match[1]);
          const end = parseTimeToSeconds(match[2]);
          const content = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').trim();
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
      const lowerName = file.name.toLowerCase();
      let parsed = [];

      if (lowerName.endsWith('.ass') || lowerName.endsWith('.ssa')) {
        parsed = parseAssSubtitle(content);
      } else {
        parsed = parseSrtOrVtt(content);
      }

      parsed.sort((a, b) => a.start - b.start);
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

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || cues.length === 0) {
      setActiveSubtitle('');
      return;
    }
    const curr = video.currentTime;
    const matchingCues = cues.filter((c) => curr >= c.start && curr <= c.end);
    if (matchingCues.length > 0) {
      setActiveSubtitle(matchingCues.map((c) => c.text).join('\n'));
    } else {
      setActiveSubtitle('');
    }
  };

  useEffect(() => {
    return () => {
      if (hlsRef.current) hlsRef.current.destroy();
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  return (
    <div style={{ padding: 15, maxWidth: 900, margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h2>Trình phát M3U8 (Responsive Subtitle)</h2>

      <textarea
        rows={6}
        style={{
          width: '100%',
          backgroundColor: '#1e293b',
          color: '#e2e8f0',
          borderRadius: 6,
          padding: 10,
          boxSizing: 'border-box',
          border: '1px solid #334155',
          fontFamily: 'monospace',
          fontSize: 12,
        }}
        placeholder="Dán toàn bộ nội dung #EXTM3U vào đây..."
        value={m3u8Content}
        onChange={(e) => setM3u8Content(e.target.value)}
      />

      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          onClick={handlePlayStream}
          style={{
            padding: '8px 20px',
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
            padding: '8px 14px',
            background: '#334155',
            color: '#f8fafc',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
            border: '1px solid #475569',
          }}
        >
          Chọn tệp phụ đề (.ass, .srt, .vtt)
          <input
            type="file"
            accept=".ass,.ssa,.srt,.vtt"
            style={{ display: 'none' }}
            onChange={handleSubtitleFile}
          />
        </label>

        {subName && (
          <span style={{ fontSize: 12, color: cues.length > 0 ? '#38bdf8' : '#ef4444' }}>
            Đã nạp: {subName} ({cues.length} câu)
          </span>
        )}
      </div>

      {errorMsg && (
        <div style={{ color: '#ef4444', marginTop: 10, fontSize: 13 }}>{errorMsg}</div>
      )}

      {/* Khung video cố định chuẩn tỷ lệ và bọc gọn lớp phụ đề bên trong */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 9',
          background: '#000',
          borderRadius: 8,
          overflow: 'hidden',
          marginTop: 15,
        }}
      >
        <video
          ref={videoRef}
          controls
          playsInline
          onTimeUpdate={handleTimeUpdate}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
        />

        {activeSubtitle && (
          <div
            style={{
              position: 'absolute',
              bottom: '12%',
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
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: 'clamp(14px, 2.5vw, 22px)',
                fontWeight: '600',
                lineHeight: '1.4',
                whiteSpace: 'pre-line',
                textShadow: '0 0 3px #000, 1px 1px 3px #000',
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
