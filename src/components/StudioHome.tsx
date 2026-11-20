import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import {
  Check,
  Film,
  Link2,
  Play,
  Upload,
} from 'lucide-react';
import { CAPTION_TEMPLATES } from '../shared/captionEngine';
import type {
  ClipCountOption,
  ClipLengthOption,
  ClipSettings,
  LayoutMode,
  StyleFocusOption,
} from '../shared/types';
import { clearYoutubeCookiesApi, saveYoutubeCookiesApi } from '../lib/api';
import { CaptionPreviewRenderer } from './CaptionPreviewRenderer';

interface StudioHomeProps {
  settings: ClipSettings;
  onChangeSettings: (next: ClipSettings) => void;
  onSubmitUrl: (url: string) => Promise<void>;
  onSubmitFile: (file: File) => Promise<void>;
  onRunSample: () => Promise<void>;
  submitting: boolean;
  serverTools?: {
    ffmpeg: boolean;
    ffprobe: boolean;
    ytDlp: boolean;
    youtubeCookies: boolean;
  };
  onRefreshHealth?: () => void;
}

const CLIP_COUNT_OPTIONS: Array<{ value: ClipCountOption; label: string }> = [
  { value: '3', label: '3 Clips' },
  { value: '5', label: '5 Clips' },
  { value: '10', label: '10 Clips' },
  { value: 'auto', label: 'Auto' },
];

const CLIP_LENGTH_OPTIONS: Array<{ value: ClipLengthOption; label: string }> = [
  { value: '15-30', label: '15–30s' },
  { value: '30-60', label: '30–60s' },
  { value: '60-90', label: '60–90s' },
];

const STYLE_FOCUS_OPTIONS: Array<{ value: StyleFocusOption; label: string }> = [
  { value: 'funny', label: 'Funny' },
  { value: 'hype', label: 'Hype' },
  { value: 'shocking', label: 'Shocking' },
  { value: 'wholesome', label: 'Wholesome' },
  { value: 'mixed', label: 'Mixed' },
];

const LAYOUT_OPTIONS: Array<{
  value: LayoutMode;
  label: string;
  hint: string;
}> = [
  { value: 'fill', label: 'Fill 9:16', hint: 'Edge-to-edge smart crop' },
  {
    value: 'fit-blur',
    label: 'Fit Blurred BG',
    hint: 'Full frame over soft blur',
  },
  {
    value: 'split-screen',
    label: 'Split Screen',
    hint: 'Dual top/bottom framing',
  },
];

