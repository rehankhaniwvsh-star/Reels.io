import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  buildSampleStudioTranscript,
  findEngagingMomentsWithGemini,
  transcribeAudioWithGemini,
} from './aiService.ts';
import {
  cleanupExpiredJobs,
  downloadVideoFromUrl,
  extractAudioAndSpikes,
  generateSampleStudioVideo,
  MediaError,
  probeVideo,
  renderVerticalClip,
  SEVEN_DAYS_MS,
} from './mediaProcessor.ts';
import { getTemplateById } from '../src/shared/captionEngine.ts';
import type {
  CaptionCustomization,
  ClipItem,
  ClipSettings,
  JobRecord,
  JobStageId,
  JobStepStatus,
  LayoutMode,
  TranscriptWord,
} from '../src/shared/types.ts';

export const STORAGE_ROOT = path.resolve(process.cwd(), 'tmp_storage', 'jobs');

const INITIAL_STEPS: Array<{ id: JobStageId; label: string }> = [
  { id: 'downloading', label: 'Downloading' },
  { id: 'transcribing', label: 'Transcribing' },
  { id: 'finding_moments', label: 'Finding funny moments' },
  { id: 'cutting', label: 'Cutting' },
  { id: 'adding_captions', label: 'Adding captions' },
  { id: 'done', label: 'Done' },
];

function createSteps(): JobStepStatus[] {
  return INITIAL_STEPS.map((s) => ({
    id: s.id,
    label: s.label,
    status: 'pending',
  }));
}

interface QueuedTask {
  jobId: string;
  uploadedFilePath?: string;
}

class JobQueueManager {
  private jobs = new Map<string, JobRecord>();
  private queue: QueuedTask[] = [];
  private activeCount = 0;
  private maxConcurrency = 2;

  async init(): Promise<void> {
    await fsp.mkdir(STORAGE_ROOT, { recursive: true });
    await cleanupExpiredJobs(STORAGE_ROOT, SEVEN_DAYS_MS);
    await this.hydrateFromDisk();

    // Schedule periodic 7-day temporary file cleanup every 6 hours
    setInterval(() => {
      cleanupExpiredJobs(STORAGE_ROOT, SEVEN_DAYS_MS).catch(() => {});
    }, 6 * 60 * 60 * 1000).unref();
  }

  private async hydrateFromDisk(): Promise<void> {
    try {
      const entries = await fsp.readdir(STORAGE_ROOT, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const metaPath = path.join(STORAGE_ROOT, entry.name, 'job.json');
        if (!fs.existsSync(metaPath)) continue;
        try {
          const raw = await fsp.readFile(metaPath, 'utf8');
          const parsed = JSON.parse(raw) as JobRecord;
          if (parsed.status === 'processing' || parsed.status === 'queued') {
            parsed.status = 'error';
            parsed.errorCode = 'PROCESSING_ERROR';
            parsed.errorMessage = 'Job was interrupted by a server restart.';
            parsed.errorHint = 'Start a new run to process this video.';
          }
          this.jobs.set(parsed.id, parsed);
        } catch {
          // Skip malformed record
        }
      }
    } catch {
      // Empty storage
    }
  }

  getJobDir(jobId: string): string {
    return path.join(STORAGE_ROOT, jobId);
  }

  getClipVideoPath(jobId: string, clipId: string): string {
    return path.join(this.getJobDir(jobId), 'clips', `${clipId}.mp4`);
  }

  getSourceVideoPath(jobId: string): string {
    return path.join(this.getJobDir(jobId), 'source.mp4');
  }

  listJobs(): JobRecord[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  getJob(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  async deleteJob(jobId: string): Promise<boolean> {
    const exists = this.jobs.delete(jobId);
    const dir = this.getJobDir(jobId);
    if (fs.existsSync(dir)) {
      await fsp.rm(dir, { recursive: true, force: true });
    }
    return exists;
  }

  private async persistJob(job: JobRecord): Promise<void> {
    const dir = this.getJobDir(job.id);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, 'job.json'),
      JSON.stringify(job, null, 2),
      'utf8'
    );
  }

