import { Trash2 } from 'lucide-react';
import { formatTimecode } from '../shared/momentScoring';
import type { JobRecord } from '../shared/types';

interface RecentJobsViewProps {
  jobs: JobRecord[];
  onOpenJob: (job: JobRecord) => void;
  onDeleteJob: (jobId: string) => Promise<void>;
  onStartNew: () => void;
}

export function RecentJobsView({
  jobs,
  onOpenJob,
  onDeleteJob,
  onStartNew,
}: RecentJobsViewProps) {
  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.08] pb-6">
        <div>
          <h1 className="font-display text-3xl font-bold text-[#F4F4F5]">
            Recent Jobs
          </h1>
          <p className="mt-1.5 text-sm text-[#9CA3AF]">
            Temporary files and rendered clips are stored on the server and
            automatically deleted after 7 days.
          </p>
        </div>
        <button
          type="button"
          onClick={onStartNew}
          className="rounded-lg bg-[#F5B700] px-4 py-2 text-xs font-semibold text-[#0C0D10] hover:bg-[#FFC926] transition-colors whitespace-nowrap"
        >
          Process New Video
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="mt-10 rounded-xl border border-white/[0.08] bg-[#14161B] p-10 text-center">
          <p className="font-display text-lg font-semibold text-[#F4F4F5]">
            No reel sessions yet
          </p>
          <p className="mt-1.5 text-sm text-[#9CA3AF]">
            Paste a video URL, upload an MP4, or run the built-in Sample Studio
            Video to generate your first batch of 9:16 reels.
          </p>
          <button
            type="button"
            onClick={onStartNew}
            className="mt-5 rounded-lg bg-[#F5B700] px-5 py-2.5 text-sm font-semibold text-[#0C0D10] hover:bg-[#FFC926] transition-colors"
          >
            Open Studio
          </button>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto rounded-xl border border-white/[0.08] bg-[#14161B]">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b border-white/[0.08] text-xs font-medium text-[#9CA3AF]">
              <tr>
                <th className="px-5 py-3.5">Source</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Clips</th>
                <th className="px-5 py-3.5 text-right">Duration</th>
                <th className="px-5 py-3.5">Created</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {jobs.map((job) => (
                <tr
                  key={job.id}
                  className="hover:bg-white/[0.03] transition-colors"
                >
                  <td className="px-5 py-4">
                    <button
                      type="button"
                      onClick={() => onOpenJob(job)}
                      className="text-left font-medium text-[#F4F4F5] hover:text-[#F5B700] transition-colors"
                    >
                      {job.sourceLabel}
                    </button>
                    <div className="mt-0.5 text-xs text-[#9CA3AF]">
                      {job.settings.templateId} · {job.settings.layout} ·{' '}
                      {job.settings.styleFocus}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-xs font-medium capitalize">
                    <span
                      className={
                        job.status === 'completed'
                          ? 'text-[#4ADE80]'
                          : job.status === 'error'
                          ? 'text-[#F87171]'
                          : 'text-[#F5B700]'
                      }
                    >
                      {job.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right font-mono text-xs tabular-nums text-[#D1D5DB]">
                    {job.clips.length}
                  </td>
                  <td className="px-5 py-4 text-right font-mono text-xs tabular-nums text-[#D1D5DB]">
                    {job.videoDuration > 0
                      ? formatTimecode(job.videoDuration)
                      : '—'}
                  </td>
                  <td className="px-5 py-4 font-mono text-xs tabular-nums text-[#9CA3AF]">
                    {new Date(job.createdAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="inline-flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => onOpenJob(job)}
                        className="text-xs font-semibold text-[#F5B700] hover:underline"
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteJob(job.id)}
                        aria-label={`Delete job ${job.sourceLabel}`}
                        className="text-[#9CA3AF] hover:text-[#F87171] transition-colors"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
