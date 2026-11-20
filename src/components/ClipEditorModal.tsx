import { useMemo, useRef, useState } from 'react';
import {
  Download,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { regenerateClip, withPasscodeUrl } from '../lib/api';
import {
  CAPTION_TEMPLATES,
  getEmojiForWord,
  getTemplateById,
  isKeywordWord,
} from '../shared/captionEngine';
import { formatTimecode } from '../shared/momentScoring';
import type {
  CaptionCustomization,
  CaptionPosition,
  ClipItem,
  LayoutMode,
  TranscriptWord,
} from '../shared/types';
import { CaptionPreviewRenderer } from './CaptionPreviewRenderer';

interface ClipEditorModalProps {
  jobId: string;
  videoDuration: number;
  clip: ClipItem;
  onClose: () => void;
  onClipUpdated: (updated: ClipItem) => void;
}

function redistributeWords(
  text: string,
  start: number,
  end: number,
  originalWords: TranscriptWord[]
): TranscriptWord[] {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return [];

  const duration = Math.max(0.5, end - start);
  const totalChars = tokens.reduce((sum, t) => sum + Math.max(2, t.length), 0);
  let cursor = start;

  return tokens.map((word, idx) => {
    const speaker =
      originalWords[Math.min(idx, Math.max(0, originalWords.length - 1))]
        ?.speaker ?? 'Host';
    const weight = Math.max(2, word.length) / totalChars;
    const wStart = cursor;
    const wEnd =
      idx === tokens.length - 1
        ? end
        : Math.min(end, cursor + Math.max(0.08, duration * weight));
    cursor = wEnd;
    return {
      word,
      start: Number(wStart.toFixed(2)),
      end: Number(wEnd.toFixed(2)),
      speaker,
      isKeyword: isKeywordWord(word),
      emoji: getEmojiForWord(word),
    };
  });
}

export function ClipEditorModal({
  jobId,
  videoDuration,
  clip,
  onClose,
  onClipUpdated,
}: ClipEditorModalProps) {
  const [start, setStart] = useState(clip.start);
  const [end, setEnd] = useState(clip.end);
  const [hookTitle, setHookTitle] = useState(clip.hookTitle);
  const [showHookTitle, setShowHookTitle] = useState(clip.showHookTitle);
  const [layout, setLayout] = useState<LayoutMode>(clip.layout);
  const [includeCaptions, setIncludeCaptions] = useState(true);
  const [captions, setCaptions] = useState<CaptionCustomization>({
    ...clip.captions,
  });
  const [captionText, setCaptionText] = useState(
    clip.words.map((w) => w.word).join(' ')
  );
  const [liveOverlay, setLiveOverlay] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const activeTemplate = useMemo(
    () => getTemplateById(captions.templateId),
    [captions.templateId]
  );

  const previewWords = useMemo(
    () => redistributeWords(captionText, start, end, clip.words),
    [captionText, start, end, clip.words]
  );

  function handleSelectTemplate(templateId: string) {
    const tpl = getTemplateById(templateId);
    setCaptions({
      templateId: tpl.id,
      font: tpl.font,
      fontSize: tpl.fontSize,
      primaryColor: tpl.primaryColor,
      accentColor: tpl.accentColor,
      outlineColor: tpl.outlineColor,
      boxColor: tpl.boxColor,
      position: tpl.position,
      animation: tpl.animation,
      wordsPerLine: tpl.wordsPerLine,
      uppercase: tpl.uppercase,
      showEmoji: tpl.showEmoji,
    });
  }

  async function handleRegenerate() {
    if (end - start < 2) {
      setErrorMessage('Clip duration must be at least 2 seconds.');
      return;
    }

    setRendering(true);
    setErrorMessage('');
    setStatusMessage('Re-cutting video and burning updated ASS captions...');

    try {
      const updated = await regenerateClip(jobId, clip.id, {
        start,
        end,
        hookTitle: hookTitle.trim(),
        showHookTitle,
        layout,
        captions,
        words: previewWords,
        includeCaptions,
      });
      onClipUpdated(updated);
      setStatusMessage('Clip re-rendered and ready to download.');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to regenerate clip.'
      );
      setStatusMessage('');
    } finally {
      setRendering(false);
    }
  }

  const streamUrl = withPasscodeUrl(clip.videoUrl);
  const downloadUrl = withPasscodeUrl(clip.downloadUrl);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="clip-editor-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6 backdrop-blur-xs"
    >
      <div className="flex max-h-[94vh] w-full max-w-[1160px] flex-col overflow-hidden rounded-xl border border-white/[0.12] bg-[#14161B]">
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-4 border-b border-white/[0.08] px-5 py-4">
          <div className="min-w-0">
            <h2
              id="clip-editor-title"
              className="font-display text-lg font-bold text-[#F4F4F5] truncate"
            >
              Edit Clip {String(clip.index).padStart(2, '0')} · {clip.score}/100
            </h2>
            <p className="text-xs text-[#9CA3AF] truncate">{clip.reason}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close clip editor"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.1] text-[#9CA3AF] hover:text-[#F4F4F5] hover:border-white/25 transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Split Workspace */}
        <div className="grid flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-12">
          {/* Left: 9:16 Live Preview */}
          <div className="flex flex-col items-center justify-start border-b border-white/[0.08] bg-[#0C0D10] p-5 lg:col-span-5 lg:border-b-0 lg:border-r">
            <div className="mb-3 flex w-full max-w-[300px] items-center justify-between text-xs text-[#9CA3AF]">
              <span className="font-mono tabular-nums">
                9:16 Preview · {(end - start).toFixed(1)}s
              </span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[#D1D5DB]">
                <input
                  type="checkbox"
                  checked={liveOverlay}
                  onChange={(e) => setLiveOverlay(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#F5B700]"
                />
                <span>Live style overlay</span>
              </label>
            </div>

            <div className="relative aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-xl border border-white/[0.12] bg-black">
              <video
                ref={videoRef}
                key={`${clip.id}-edit-v${clip.renderVersion}`}
                src={streamUrl}
                controls
                playsInline
                onTimeUpdate={(e) =>
                  setCurrentTime(e.currentTarget.currentTime)
                }
                className="h-full w-full object-contain bg-black"
              />
              {liveOverlay && includeCaptions ? (
                <CaptionPreviewRenderer
                  template={activeTemplate}
                  customization={captions}
                  words={previewWords}
                  clipStart={start}
                  clipEnd={end}
                  currentTime={currentTime}
                  hookTitle={hookTitle}
                  showHookTitle={showHookTitle}
                />
              ) : null}
            </div>

            <div className="mt-4 flex w-full max-w-[300px] items-center gap-2.5">
              <button
                type="button"
                disabled={rendering}
                onClick={() => void handleRegenerate()}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#F5B700] px-4 py-2.5 text-xs font-bold text-[#0C0D10] hover:bg-[#FFC926] disabled:opacity-60 transition-colors whitespace-nowrap"
              >
                {rendering ? (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                )}
                <span>{rendering ? 'Rendering...' : 'Regenerate Clip'}</span>
              </button>

              <a
                href={downloadUrl}
                download
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/[0.14] bg-[#1B1E25] px-3.5 py-2.5 text-xs font-semibold text-[#F4F4F5] hover:border-white/30 transition-colors whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>MP4</span>
              </a>
            </div>

            {statusMessage ? (
              <p className="mt-3 text-center text-xs font-medium text-[#4ADE80]">
                {statusMessage}
              </p>
            ) : null}
            {errorMessage ? (
              <p
                role="alert"
                className="mt-3 text-center text-xs font-medium text-[#F87171]"
              >
                {errorMessage}
              </p>
            ) : null}
          </div>

          {/* Right: Editing Controls */}
          <div className="space-y-6 p-5 sm:p-6 lg:col-span-7">
            {/* 1. Trim Start / End */}
            <div>
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-[#F4F4F5]">
                  Trim Range
                </h3>
                <span className="font-mono text-xs tabular-nums text-[#9CA3AF]">
                  {formatTimecode(start)} → {formatTimecode(end)} (
                  {(end - start).toFixed(1)}s)
                </span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="trim-start"
                    className="mb-1 flex justify-between text-xs text-[#9CA3AF]"
                  >
                    <span>Start (sec)</span>
                    <span className="font-mono tabular-nums text-[#F4F4F5]">
                      {start.toFixed(1)}s
                    </span>
                  </label>
                  <input
                    id="trim-start"
                    type="range"
                    min={0}
                    max={Math.max(0, end - 2)}
                    step={0.1}
                    value={start}
                    onChange={(e) => setStart(Number(e.target.value))}
                    className="w-full accent-[#F5B700]"
                  />
                </div>
                <div>
                  <label
                    htmlFor="trim-end"
                    className="mb-1 flex justify-between text-xs text-[#9CA3AF]"
                  >
                    <span>End (sec)</span>
                    <span className="font-mono tabular-nums text-[#F4F4F5]">
                      {end.toFixed(1)}s
                    </span>
                  </label>
                  <input
                    id="trim-end"
                    type="range"
                    min={Math.min(videoDuration, start + 2)}
                    max={Math.max(end, videoDuration)}
                    step={0.1}
                    value={end}
                    onChange={(e) => setEnd(Number(e.target.value))}
                    className="w-full accent-[#F5B700]"
                  />
                </div>
              </div>
            </div>

            {/* 2. Hook Title + 9:16 Layout */}
            <div className="grid grid-cols-1 gap-4 border-t border-white/[0.08] pt-5 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    htmlFor="hook-title-input"
                    className="text-xs font-medium text-[#D1D5DB]"
                  >
                    Hook title on top
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[#9CA3AF]">
                    <input
                      type="checkbox"
                      checked={showHookTitle}
                      onChange={(e) => setShowHookTitle(e.target.checked)}
                      className="h-3.5 w-3.5 accent-[#F5B700]"
                    />
                    <span>Show</span>
                  </label>
                </div>
                <input
                  id="hook-title-input"
                  type="text"
                  value={hookTitle}
                  onChange={(e) => setHookTitle(e.target.value)}
                  placeholder="Enter punchy top hook..."
                  className="w-full rounded-lg border border-white/[0.12] bg-[#0C0D10] px-3 py-2 text-sm text-[#F4F4F5] focus:border-[#F5B700] focus:outline-none"
                />
              </div>

              <div>
                <span className="mb-1.5 block text-xs font-medium text-[#D1D5DB]">
                  9:16 Layout
                </span>
                <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/[0.08] bg-[#0C0D10] p-1">
                  {(
                    [
                      { id: 'fill', label: 'Fill' },
                      { id: 'fit-blur', label: 'Fit Blur' },
                      { id: 'split-screen', label: 'Split' },
                    ] as Array<{ id: LayoutMode; label: string }>
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setLayout(item.id)}
                      className={`rounded-md py-1.5 text-xs font-semibold transition-colors ${
                        layout === item.id
                          ? 'bg-[#F5B700] text-[#0C0D10]'
                          : 'text-[#9CA3AF] hover:text-[#F4F4F5]'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 3. Caption Template & Options */}
            <div className="border-t border-white/[0.08] pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-sm font-semibold text-[#F4F4F5]">
                  Caption Style
                </h3>
                <div className="flex items-center gap-4 text-xs text-[#D1D5DB]">
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={Boolean(captions.showEmoji)}
                      onChange={(e) =>
                        setCaptions({ ...captions, showEmoji: e.target.checked })
                      }
                      className="h-3.5 w-3.5 accent-[#F5B700]"
                    />
                    <span>Auto-emoji</span>
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={includeCaptions}
                      onChange={(e) => setIncludeCaptions(e.target.checked)}
                      className="h-3.5 w-3.5 accent-[#F5B700]"
                    />
                    <span>Burn captions</span>
                  </label>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {CAPTION_TEMPLATES.map((tpl) => {
                  const active = captions.templateId === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => handleSelectTemplate(tpl.id)}
                      className={`rounded-lg border px-2.5 py-2 text-left text-xs font-semibold transition-colors truncate ${
                        active
                          ? 'border-[#F5B700] bg-[#F5B700]/15 text-[#F5B700]'
                          : 'border-white/[0.08] bg-[#0C0D10] text-[#D1D5DB] hover:border-white/25'
                      }`}
                    >
                      {tpl.name}
                    </button>
                  );
                })}
              </div>

              {/* Fine-tune controls: Position, Words per line, Size, Colors */}
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label
                    htmlFor="caption-position"
                    className="mb-1 block text-xs text-[#9CA3AF]"
                  >
                    Position
                  </label>
                  <select
                    id="caption-position"
                    value={captions.position ?? activeTemplate.position}
                    onChange={(e) =>
                      setCaptions({
                        ...captions,
                        position: e.target.value as CaptionPosition,
                      })
                    }
                    className="w-full rounded-lg border border-white/[0.12] bg-[#0C0D10] px-2.5 py-1.5 text-xs text-[#F4F4F5]"
                  >
                    <option value="top">Top</option>
                    <option value="middle">Middle</option>
                    <option value="bottom">Bottom</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="words-per-line"
                    className="mb-1 block text-xs text-[#9CA3AF]"
                  >
                    Words / line
                  </label>
                  <select
                    id="words-per-line"
                    value={captions.wordsPerLine ?? activeTemplate.wordsPerLine}
                    onChange={(e) =>
                      setCaptions({
                        ...captions,
                        wordsPerLine: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-white/[0.12] bg-[#0C0D10] px-2.5 py-1.5 font-mono text-xs text-[#F4F4F5]"
                  >
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n} words
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="caption-size"
                    className="mb-1 block text-xs text-[#9CA3AF]"
                  >
                    Size ({captions.fontSize ?? activeTemplate.fontSize}px)
                  </label>
                  <input
                    id="caption-size"
                    type="range"
                    min={36}
                    max={72}
                    step={2}
                    value={captions.fontSize ?? activeTemplate.fontSize}
                    onChange={(e) =>
                      setCaptions({
                        ...captions,
                        fontSize: Number(e.target.value),
                      })
                    }
                    className="mt-1.5 w-full accent-[#F5B700]"
                  />
                </div>

                <div className="flex items-end gap-3">
                  <label className="flex-1 text-xs text-[#9CA3AF]">
                    <span className="mb-1 block">Accent</span>
                    <input
                      type="color"
                      aria-label="Accent highlight color"
                      value={captions.accentColor ?? activeTemplate.accentColor}
                      onChange={(e) =>
                        setCaptions({ ...captions, accentColor: e.target.value })
                      }
                      className="h-8 w-full cursor-pointer rounded border border-white/[0.12] bg-[#0C0D10]"
                    />
                  </label>
                  <label className="flex-1 text-xs text-[#9CA3AF]">
                    <span className="mb-1 block">Text</span>
                    <input
                      type="color"
                      aria-label="Primary caption color"
                      value={
                        captions.primaryColor ?? activeTemplate.primaryColor
                      }
                      onChange={(e) =>
                        setCaptions({
                          ...captions,
                          primaryColor: e.target.value,
                        })
                      }
                      className="h-8 w-full cursor-pointer rounded border border-white/[0.12] bg-[#0C0D10]"
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* 4. Editable Caption Text */}
            <div className="border-t border-white/[0.08] pt-5">
              <label
                htmlFor="caption-text-editor"
                className="mb-1.5 block text-xs font-medium text-[#D1D5DB]"
              >
                Edit caption text (auto-syncs word timing on regenerate)
              </label>
              <textarea
                id="caption-text-editor"
                rows={4}
                value={captionText}
                onChange={(e) => setCaptionText(e.target.value)}
                className="w-full rounded-lg border border-white/[0.12] bg-[#0C0D10] p-3 text-sm leading-relaxed text-[#F4F4F5] focus:border-[#F5B700] focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