  private setStage(
    job: JobRecord,
    stageId: JobStageId,
    progress: number,
    detail?: string
  ): void {
    job.currentStage = stageId;
    job.progress = Math.max(0, Math.min(100, Math.round(progress)));
    const targetIdx = INITIAL_STEPS.findIndex((s) => s.id === stageId);
    job.steps = job.steps.map((step, idx) => {
      if (idx < targetIdx) {
        return { ...step, status: 'completed' };
      }
      if (idx === targetIdx) {
        return {
          ...step,
          status: stageId === 'done' ? 'completed' : 'active',
          detail: detail ?? step.detail,
        };
      }
      return { ...step, status: 'pending' };
    });
  }

  async enqueueJob(params: {
    sourceType: 'url' | 'upload' | 'sample';
    sourceLabel: string;
    sourceUrl?: string;
    uploadedFilePath?: string;
    settings: ClipSettings;
  }): Promise<JobRecord> {
    const id = `job_${crypto.randomBytes(6).toString('hex')}`;
    const now = Date.now();
    const job: JobRecord = {
      id,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SEVEN_DAYS_MS).toISOString(),
      sourceType: params.sourceType,
      sourceLabel: params.sourceLabel,
      sourceUrl: params.sourceUrl,
      videoDuration: 0,
      videoWidth: 0,
      videoHeight: 0,
      settings: params.settings,
      status: 'queued',
      currentStage: 'downloading',
      progress: 4,
      steps: createSteps(),
      transcript: [],
      audioSpikes: [],
      moments: [],
      clips: [],
    };

    this.jobs.set(id, job);
    await this.persistJob(job);

