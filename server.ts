import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import * as archiverPkg from 'archiver';
import multer from 'multer';
type ArchiverFactory = (
  format: 'zip',
  options?: { zlib?: { level?: number } }
) => archiverPkg.Archiver;
const createArchiver: ArchiverFactory =
  (archiverPkg as unknown as { default?: ArchiverFactory }).default ??
  (archiverPkg as unknown as ArchiverFactory);
import { CAPTION_TEMPLATES } from './src/shared/captionEngine.ts';
import {
  checkToolAvailability,
  clearYoutubeCookies,
  ensureYtDlpBinary,
  getYoutubeCookiesStatus,
  MAX_VIDEO_DURATION_SECONDS,
  saveYoutubeCookies,
} from './server/mediaProcessor.ts';
import { jobQueue, STORAGE_ROOT } from './server/jobQueue.ts';
import type { ClipSettings } from './src/shared/types.ts';

function resolvePort(): number {
  const envPort = Number(process.env.PORT);
  if (Number.isFinite(envPort) && envPort > 0) return envPort;
  const idx = process.argv.findIndex((a) => a === '--port' || a === '-p');
  if (idx !== -1 && process.argv[idx + 1]) {
    const cliPort = Number(process.argv[idx + 1]);
    if (Number.isFinite(cliPort) && cliPort > 0) return cliPort;
  }
  return 3000;
}

const PORT = resolvePort();
const UPLOAD_TEMP_DIR = path.resolve(process.cwd(), 'tmp_storage', 'uploads');

function getConfiguredPassword(): string {
  return (process.env.REELMAKER_PASSWORD || '').trim();
}

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const password = getConfiguredPassword();
  if (!password) {
    next();
    return;
  }

  const headerPass = String(req.headers['x-reelmaker-passcode'] || '').trim();
  const queryPass = String(req.query.passcode || '').trim();
  if (headerPass === password || queryPass === password) {
    next();
    return;
  }

  res.status(401).json({
    error: 'Authentication required',
    passwordRequired: true,
  });
}

function parseSettings(raw: unknown): ClipSettings {
  const input = (typeof raw === 'string' ? JSON.parse(raw) : raw || {}) as Partial<ClipSettings>;
  const validCounts = new Set(['3', '5', '10', 'auto']);
  const validLengths = new Set(['15-30', '30-60', '60-90']);
  const validStyles = new Set(['funny', 'hype', 'shocking', 'wholesome', 'mixed']);
  const validLayouts = new Set(['fill', 'fit-blur', 'split-screen']);

  return {
    clipCount: validCounts.has(String(input.clipCount))
      ? (input.clipCount as ClipSettings['clipCount'])
      : '3',
    clipLength: validLengths.has(String(input.clipLength))
      ? (input.clipLength as ClipSettings['clipLength'])
      : '15-30',
    styleFocus: validStyles.has(String(input.styleFocus))
      ? (input.styleFocus as ClipSettings['styleFocus'])
      : 'funny',
    templateId:
      typeof input.templateId === 'string' && input.templateId.trim()
        ? input.templateId.trim()
        : 'karaoke-pop',
    layout: validLayouts.has(String(input.layout))
      ? (input.layout as ClipSettings['layout'])
      : 'fill',
    includeCaptions: input.includeCaptions !== false,
  };
}