export function StudioHome({
  settings,
  onChangeSettings,
  onSubmitUrl,
  onSubmitFile,
  onRunSample,
  submitting,
  serverTools,
  onRefreshHealth,
}: StudioHomeProps) {
  const [urlInput, setUrlInput] = useState('');
  const [validationError, setValidationError] = useState('');
  const [cookieNotice, setCookieNotice] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cookiesInputRef = useRef<HTMLInputElement | null>(null);

  async function handleCookiesUpload(file?: File) {
    if (!file) return;
    setValidationError('');
    try {
      const text = await file.text();
      await saveYoutubeCookiesApi(text);
      setCookieNotice('YouTube cookies.txt saved for server downloads.');
      onRefreshHealth?.();
    } catch (err) {
      setValidationError(
        err instanceof Error ? err.message : 'Could not save cookies.txt.'
      );
    }
  }

  async function handleClearCookies() {
    await clearYoutubeCookiesApi().catch(() => {});
    setCookieNotice('');
    onRefreshHealth?.();
  }

  async function handleUrlSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setValidationError(
        'Paste a YouTube link, Twitch VOD, or direct .mp4 URL before generating.'
      );
      return;
    }
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Protocol');
      }
    } catch {
      setValidationError(
        'Enter a full URL starting with https:// (for example, a YouTube or .mp4 link).'
      );
      return;
    }

    setValidationError('');
    await onSubmitUrl(trimmed);
  }

  function handleSelectedFile(file?: File) {
    if (!file) return;
    if (
      !file.type.startsWith('video/') &&
      !/\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name)
    ) {
      setValidationError(
        'Unsupported file type. Upload an MP4, MOV, WebM, or MKV video.'
      );
      return;
    }
    setValidationError('');
    void onSubmitFile(file);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    handleSelectedFile(file);
  }

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      {/* Focal Hero + Video Source Input */}
      <section className="mx-auto max-w-[960px]">
        <h1 className="font-display text-3xl font-bold tracking-tight text-[#F4F4F5] sm:text-5xl">
          Turn long videos into short vertical reels
        </h1>
        <p className="mt-3 max-w-2xl text-base text-[#9CA3AF]">
          Paste a YouTube link, Twitch VOD, direct video URL, or upload a file
          under 2 hours. ReelMaker scores punchlines, laughter spikes, and
          reactions, cuts 9:16 clips, and burns animated captions automatically.
        </p>

        {/* Primary URL Input Form */}
        <form onSubmit={handleUrlSubmit} className="mt-7" noValidate>
          <label htmlFor="video-url-input" className="sr-only">
            Video URL (YouTube, Twitch VOD, or direct MP4 link)
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Link2
                className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#6B7280]"
                aria-hidden="true"
              />
              <input
                id="video-url-input"
                type="url"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  if (validationError) setValidationError('');
                }}
                placeholder="Paste YouTube, Twitch VOD, or direct .mp4 URL..."
                className="h-13 w-full rounded-xl border border-white/[0.14] bg-[#14161B] pl-12 pr-4 text-base text-[#F4F4F5] placeholder:text-[#6B7280] focus:border-[#F5B700] focus:outline-none transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="h-13 rounded-xl bg-[#F5B700] px-7 text-sm font-bold text-[#0C0D10] hover:bg-[#FFC926] disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B700] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0C0D10]"
            >
              {submitting ? 'Starting...' : 'Generate Reels'}
            </button>
          </div>

          {validationError ? (
            <p
              role="alert"
              className="mt-2.5 text-sm font-medium text-[#F87171]"
            >
              {validationError}
            </p>
          ) : null}
        </form>

        {/* Upload Dropzone + Instant Sample Video Strip */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`mt-4 flex flex-col items-start justify-between gap-4 rounded-xl border border-dashed px-5 py-4 sm:flex-row sm:items-center transition-colors ${
            isDragging
              ? 'border-[#F5B700] bg-[#F5B700]/[0.06]'
              : 'border-white/[0.12] bg-[#14161B]/60'
          }`}
        >
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-[#D1D5DB]">
              <Upload className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#F4F4F5]">
                Or drop a video file here
              </p>
              <p className="text-xs text-[#9CA3AF]">
                MP4, MOV, WebM up to 2 hours · Auto-deleted after 7 days ·{' '}
                {serverTools?.youtubeCookies ? (
                  <>
                    <span className="text-[#4ADE80]">YouTube cookies active</span>{' '}
                    (
                    <button
                      type="button"
                      onClick={() => void handleClearCookies()}
                      className="underline hover:text-[#F4F4F5]"
                    >
                      remove
                    </button>
                    )
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => cookiesInputRef.current?.click()}
                    className="underline hover:text-[#F5B700]"
                  >
                    Add YouTube cookies.txt
                  </button>
                )}
              </p>
              {cookieNotice ? (
                <p className="mt-1 text-xs text-[#4ADE80]">{cookieNotice}</p>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <input
              ref={cookiesInputRef}
              type="file"
              accept=".txt,text/plain"
              className="hidden"
              onChange={(e) => void handleCookiesUpload(e.target.files?.[0])}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv"
              className="hidden"
              onChange={(e) => handleSelectedFile(e.target.files?.[0])}
            />
            <button
              type="button"
              disabled={submitting}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-white/[0.14] bg-[#1B1E25] px-4 py-2 text-xs font-semibold text-[#F4F4F5] hover:border-white/30 transition-colors whitespace-nowrap shrink-0"
            >
              <Film className="h-3.5 w-3.5 text-[#9CA3AF]" aria-hidden="true" />
              <span>Upload File</span>
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={() => void onRunSample()}
              className="inline-flex items-center gap-2 rounded-lg border border-[#F5B700]/35 bg-[#F5B700]/10 px-4 py-2 text-xs font-semibold text-[#F5B700] hover:bg-[#F5B700]/20 transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Try Sample Video</span>
            </button>
          </div>
        </div>
      </section>

      {/* Processing Settings */}
      <section
        aria-labelledby="settings-heading"
        className="mt-12 border-t border-white/[0.08] pt-10"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="settings-heading"
            className="font-display text-xl font-semibold text-[#F4F4F5]"
          >
            Clip Settings
          </h2>
          <p className="text-xs text-[#9CA3AF]">
            Configure clip count, pacing window, focus style, and 9:16 framing
            before processing.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Number of Clips */}
          <div>
            <span className="mb-2 block text-xs font-medium text-[#9CA3AF]">
              Number of clips
            </span>
            <div
              role="group"
              aria-label="Number of clips"
              className="grid grid-cols-4 gap-1.5 rounded-lg border border-white/[0.07] bg-[#14161B] p-1"
            >
              {CLIP_COUNT_OPTIONS.map((opt) => {
                const active = settings.clipCount === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      onChangeSettings({ ...settings, clipCount: opt.value })
                    }
                    className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#F5B700] text-[#0C0D10]'
                        : 'text-[#D1D5DB] hover:bg-white/[0.06]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Clip Length */}
          <div>
            <span className="mb-2 block text-xs font-medium text-[#9CA3AF]">
              Clip length
            </span>
            <div
              role="group"
              aria-label="Clip length"
              className="grid grid-cols-3 gap-1.5 rounded-lg border border-white/[0.07] bg-[#14161B] p-1"
            >
              {CLIP_LENGTH_OPTIONS.map((opt) => {
                const active = settings.clipLength === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      onChangeSettings({ ...settings, clipLength: opt.value })
                    }
                    className={`rounded-md px-2 py-2 font-mono text-xs font-semibold tabular-nums transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#F5B700] text-[#0C0D10]'
                        : 'text-[#D1D5DB] hover:bg-white/[0.06]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Style Focus */}
          <div>
            <span className="mb-2 block text-xs font-medium text-[#9CA3AF]">
              Style focus
            </span>
            <div
              role="group"
              aria-label="Style focus"
              className="grid grid-cols-5 gap-1.5 rounded-lg border border-white/[0.07] bg-[#14161B] p-1"
            >
              {STYLE_FOCUS_OPTIONS.map((opt) => {
                const active = settings.styleFocus === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      onChangeSettings({ ...settings, styleFocus: opt.value })
                    }
                    className={`rounded-md px-2 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#F5B700] text-[#0C0D10]'
                        : 'text-[#D1D5DB] hover:bg-white/[0.06]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 9:16 Layout + Captions Toggle */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-[#9CA3AF]">
                9:16 Layout
              </span>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[#D1D5DB]">
                <input
                  type="checkbox"
                  checked={settings.includeCaptions}
                  onChange={(e) =>
                    onChangeSettings({
                      ...settings,
                      includeCaptions: e.target.checked,
                    })
                  }
                  className="h-3.5 w-3.5 rounded accent-[#F5B700]"
                />
                <span>Burn captions</span>
              </label>
            </div>
            <div
              role="group"
              aria-label="9:16 Layout"
              className="grid grid-cols-3 gap-1.5 rounded-lg border border-white/[0.07] bg-[#14161B] p-1"
            >
              {LAYOUT_OPTIONS.map((opt) => {
                const active = settings.layout === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    title={opt.hint}
                    aria-pressed={active}
                    onClick={() =>
                      onChangeSettings({ ...settings, layout: opt.value })
                    }
                    className={`rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#F5B700] text-[#0C0D10]'
                        : 'text-[#D1D5DB] hover:bg-white/[0.06]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Caption Template Gallery (8 JSON Templates with Live Animated Previews) */}
      <section
        aria-labelledby="templates-heading"
        className="mt-12 border-t border-white/[0.08] pt-10"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="templates-heading"
            className="font-display text-xl font-semibold text-[#F4F4F5]"
          >
            Caption Templates
          </h2>
          <p className="text-xs text-[#9CA3AF]">
            8 JSON-defined styles with automatic keyword highlighting · Live
            preview
          </p>
        </div>

        <div
          role="radiogroup"
          aria-label="Caption template gallery"
          className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {CAPTION_TEMPLATES.map((tpl) => {
            const selected = settings.templateId === tpl.id;
            return (
              <button
                key={tpl.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() =>
                  onChangeSettings({ ...settings, templateId: tpl.id })
                }
                className={`group flex flex-col overflow-hidden rounded-xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5B700] ${
                  selected
                    ? 'border-[#F5B700] bg-[#181B22]'
                    : 'border-white/[0.08] bg-[#14161B] hover:border-white/25'
                }`}
              >
                {/* Live Animated 16:10 Mini Stage Preview */}
                <div className="relative h-36 w-full overflow-hidden bg-gradient-to-b from-[#1E2330] via-[#13161E] to-[#0B0C10]">
                  <div
                    aria-hidden="true"
                    className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(245,183,0,0.12),transparent_60%)]"
                  />
                  <CaptionPreviewRenderer template={tpl} compact />
                  {selected ? (
                    <span
                      aria-hidden="true"
                      className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#F5B700] text-[#0C0D10]"
                    >
                      <Check className="h-3.5 w-3.5 stroke-[3]" />
                    </span>
                  ) : null}
                </div>

                {/* Template Metadata (Zero-pill discipline) */}
                <div className="flex flex-1 flex-col justify-between p-4">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-sm font-semibold text-[#F4F4F5]">
                        {tpl.name}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-[#9CA3AF]">
                        {tpl.wordsPerLine}w/line
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-[#9CA3AF]">
                      {tpl.description}
                    </p>
                  </div>

                  <div className="mt-3 flex items-center gap-2 text-[11px] text-[#6B7280]">
                    <span>{tpl.font}</span>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize">{tpl.position}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}
