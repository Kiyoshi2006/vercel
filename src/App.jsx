import React, { useState, useRef, useEffect } from 'react';
import Hls from 'hls.js';

export default function App() {
  const [videoUrl, setVideoUrl] = useState('');
  const [subUrl, setSubUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [cues, setCues] = useState([]);
  const [activeSubtitle, setActiveSubtitle] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hlsRef = useRef(null);

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

  // Tải nội dung phụ đề trực tiếp từ Link WebDAV (.ass / .srt / .vtt)
  const loadSubtitleFromUrl = async (url) => {
    if (!url.trim()) return;
    try {
      const res = await fetch(url.trim());
      const content = await res.text();
      const lower = url.toLowerCase();
      let parsed = [];

      if (lower.endsWith('.ass') || lower.endsWith('.ssa')) {
        parsed = parseAssSubtitle(content);
      } else {
        parsed = parseSrtOrVtt(content);
      }

      parsed.sort((a, b) => a.start - b.start);
      setCues(parsed);
    } catch (err) {
      console.error('Không tải được file phụ đề:', err);
    }
  };

  const handlePlayStream = async () => {
    setErrorMsg('');
    const vUrl = videoUrl.trim();
    if (!vUrl) {
      setErrorMsg('Vui lòng nhập link video từ WebDAV!');
      return;
    }

    // Nếu có nhập link phụ đề, tiến hành tải về đọc mốc thời gian
    if (subUrl.trim()) {
      await loadSubtitleFromUrl(subUrl);
    }

    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
    }

    // Kiểm tra xem link có phải định dạng HLS (.m3u8) hay video trực tiếp (.mkv, .mp4)
    if (vUrl.includes('.m3u8') && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
      hlsRef.current = hls;
      hls.loadSource(vUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setErrorMsg(`Lỗi HLS: ${data.details}`);
      });
    } else {
      // Phát trực tiếp các định dạng MP4, MKV từ link WebDAV (nếu trình duyệt hỗ trợ codec)
      video.src = vUrl;
      video.load();
      video.play().catch(() => {});
    }

    setIsLoaded(true);
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

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    const handleOrientationChange = () => {
      if (window.innerHeight < window.innerWidth) {
        if (!document.fullscreenElement && containerRef.current) {
          containerRef.current.requestFullscreen().catch(() => {});
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('resize', handleOrientationChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('resize', handleOrientationChange);
      if (hlsRef.current) hlsRef.current.destroy();
    };
  }, []);

  return (
    <div style={{ padding: 15, maxWidth: 900, margin: '0 auto', fontFamily: 'sans-serif', color: '#f8fafc' }}>
      <h2>Trình phát Video WebDAV (Hỗ trợ Link Trực tiếp)</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
        <div>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Link Video (.mkv, .mp4, .m3u8) từ WebDAV:</label>
          <input
            type="text"
            style={{
              width: '100%',
              backgroundColor: '#1e293b',
              color: '#e2e8f0',
              borderRadius: 6,
              padding: 10,
              boxSizing: 'border-box',
              border: '1px solid #334155',
              fontSize: 13,
            }}
            placeholder="Dán link sao chép từ WebDAV vào đây..."
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
          />
        </div>

        <div>
          <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>Link Phụ đề (.ass, .srt, .vtt) từ WebDAV (Tùy chọn):</label>
          <input
            type="text"
            style={{
              width: '100%',
              backgroundColor: '#1e293b',
              color: '#e2e8f0',
              borderRadius: 6,
              padding: 10,
              boxSizing: 'border-box',
              border: '1px solid #334155',
              fontSize: 13,
            }}
            placeholder="Dán link file .ass tương ứng vào đây..."
            value={subUrl}
            onChange={(e) => setSubUrl(e.target.value)}
          />
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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
          Phát Ngay
        </button>

        {subUrl && (
          <span style={{ fontSize: 12, color: cues.length > 0 ? '#38bdf8' : '#e2e8f0' }}>
            {cues.length > 0 ? `Đã nạp phụ đề (${cues.length} câu)` : 'Đang tải phụ đề...'}
          </span>
        )}
      </div>

      {errorMsg && (
        <div style={{ color: '#ef4444', marginTop: 10, fontSize: 13 }}>{errorMsg}</div>
      )}

      {/* Khung phát video hỗ trợ Double-tap Fullscreen & Subtitle Overlay */}
      <div
        ref={containerRef}
        onDoubleClick={toggleFullscreen}
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: isFullscreen ? 'auto' : '16 / 9',
          height: isFullscreen ? '100vh' : 'auto',
          background: '#000',
          borderRadius: isFullscreen ? 0 : 8,
          overflow: 'hidden',
          marginTop: 15,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
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
              bottom: isFullscreen ? '8%' : '12%',
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
                fontSize: isFullscreen ? 'clamp(18px, 3.5vw, 32px)' : 'clamp(14px, 2.5vw, 20px)',
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
