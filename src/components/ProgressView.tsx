import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Cookie,
  Film,
  Loader2,
  Play,
  RefreshCw,
} from 'lucide-react';
import { saveYoutubeCookiesApi } from '../lib/api';
import type { JobRecord } from '../shared/types';

interface ProgressViewProps {
  job: JobRecord;
  onBackToStudio: () => void;
  onRetryUrl?: (url: string) => Promise<void>;
  onUploadFileInstead?: (file: File) => Promise<void>;
  onRunSampleInstead: () => void;
  onCookiesUpdated?: () => void;
}

export function ProgressView({
  job,
  onBackToStudio,
  onRetryUrl,
  onUploadFileInstead,
  onRunSampleInstead,
  onCookiesUpdated,
}: ProgressViewProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [cookieStatus, setCookieStatus] = useState('');
  const [cookieError, setCookieError] = useState('');
  const [savingCookies, setSavingCookies] = useState(false);

  const cookiesInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const startMs = new Date(job.createdAt).getTime();
    const update = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    };
    update();
    if (job.status === 'completed' || job.status === 'error') return;
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [job.createdAt, job.status]);

  async function handleCookiesFile(file?: File) {
    if (!file) return;
    setSavingCookies(true);
    setCookieError('');
    setCookieStatus('');
    try {
      const text = await file.text();
      await saveYoutubeCookiesApi(text);
      onCookiesUpdated?.();
      setCookieStatus('Cookies saved. Retrying download...');
      if (job.sourceUrl && onRetryUrl) {
        await onRetryUrl(job.sourceUrl);
      }
    } catch (err) {
      setCookieError(
        err instanceof Error ? err.message : 'Failed to save cookies.txt.'
      );
    } finally {
      setSavingCookies(false);
    }
  }

  const activeStep = job.steps.find((s) => s.status === 'active');
  const needsCookiesOption =
    job.status === 'error' &&
    Boolean(job.sourceUrl) &&
    (job.errorCode === 'BOT_CHECK' ||
      job.errorCode === 'PRIVATE_VIDEO' ||
      job.errorCode === 'DOWNLOAD_BLOCKED');

  return (
    <main className="mx-auto max-w-[920px] px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <button
        type="button"
        onClick={onBackToStudio}
        className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-[#9CA3AF] hover:text-[#F4F4F5] transition-colors"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        <span>Back to Studio</span>
      </button>

      <div className="rounded-xl border border-white/[0.08] bg-[#14161B] p-5 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/[0.08] pb-6">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-bold text-[#F4F4F5] sm:text-3xl">
              {job.status === 'error'
                ? 'Processing paused with an issue'
                : 'Building your vertical reels'}
            </h1>
            <p className="mt-1.5 truncate text-sm text-[#9CA3AF]">
              {job.sourceLabel}
            </p>
          </div>
          <div className="text-right font-mono text-sm tabular-nums text-[#D1D5DB]">
            <div className="text-2xl font-semibold text-[#F5B700]">
              {job.progress}%
            </div>
            <div className="text-xs text-[#9CA3AF]">
              Elapsed {Math.floor(elapsedSeconds / 60)}:
              {String(elapsedSeconds % 60).padStart(2, '0')}
            </div>
          </div>
        </div>

        {/* Linear progress track */}
        <div
          className="mt-6 h-2 w-full overflow-hidden rounded-full bg-white/[0.08]"
          role="progressbar"
          aria-valuenow={job.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Reel processing progress"
        >
          <div
            className={`h-full transition-all duration-300 ${
              job.status === 'error' ? 'bg-[#EF4444]' : 'bg-[#F5B700]'
            }`}
            style={{ width: `${Math.max(4, job.progress)}%` }}
          />
        </div>

        {/* Error Recovery Panel placed prominently above pending steps */}
        {job.status === 'error' ? (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-[#EF4444]/40 bg-[#EF4444]/10 p-5"
          >
            <div className="flex items-start gap-3">
              <AlertCircle
                className="mt-0.5 h-5 w-5 shrink-0 text-[#F87171]"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-[#FECACA]">
                  {job.errorMessage || 'Processing failed'}
                </h2>
                {job.errorHint ? (
                  <p className="mt-1.5 text-sm leading-relaxed text-[#E5E7EB]">
                    {job.errorHint}
                  </p>
                ) : null}

                {needsCookiesOption ? (
                  <p className="mt-2 text-xs text-[#D1D5DB]">
                    Tip: Export <code className="font-mono text-[#F5B700]">cookies.txt</code>{' '}
                    from a logged-in YouTube browser tab (using any Netscape cookies exporter extension) once—ReelMaker stores it server-side for future YouTube links.
                  </p>
                ) : null}

                <input
                  ref={cookiesInputRef}
                  type="file"
                  accept=".txt,text/plain"
                  className="hidden"
                  onChange={(e) => void handleCookiesFile(e.target.files?.[0])}
                />
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f && onUploadFileInstead) {
                      void onUploadFileInstead(f);
                    }
                  }}
                />

                <div className="mt-4 flex flex-wrap items-center gap-2.5">
                  {needsCookiesOption ? (
                    <button
                      type="button"
                      disabled={savingCookies}
                      onClick={() => cookiesInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#F5B700] px-4 py-2 text-xs font-bold text-[#0C0D10] hover:bg-[#FFC926] disabled:opacity-60 transition-colors whitespace-nowrap"
                    >
                      {savingCookies ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Cookie className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>Upload cookies.txt &amp; Retry</span>
                    </button>
                  ) : job.sourceUrl && onRetryUrl ? (
                    <button
                      type="button"
                      onClick={() => void onRetryUrl(job.sourceUrl!)}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#F5B700] px-4 py-2 text-xs font-bold text-[#0C0D10] hover:bg-[#FFC926] transition-colors whitespace-nowrap"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Retry URL</span>
                    </button>
                  ) : null}

                  {onUploadFileInstead ? (
                    <button
                      type="button"
                      onClick={() => videoInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-lg border border-white/[0.16] bg-[#14161B] px-4 py-2 text-xs font-semibold text-[#F4F4F5] hover:border-white/35 transition-colors whitespace-nowrap"
                    >
                      <Film className="h-3.5 w-3.5 text-[#9CA3AF]" aria-hidden="true" />
                      <span>Upload MP4 Instead</span>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={onRunSampleInstead}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/[0.16] bg-[#14161B] px-4 py-2 text-xs font-semibold text-[#F4F4F5] hover:border-[#F5B700] transition-colors whitespace-nowrap"
                  >
                    <Play className="h-3.5 w-3.5 text-[#F5B700]" aria-hidden="true" />
                    <span>Run Sample Video</span>
                  </button>
                </div>

                {cookieStatus ? (
                  <p className="mt-2.5 text-xs font-medium text-[#4ADE80]">
                    {cookieStatus}
                  </p>
                ) : null}
                {cookieError ? (
                  <p className="mt-2.5 text-xs font-medium text-[#FCA5A5]">
                    {cookieError}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* Step-by-step pipeline rail */}
        <ol className="mt-7 space-y-3.5">
          {job.steps.map((step, index) => {
            const isCompleted = step.status === 'completed';
            const isActive = step.status === 'active';
            const isError = step.status === 'error';

            return (
              <li
                key={step.id}
                className={`flex items-start gap-4 rounded-lg border px-4 py-3.5 transition-colors ${
                  isError
                    ? 'border-[#EF4444]/40 bg-[#EF4444]/10'
                    : isActive
                    ? 'border-[#F5B700]/40 bg-[#F5B700]/[0.06]'
                    : 'border-white/[0.06] bg-[#0C0D10]/50'
                }`}
              >
                <div
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold tabular-nums ${
                    isError
                      ? 'bg-[#EF4444] text-white'
                      : isCompleted
                      ? 'bg-[#16A34A] text-white'
                      : isActive
                      ? 'bg-[#F5B700] text-[#0C0D10]'
                      : 'bg-white/[0.08] text-[#9CA3AF]'
                  }`}
                >
                  {isError ? (
                    <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : isCompleted ? (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : isActive ? (
                    <Loader2
                      className="h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    index + 1
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`text-sm font-semibold ${
                        isError
                          ? 'text-[#FCA5A5]'
                          : isCompleted || isActive
                          ? 'text-[#F4F4F5]'
                          : 'text-[#6B7280]'
                      }`}
                    >
                      {step.label}
                    </span>
                    <span className="font-mono text-xs text-[#9CA3AF]">
                      {isError
                        ? 'Failed'
                        : isCompleted
                        ? 'Complete'
                        : isActive
                        ? 'Running'
                        : 'Waiting'}
                    </span>
                  </div>
                  {step.detail ? (
                    <p className="mt-1 text-xs text-[#9CA3AF]">
                      {step.detail}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        {/* Active configuration summary */}
        <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/[0.08] pt-5 text-xs text-[#9CA3AF]">
          <span>Clips: {job.settings.clipCount}</span>
          <span aria-hidden="true">·</span>
          <span>Length: {job.settings.clipLength}s</span>
          <span aria-hidden="true">·</span>
          <span className="capitalize">Focus: {job.settings.styleFocus}</span>
          <span aria-hidden="true">·</span>
          <span>Layout: {job.settings.layout}</span>
          <span aria-hidden="true">·</span>
          <span>Template: {job.settings.templateId}</span>
        </div>

        {activeStep && job.status !== 'error' ? (
          <p className="mt-4 text-xs text-[#9CA3AF]">
            Processing runs in a server background queue so long videos never time out.
          </p>
        ) : null}
      </div>
    </main>
  );
}
