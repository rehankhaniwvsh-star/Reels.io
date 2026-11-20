import { useCallback, useEffect, useState } from 'react';
import {
  deleteJob,
  getAuthStatus,
  getHealth,
  getJob,
  getSavedPasscode,
  getZipDownloadUrl,
  listJobs,
  startSampleJob,
  startUploadJob,
  startUrlJob,
} from './lib/api';
import type { ClipItem, ClipSettings, JobRecord } from './shared/types';
import { ClipEditorModal } from './components/ClipEditorModal';
import { PasswordGate } from './components/PasswordGate';
import { ProgressView } from './components/ProgressView';
import { RecentJobsView } from './components/RecentJobsView';
import { ResultsWorkspace } from './components/ResultsWorkspace';
import { StudioHome } from './components/StudioHome';
import { TemplatesDirectory } from './components/TemplatesDirectory';
import { TopBar, type AppView } from './components/TopBar';

const DEFAULT_SETTINGS: ClipSettings = {
  clipCount: '3',
  clipLength: '15-30',
  styleFocus: 'funny',
  templateId: 'karaoke-pop',
  layout: 'fill',
  includeCaptions: true,
};

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [locked, setLocked] = useState(false);
  const [view, setView] = useState<AppView>('studio');
  const [settings, setSettings] = useState<ClipSettings>(DEFAULT_SETTINGS);
  const [activeJob, setActiveJob] = useState<JobRecord | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobRecord[]>([]);
  const [editingClip, setEditingClip] = useState<ClipItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bannerError, setBannerError] = useState('');
  const [serverTools, setServerTools] = useState<{
    ffmpeg: boolean;
    ffprobe: boolean;
    ytDlp: boolean;
    youtubeCookies: boolean;
  }>();

  const refreshHealth = useCallback(async () => {
    try {
      const health = await getHealth();
      if (health?.tools) setServerTools(health.tools);
    } catch {
      // Ignore transient health errors
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const jobs = await listJobs();
      setRecentJobs(jobs);
    } catch {
      // Ignore transient poll errors
    }
  }, []);

  // Check optional single-user passcode gate on load
  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const status = await getAuthStatus();
        if (cancelled) return;
        if (status.passwordRequired && !getSavedPasscode()) {
          setLocked(true);
        } else {
          setLocked(false);
          const [health, jobs] = await Promise.all([
            getHealth().catch(() => null),
            listJobs().catch(() => []),
          ]);
          if (cancelled) return;
          if (health?.tools) setServerTools(health.tools);
          setRecentJobs(jobs);
        }
      } catch {
        setLocked(false);
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll active job while queued or processing
  useEffect(() => {
    if (
      !activeJob ||
      (activeJob.status !== 'queued' && activeJob.status !== 'processing')
    ) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const updated = await getJob(activeJob.id);
        if (cancelled) return;
        setActiveJob(updated);
        if (updated.status === 'completed' || updated.status === 'error') {
          void refreshHistory();
        }
      } catch {
        // Retry next tick
      }
    };

    const interval = window.setInterval(() => {
      void poll();
    }, 900);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeJob, refreshHistory]);

  async function handleSubmitUrl(url: string) {
    setSubmitting(true);
    setBannerError('');
    try {
      const job = await startUrlJob(url, settings);
      setActiveJob(job);
      setView('job');
      void refreshHistory();
    } catch (err) {
      setBannerError(
        err instanceof Error ? err.message : 'Failed to enqueue video job.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitFile(file: File) {
    setSubmitting(true);
    setBannerError('');
    try {
      const job = await startUploadJob(file, settings);
      setActiveJob(job);
      setView('job');
      void refreshHistory();
    } catch (err) {
      setBannerError(
        err instanceof Error ? err.message : 'Failed to upload video.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRunSample() {
    setSubmitting(true);
    setBannerError('');
    try {
      const job = await startSampleJob(settings);
      setActiveJob(job);
      setView('job');
      void refreshHistory();
    } catch (err) {
      setBannerError(
        err instanceof Error ? err.message : 'Failed to start sample session.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteJob(jobId: string) {
    await deleteJob(jobId);
    if (activeJob?.id === jobId) {
      setActiveJob(null);
      setView('studio');
    }
    await refreshHistory();
  }

  function handleClipUpdated(updatedClip: ClipItem) {
    setEditingClip(updatedClip);
    setActiveJob((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        clips: prev.clips.map((c) =>
          c.id === updatedClip.id ? updatedClip : c
        ),
      };
    });
  }

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0C0D10] text-sm text-[#9CA3AF]">
        Loading ReelMaker...
      </div>
    );
  }

  if (locked) {
    return (
      <PasswordGate
        onUnlocked={() => {
          setLocked(false);
          void refreshHistory();
          void getHealth()
            .then((h) => setServerTools(h.tools))
            .catch(() => {});
        }}
      />
    );
  }

  const activeJobZipUrl =
    view === 'job' && activeJob?.status === 'completed'
      ? getZipDownloadUrl(activeJob.id)
      : undefined;

  return (
    <div className="min-h-screen bg-[#0C0D10] text-[#F4F4F5]">
      <TopBar
        activeView={view}
        onNavigate={(next) => {
          setBannerError('');
          setView(next);
          if (next === 'history') void refreshHistory();
        }}
        activeJobZipUrl={activeJobZipUrl}
        onNewReel={() => {
          setBannerError('');
          setActiveJob(null);
          setView('studio');
        }}
      />

      {bannerError ? (
        <div
          role="alert"
          className="mx-auto mt-4 max-w-[1280px] px-4 sm:px-6 lg:px-8"
        >
          <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-4 py-3 text-sm text-[#FECACA]">
            {bannerError}
          </div>
        </div>
      ) : null}

      {view === 'studio' ? (
        <StudioHome
          settings={settings}
          onChangeSettings={setSettings}
          onSubmitUrl={handleSubmitUrl}
          onSubmitFile={handleSubmitFile}
          onRunSample={handleRunSample}
          submitting={submitting}
          serverTools={serverTools}
          onRefreshHealth={() => void refreshHealth()}
        />
      ) : null}

      {view === 'templates' ? (
        <TemplatesDirectory
          selectedTemplateId={settings.templateId}
          onUseTemplate={(templateId) => {
            setSettings((prev) => ({ ...prev, templateId }));
            setView('studio');
          }}
        />
      ) : null}

      {view === 'history' ? (
        <RecentJobsView
          jobs={recentJobs}
          onOpenJob={(job) => {
            setActiveJob(job);
            setView('job');
          }}
          onDeleteJob={handleDeleteJob}
          onStartNew={() => {
            setActiveJob(null);
            setView('studio');
          }}
        />
      ) : null}

      {view === 'job' && activeJob ? (
        activeJob.status === 'completed' ? (
          <ResultsWorkspace
            job={activeJob}
            onEditClip={(clip) => setEditingClip(clip)}
            onBackToStudio={() => {
              setActiveJob(null);
              setView('studio');
            }}
          />
        ) : (
          <ProgressView
            job={activeJob}
            onBackToStudio={() => {
              setActiveJob(null);
              setView('studio');
            }}
            onRetryUrl={handleSubmitUrl}
            onUploadFileInstead={handleSubmitFile}
            onRunSampleInstead={() => void handleRunSample()}
            onCookiesUpdated={() => void refreshHealth()}
          />
        )
      ) : null}

      {editingClip && activeJob ? (
        <ClipEditorModal
          jobId={activeJob.id}
          videoDuration={activeJob.videoDuration}
          clip={editingClip}
          onClose={() => setEditingClip(null)}
          onClipUpdated={handleClipUpdated}
        />
      ) : null}
    </div>
  );
}