async function startServer() {
  await fsp.mkdir(UPLOAD_TEMP_DIR, { recursive: true });
  await fsp.mkdir(STORAGE_ROOT, { recursive: true });
  await jobQueue.init();
  // Pre-warm standalone yt-dlp binary in the background so YouTube/Twitch URLs run immediately
  void ensureYtDlpBinary().catch(() => {});

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  const upload = multer({
    dest: UPLOAD_TEMP_DIR,
    limits: {
      fileSize: 600 * 1024 * 1024, // 600 MB max upload
    },
  });

  // Public auth status & verification endpoints
  app.get('/api/auth/status', (_req, res) => {
    res.json({
      passwordRequired: getConfiguredPassword().length > 0,
    });
  });

  app.post('/api/auth/verify', (req, res) => {
    const required = getConfiguredPassword();
    if (!required) {
      res.json({ ok: true });
      return;
    }
    const provided = String(req.body?.passcode || '').trim();
    if (provided === required) {
      res.json({ ok: true });
    } else {
      res.status(401).json({ ok: false, error: 'Incorrect passphrase.' });
    }
  });

  // Protected API routes
  app.get('/api/health', authMiddleware, async (_req, res) => {
    const tools = await checkToolAvailability();
    res.json({
      status: 'ok',
      tools,
      maxDurationSeconds: MAX_VIDEO_DURATION_SECONDS,
      retentionDays: 7,
    });
  });

  app.get('/api/ytdlp/cookies', authMiddleware, (_req, res) => {
    res.json(getYoutubeCookiesStatus());
  });

  app.post('/api/ytdlp/cookies', authMiddleware, async (req, res) => {
    try {
      const content = String(req.body?.cookies || '');
      await saveYoutubeCookies(content);
      res.json({ ok: true, ...getYoutubeCookiesStatus() });
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error ? err.message : 'Could not save cookies.txt.',
      });
    }
  });

  app.delete('/api/ytdlp/cookies', authMiddleware, async (_req, res) => {
    await clearYoutubeCookies();
    res.json({ ok: true, ...getYoutubeCookiesStatus() });
  });

  app.get('/api/templates', authMiddleware, (_req, res) => {
    res.json({ templates: CAPTION_TEMPLATES });
  });

  app.get('/api/jobs', authMiddleware, (_req, res) => {
    res.json({ jobs: jobQueue.listJobs() });
  });

  app.post('/api/jobs/url', authMiddleware, async (req, res) => {
    try {
      const url = String(req.body?.url || '').trim();
      if (!url) {
        res.status(400).json({ error: 'Please paste a video URL first.' });
        return;
      }
      const settings = parseSettings(req.body?.settings);
      const job = await jobQueue.enqueueJob({
        sourceType: 'url',
        sourceLabel: url,
        sourceUrl: url,
        settings,
      });
      res.status(202).json({ job });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Invalid request payload.',
      });
    }
  });

  app.post(
    '/api/jobs/upload',
    authMiddleware,
    upload.single('video'),
    async (req, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'Please select a video file to upload.' });
          return;
        }
        const settings = parseSettings(req.body?.settings);
        const job = await jobQueue.enqueueJob({
          sourceType: 'upload',
          sourceLabel: req.file.originalname || 'Uploaded Video',
          uploadedFilePath: req.file.path,
          settings,
        });
        res.status(202).json({ job });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Upload failed.',
        });
      }
    }
  );

  app.post('/api/jobs/sample', authMiddleware, async (req, res) => {
    try {
      const settings = parseSettings(req.body?.settings);
      const job = await jobQueue.enqueueJob({
        sourceType: 'sample',
        sourceLabel: 'Late Night Podcast Ep. 42 — Studio Session (Sample)',
        settings,
      });
      res.status(202).json({ job });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Could not start sample job.',
      });
    }
  });

  app.get('/api/jobs/:id', authMiddleware, (req, res) => {
    const job = jobQueue.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Job not found or expired.' });
      return;
    }
    res.json({ job });
  });

  app.delete('/api/jobs/:id', authMiddleware, async (req, res) => {
    const deleted = await jobQueue.deleteJob(req.params.id);
    res.json({ deleted });
  });

  // HTTP Range-capable MP4 video streaming for smooth browser playback
  app.get('/api/jobs/:id/clips/:clipId/stream', authMiddleware, (req, res) => {
    const filePath = jobQueue.getClipVideoPath(req.params.id, req.params.clipId);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Clip video not found.' });
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  app.get('/api/jobs/:id/clips/:clipId/download', authMiddleware, (req, res) => {
    const job = jobQueue.getJob(req.params.id);
    const filePath = jobQueue.getClipVideoPath(req.params.id, req.params.clipId);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Clip file not found.' });
      return;
    }
    const clip = job?.clips.find((c) => c.id === req.params.clipId);
    const slug = (clip?.hookTitle || req.params.clipId)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 42);
    const filename = `reelmaker-${slug || req.params.clipId}.mp4`;
    res.download(filePath, filename);
  });

  app.post('/api/jobs/:id/clips/:clipId/regenerate', authMiddleware, async (req, res) => {
    try {
      const updated = await jobQueue.regenerateClip(
        req.params.id,
        req.params.clipId,
        {
          start:
            typeof req.body?.start === 'number' ? req.body.start : undefined,
          end: typeof req.body?.end === 'number' ? req.body.end : undefined,
          hookTitle:
            typeof req.body?.hookTitle === 'string'
              ? req.body.hookTitle
              : undefined,
          showHookTitle:
            typeof req.body?.showHookTitle === 'boolean'
              ? req.body.showHookTitle
              : undefined,
          layout: req.body?.layout,
          captions: req.body?.captions,
          words: Array.isArray(req.body?.words) ? req.body.words : undefined,
          includeCaptions:
            typeof req.body?.includeCaptions === 'boolean'
              ? req.body.includeCaptions
              : undefined,
        }
      );
      res.json({ clip: updated });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to regenerate clip.',
      });
    }
  });

  app.get('/api/jobs/:id/download-zip', authMiddleware, (req, res) => {
    const job = jobQueue.getJob(req.params.id);
    if (!job || job.clips.length === 0) {
      res.status(404).json({ error: 'No rendered clips found for this job.' });
      return;
    }

    const zipName = `reelmaker-${job.id}-all-clips.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = createArchiver('zip', { zlib: { level: 5 } });
    archive.on('error', (err: Error) => {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    });
    archive.pipe(res);

    const manifest = job.clips.map((c) => ({
      index: c.index,
      hookTitle: c.hookTitle,
      score: c.score,
      reason: c.reason,
      start: c.start,
      end: c.end,
      duration: c.duration,
      template: c.captions.templateId,
      layout: c.layout,
    }));
    archive.append(JSON.stringify(manifest, null, 2), {
      name: 'clips-manifest.json',
    });

    for (const clip of job.clips) {
      const clipPath = jobQueue.getClipVideoPath(job.id, clip.id);
      if (fs.existsSync(clipPath)) {
        const slug = clip.hookTitle
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 36);
        archive.file(clipPath, {
          name: `${String(clip.index).padStart(2, '0')}-${slug || clip.id}.mp4`,
        });
      }
    }

    archive.finalize();
  });

  // Return clean JSON 404 for any unmatched /api/* route instead of HTML fallback
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Ensure API middleware errors (e.g. multer file size or JSON parse errors) return JSON
  app.use(
    '/api',
    (err: Error & { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
      if (res.headersSent) return;
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({
          error: 'Video file is too large for direct upload. Try a shorter clip or a direct video URL.',
        });
        return;
      }
      const status = typeof err.status === 'number' && err.status >= 400 ? err.status : 500;
      res.status(status).json({
        error: err.message || 'Internal server error.',
      });
    }
  );

  // Frontend serving: Vite dev middleware in development, static dist/ in production/start/preview
  const distDir = path.resolve(process.cwd(), 'dist');
  const distIndex = path.join(distDir, 'index.html');
  const lifecycle = process.env.npm_lifecycle_event || '';
  const useStaticDist =
    process.env.NODE_ENV === 'production' ||
    ((lifecycle === 'start' || lifecycle === 'preview') &&
      fs.existsSync(distIndex));

  if (!useStaticDist) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(distIndex);
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ReelMaker server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ReelMaker server:', err);
  process.exit(1);
});