    this.queue.push({ jobId: id, uploadedFilePath: params.uploadedFilePath });
    this.drainQueue();
    return job;
  }

  private drainQueue(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      if (!task) break;
      this.activeCount += 1;
      this.runJob(task)
        .catch(() => {})
        .finally(() => {
          this.activeCount -= 1;
          this.drainQueue();
        });
    }
  }

  private async runJob(task: QueuedTask): Promise<void> {
    const job = this.jobs.get(task.jobId);
    if (!job) return;

    const jobDir = this.getJobDir(job.id);
    const sourcePath = this.getSourceVideoPath(job.id);
    await fsp.mkdir(path.join(jobDir, 'clips'), { recursive: true });

    job.status = 'processing';
    try {
      // 1. Downloading / Ingesting
      this.setStage(
        job,
        'downloading',
        10,
        job.sourceType === 'upload'
          ? 'Validating uploaded video file...'
          : job.sourceType === 'sample'
          ? 'Preparing 72s studio sample session...'
          : 'Fetching video stream from URL...'
      );
      await this.persistJob(job);

      if (job.sourceType === 'upload' && task.uploadedFilePath) {
        await fsp.rename(task.uploadedFilePath, sourcePath).catch(async () => {
          await fsp.copyFile(task.uploadedFilePath!, sourcePath);
          await fsp.unlink(task.uploadedFilePath!).catch(() => {});
        });
      } else if (job.sourceType === 'sample') {
        const res = await generateSampleStudioVideo(sourcePath);
        job.sourceLabel = res.title;
      } else if (job.sourceType === 'url' && job.sourceUrl) {
        const downloaded = await downloadVideoFromUrl(job.sourceUrl, jobDir);
        if (downloaded.filePath !== sourcePath) {
          await fsp.rename(downloaded.filePath, sourcePath);
        }
        job.sourceLabel = downloaded.title;
      } else {
        throw new MediaError(
          'INVALID_URL',
          'No video source provided.',
          'Paste a video URL or upload a video file.'
        );
      }

      const probe = await probeVideo(sourcePath);
      job.videoDuration = Number(probe.duration.toFixed(2));
      job.videoWidth = probe.width;
      job.videoHeight = probe.height;

      // 2. Transcribing + Audio energy analysis
      this.setStage(
        job,
        'transcribing',
        32,
        'Extracting audio waveform and generating word-level transcript...'
      );
      await this.persistJob(job);

      const { audioPath, spikes } = await extractAudioAndSpikes(
        sourcePath,
        jobDir,
        probe.duration
      );
      job.audioSpikes = spikes;

      if (job.sourceType === 'sample') {
        job.transcript = buildSampleStudioTranscript();
      } else {
        job.transcript = await transcribeAudioWithGemini(audioPath, probe.duration);
      }

      // 3. Finding funny / engaging moments
      this.setStage(
        job,
        'finding_moments',
        54,
        `Scoring punchlines, audio spikes, and reactions (${job.settings.styleFocus})...`
      );
      await this.persistJob(job);

      const moments = await findEngagingMomentsWithGemini({
        segments: job.transcript,
        audioSpikes: job.audioSpikes,
        settings: job.settings,
        videoDuration: probe.duration,
        isSampleSession: job.sourceType === 'sample',
      });
      job.moments = moments;

      if (moments.length === 0) {
        throw new MediaError(
          'PROCESSING_ERROR',
          'Could not isolate clean highlight segments from this video.',
          'Try a video with clearer spoken dialogue or adjust clip length settings.'
        );
      }

      // 4. Cutting 9:16 vertical clips
      this.setStage(
        job,
        'cutting',
        70,
        `Reframing ${moments.length} vertical 9:16 clips (${job.settings.layout})...`
      );
      await this.persistJob(job);

      const allWords = job.transcript.flatMap((s) => s.words);
      const selectedTemplate = getTemplateById(job.settings.templateId);

      // Build initial ClipItem records
      const clips: ClipItem[] = moments.map((m, idx) => {
        const clipWords = allWords.filter(
          (w) => w.end > m.start && w.start < m.end
        );
        const clipId = m.id;
        return {
          id: clipId,
          index: idx + 1,
          start: m.start,
          end: m.end,
          duration: Number((m.end - m.start).toFixed(1)),
          score: m.score,
          reason: m.reason,
          hookTitle: m.hookTitle,
          showHookTitle: true,
          styleTag: m.styleTag,
          signals: m.signals,
          layout: job.settings.layout,
          captions: {
            templateId: selectedTemplate.id,
            font: selectedTemplate.font,
            fontSize: selectedTemplate.fontSize,
            primaryColor: selectedTemplate.primaryColor,
            accentColor: selectedTemplate.accentColor,
            outlineColor: selectedTemplate.outlineColor,
            boxColor: selectedTemplate.boxColor,
            position: selectedTemplate.position,
            animation: selectedTemplate.animation,
            wordsPerLine: selectedTemplate.wordsPerLine,
            uppercase: selectedTemplate.uppercase,
            showEmoji: selectedTemplate.showEmoji,
          },
          words: clipWords,
          videoUrl: `/api/jobs/${job.id}/clips/${clipId}/stream?v=1`,
          downloadUrl: `/api/jobs/${job.id}/clips/${clipId}/download?v=1`,
          renderStatus: 'rendering',
          renderVersion: 1,
        };
      });

      // 5. Adding captions + FFmpeg render per clip
      this.setStage(
        job,
        'adding_captions',
        82,
        job.settings.includeCaptions
          ? `Burning "${selectedTemplate.name}" animated captions into ${clips.length} reels...`
          : `Encoding ${clips.length} vertical reels...`
      );
      await this.persistJob(job);

      for (let i = 0; i < clips.length; i += 1) {
        const clip = clips[i];
        const outMp4 = this.getClipVideoPath(job.id, clip.id);
        const outAss = path.join(jobDir, 'clips', `${clip.id}.ass`);

        await renderVerticalClip({
          sourceVideoPath: sourcePath,
          outputVideoPath: outMp4,
          assOutputPath: outAss,
          start: clip.start,
          end: clip.end,
          layout: clip.layout,
          includeCaptions: job.settings.includeCaptions,
          words: clip.words,
          customization: clip.captions,
          hookTitle: clip.hookTitle,
          showHookTitle: clip.showHookTitle,
        });

        clip.renderStatus = 'ready';
        const pct = 82 + Math.round(((i + 1) / clips.length) * 16);
        this.setStage(
          job,
          'adding_captions',
          pct,
          `Rendered clip ${i + 1} of ${clips.length} (${clip.hookTitle})`
        );
        job.clips = [...clips];
        await this.persistJob(job);
      }

      // 6. Done
      job.clips = clips;
      job.status = 'completed';
      this.setStage(
        job,
        'done',
        100,
        `${clips.length} vertical reels ready for preview & download.`
      );
      await this.persistJob(job);
    } catch (err: unknown) {
      job.status = 'error';
      if (err instanceof MediaError) {
        job.errorCode = err.code;
        job.errorMessage = err.message;
        job.errorHint = err.hint;
      } else {
        const rawMessage =
          err instanceof Error ? err.message : 'Unexpected processing error.';
        let message = rawMessage;
        try {
          const parsedErr = JSON.parse(rawMessage);
          if (typeof parsedErr?.error?.message === 'string') {
            message = parsedErr.error.message;
          }
        } catch {
          // Keep plain string message
        }
        const isAiError = /GEMINI_API_KEY|API_KEY|403|429|404|503|UNAVAILABLE|model/i.test(
          rawMessage
        );
        job.errorCode = isAiError ? 'AI_ERROR' : 'PROCESSING_ERROR';
        job.errorMessage = message;
        job.errorHint = isAiError
          ? 'The AI service returned an error or is temporarily busy. Check Settings > Secrets or retry in a moment.'
          : 'Verify the video source and retry.';
      }
      job.steps = job.steps.map((s) =>
        s.id === job.currentStage ? { ...s, status: 'error', detail: job.errorMessage } : s
      );
      await this.persistJob(job);
    }
  }

  async regenerateClip(
    jobId: string,
    clipId: string,
    updates: {
      start?: number;
      end?: number;
      hookTitle?: string;
      showHookTitle?: boolean;
      layout?: LayoutMode;
      captions?: CaptionCustomization;
      words?: TranscriptWord[];
      includeCaptions?: boolean;
    }
  ): Promise<ClipItem> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error('Job not found');
    const clipIndex = job.clips.findIndex((c) => c.id === clipId);
    if (clipIndex === -1) throw new Error('Clip not found');

    const existing = job.clips[clipIndex];
    const sourcePath = this.getSourceVideoPath(jobId);
    if (!fs.existsSync(sourcePath)) {
      throw new Error('Source video has expired or been deleted.');
    }

    const nextStart = Math.max(
      0,
      Math.min(job.videoDuration - 2, updates.start ?? existing.start)
    );
    const nextEnd = Math.max(
      nextStart + 2,
      Math.min(job.videoDuration, updates.end ?? existing.end)
    );
    const nextHookTitle = updates.hookTitle ?? existing.hookTitle;
    const nextShowHookTitle = updates.showHookTitle ?? existing.showHookTitle;
    const nextLayout = updates.layout ?? existing.layout;
    const nextCaptions: CaptionCustomization = updates.captions
      ? { ...existing.captions, ...updates.captions }
      : existing.captions;
    const nextWords = updates.words ?? existing.words;
    const includeCaptions = updates.includeCaptions ?? job.settings.includeCaptions;

    existing.renderStatus = 'rendering';
    await this.persistJob(job);

    const jobDir = this.getJobDir(jobId);
    const outMp4 = this.getClipVideoPath(jobId, clipId);
    const outAss = path.join(jobDir, 'clips', `${clipId}.ass`);

    try {
      await renderVerticalClip({
        sourceVideoPath: sourcePath,
        outputVideoPath: outMp4,
        assOutputPath: outAss,
        start: nextStart,
        end: nextEnd,
        layout: nextLayout,
        includeCaptions,
        words: nextWords,
        customization: nextCaptions,
        hookTitle: nextHookTitle,
        showHookTitle: nextShowHookTitle,
      });

      const nextVersion = existing.renderVersion + 1;
      const updated: ClipItem = {
        ...existing,
        start: Number(nextStart.toFixed(2)),
        end: Number(nextEnd.toFixed(2)),
        duration: Number((nextEnd - nextStart).toFixed(1)),
        hookTitle: nextHookTitle,
        showHookTitle: nextShowHookTitle,
        layout: nextLayout,
        captions: nextCaptions,
        words: nextWords,
        renderStatus: 'ready',
        renderVersion: nextVersion,
        videoUrl: `/api/jobs/${jobId}/clips/${clipId}/stream?v=${nextVersion}`,
        downloadUrl: `/api/jobs/${jobId}/clips/${clipId}/download?v=${nextVersion}`,
        errorMessage: undefined,
      };

      job.clips[clipIndex] = updated;
      await this.persistJob(job);
      return updated;
    } catch (err) {
      existing.renderStatus = 'error';
      existing.errorMessage =
        err instanceof Error ? err.message : 'Failed to regenerate clip.';
      await this.persistJob(job);
      throw err;
    }
  }
}

export const jobQueue = new JobQueueManager();
