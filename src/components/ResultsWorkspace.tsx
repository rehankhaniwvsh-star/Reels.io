import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Download,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { getZipDownloadUrl, withPasscodeUrl } from '../lib/api';
import { getTemplateById } from '../shared/captionEngine';
import { formatTimecode } from '../shared/momentScoring';
import type { ClipItem, JobRecord } from '../shared/types';

interface ResultsWorkspaceProps {
  job: JobRecord;
  onEditClip: (clip: ClipItem) => void;
  onBackToStudio: () => void;
}

type ResultsTab = 'clips' | 'moments' | 'transcript';

export function ResultsWorkspace({
  job,
  onEditClip,
  onBackToStudio,
}: ResultsWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<ResultsTab>('clips');
  const [transcriptQuery, setTranscriptQuery] = useState('');

  const zipUrl = getZipDownloadUrl(job.id);

  const filteredTranscript = useMemo(() => {
    const q = transcriptQuery.trim().toLowerCase();
    if (!q) return job.transcript;
    return job.transcript.filter(
      (seg) =>
        seg.text.toLowerCase().includes(q) ||
        seg.speaker.toLowerCase().includes(q) ||
        (seg.audioTag && seg.audioTag.toLowerCase().includes(q))
    );
  }, [job.transcript, transcriptQuery]);

  function findClipForTime(time: number): ClipItem | undefined {
    return job.clips.find((c) => time >= c.start - 0.1 && time <= c.end + 0.1);
  }

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
      {/* Contextual Header */}
      <div className="flex flex-col justify-between gap-5 border-b border-white/[0.08] pb-6 md:flex-row md:items-end">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onBackToStudio}
            className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-[#9CA3AF] hover:text-[#F4F4F5] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>New Video</span>
          </button>
          <h1 className="font-display text-2xl font-bold text-[#F4F4F5] sm:text-3xl truncate">
            {job.sourceLabel}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[#9CA3AF] tabular-nums">
            <span>{job.clips.length} vertical clips ready</span>
            <span aria-hidden="true">·</span>
            <span>Source {formatTimecode(job.videoDuration)}</span>
            <span aria-hidden="true">·</span>
            <span>{job.audioSpikes.length} audio spikes detected</span>
            <span aria-hidden="true">·</span>
            <span>Auto-expires in 7 days</span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <a
            href={zipUrl}
            download
            className="inline-flex items-center gap-2 rounded-lg bg-[#F5B700] px-5 py-2.5 text-sm font-semibold text-[#0C0D10] hover:bg-[#FFC926] transition-colors whitespace-nowrap"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            <span>Download All (ZIP)</span>
          </a>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div
        role="tablist"
        aria-label="Job inspection views"
        className="mt-6 flex items-center gap-1 border-b border-white/[0.08]"
      >
        {(
          [
            { id: 'clips', label: `Clips (${job.clips.length})` },
            { id: 'moments', label: 'Moments & Signals' },
            {
              id: 'transcript',
              label: `Transcript (${job.transcript.length})`,
            },
          ] as Array<{ id: ResultsTab; label: string }>
        ).map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'text-[#F4F4F5]'
                  : 'text-[#9CA3AF] hover:text-[#F4F4F5]'
              }`}
            >
              {tab.label}
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-[2px] bg-[#F5B700]"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {/* TAB 1: CLIPS GRID */}
      {activeTab === 'clips' ? (
        <section aria-label="Generated vertical clips" className="mt-8">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {job.clips.map((clip) => {
              const tpl = getTemplateById(clip.captions.templateId);
              const streamSrc = withPasscodeUrl(clip.videoUrl);
              const downloadHref = withPasscodeUrl(clip.downloadUrl);

              return (
                <article
                  key={clip.id}
                  data-testid={`clip-card-${clip.index}`}
                  className="flex flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#14161B]"
                >
                  {/* 9:16 Vertical Video Player */}
                  <div className="relative aspect-[9/16] max-h-[500px] w-full bg-black">
                    <video
                      key={`${clip.id}-v${clip.renderVersion}`}
                      src={streamSrc}
                      controls
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-contain bg-black"
                    />
                  </div>

                  {/* Clean Metadata + Score + One-Line Reason */}
                  <div className="flex flex-1 flex-col justify-between p-5">
                    <div>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-mono text-xs tabular-nums text-[#9CA3AF]">
                          Clip {String(clip.index).padStart(2, '0')} ·{' '}
                          {formatTimecode(clip.start)}–{formatTimecode(clip.end)}{' '}
                          · {clip.duration.toFixed(1)}s
                        </span>
                        <span className="font-mono text-sm font-semibold tabular-nums text-[#F5B700]">
                          {clip.score}/100
                        </span>
                      </div>

                      <h2 className="mt-2 font-display text-lg font-semibold leading-snug text-[#F4F4F5]">
                        {clip.hookTitle}
                      </h2>

                      <p className="mt-1.5 text-sm leading-relaxed text-[#D1D5DB]">
                        {clip.reason}
                      </p>

                      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#9CA3AF]">
                        <span className="capitalize">{clip.styleTag}</span>
                        <span aria-hidden="true">·</span>
                        <span>{tpl.name}</span>
                        <span aria-hidden="true">·</span>
                        <span>{clip.layout}</span>
                      </div>
                    </div>

                    {/* Clip Actions */}
                    <div className="mt-5 flex items-center gap-2.5 border-t border-white/[0.08] pt-4">
                      <button
                        type="button"
                        onClick={() => onEditClip(clip)}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/[0.14] bg-[#1B1E25] px-4 py-2 text-xs font-semibold text-[#F4F4F5] hover:border-[#F5B700] transition-colors whitespace-nowrap"
                      >
                        <SlidersHorizontal
                          className="h-3.5 w-3.5 text-[#F5B700]"
                          aria-hidden="true"
                        />
                        <span>Edit Clip {clip.index}</span>
                      </button>

                      <a
                        href={downloadHref}
                        download
                        aria-label={`Download Clip ${clip.index} MP4`}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#F5B700] px-4 py-2 text-xs font-semibold text-[#0C0D10] hover:bg-[#FFC926] transition-colors whitespace-nowrap"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>MP4</span>
                      </a>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* TAB 2: MOMENTS & SIGNAL BREAKDOWN */}
      {activeTab === 'moments' ? (
        <section aria-label="Moment scoring breakdown" className="mt-8">
          <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#14161B]">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-white/[0.08] text-xs font-medium text-[#9CA3AF]">
                <tr>
                  <th className="px-4 py-3.5">Clip</th>
                  <th className="px-4 py-3.5">Hook & Reason</th>
                  <th className="px-4 py-3.5">Window</th>
                  <th className="px-4 py-3.5 text-right">LLM</th>
                  <th className="px-4 py-3.5 text-right">Audio</th>
                  <th className="px-4 py-3.5 text-right">Reaction</th>
                  <th className="px-4 py-3.5 text-right">Pacing</th>
                  <th className="px-4 py-3.5 text-right">Total</th>
                  <th className="px-4 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {job.clips.map((clip) => (
                  <tr
                    key={clip.id}
                    className="hover:bg-white/[0.03] transition-colors"
                  >
                    <td className="px-4 py-4 font-mono text-xs tabular-nums text-[#9CA3AF]">
                      #{String(clip.index).padStart(2, '0')}
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-semibold text-[#F4F4F5]">
                        {clip.hookTitle}
                      </div>
                      <div className="mt-0.5 text-xs text-[#9CA3AF]">
                        {clip.reason}
                      </div>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs tabular-nums text-[#D1D5DB] whitespace-nowrap">
                      {formatTimecode(clip.start)} – {formatTimecode(clip.end)}
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-xs tabular-nums text-[#D1D5DB]">
                      {clip.signals.llmScore}
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-xs tabular-nums text-[#D1D5DB]">
                      {clip.signals.audioScore}
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-xs tabular-nums text-[#D1D5DB]">
                      {clip.signals.reactionScore}
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-xs tabular-nums text-[#D1D5DB]">
                      {clip.signals.pacingScore}
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-sm font-bold tabular-nums text-[#F5B700]">
                      {clip.score}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => onEditClip(clip)}
                        className="text-xs font-semibold text-[#F5B700] hover:underline whitespace-nowrap"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* TAB 3: WORD-LEVEL TRANSCRIPT */}
      {activeTab === 'transcript' ? (
        <section aria-label="Video transcript" className="mt-8">
          <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="relative max-w-md flex-1">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]"
                aria-hidden="true"
              />
              <input
                type="search"
                value={transcriptQuery}
                onChange={(e) => setTranscriptQuery(e.target.value)}
                placeholder="Search transcript, speaker, or laughter..."
                aria-label="Search transcript"
                className="w-full rounded-lg border border-white/[0.12] bg-[#14161B] py-2 pl-10 pr-4 text-sm text-[#F4F4F5] placeholder:text-[#6B7280] focus:border-[#F5B700] focus:outline-none"
              />
            </div>

            <div className="font-mono text-xs tabular-nums text-[#9CA3AF]">
              {filteredTranscript.length} segments · {job.audioSpikes.length}{' '}
              audio peaks
            </div>
          </div>

          <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.08] bg-[#14161B]">
            {filteredTranscript.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#9CA3AF]">
                No transcript lines match "{transcriptQuery}".
              </div>
            ) : (
              filteredTranscript.map((seg) => {
                const matchedClip = findClipForTime(seg.start);
                return (
                  <div
                    key={seg.id}
                    className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:gap-6"
                  >
                    <div className="w-32 shrink-0 font-mono text-xs tabular-nums text-[#9CA3AF]">
                      {formatTimecode(seg.start)} – {formatTimecode(seg.end)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-[#9CA3AF]">
                        <span className="font-semibold text-[#F4F4F5]">
                          {seg.speaker}
                        </span>
                        {seg.audioTag ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#F5B700]">
                              Audio cue: {seg.audioTag}
                            </span>
                          </>
                        ) : null}
                        {matchedClip ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <button
                              type="button"
                              onClick={() => onEditClip(matchedClip)}
                              className="text-[#38BDF8] hover:underline"
                            >
                              Used in Clip {matchedClip.index}
                            </button>
                          </>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-[#E5E7EB]">
                        {seg.text}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}
