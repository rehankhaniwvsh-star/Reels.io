import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { generateAssSubtitles } from '../src/shared/captionEngine.ts';
import type {
  AudioSpike,
  CaptionCustomization,
  LayoutMode,
  TranscriptWord,
} from '../src/shared/types.ts';

const execFileAsync = promisify(execFile);

export const MAX_VIDEO_DURATION_SECONDS = 7200; // 2 hours
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const BIN_DIR = path.resolve(process.cwd(), 'tmp_storage', 'bin');
export const MANAGED_YTDLP_PATH = path.join(BIN_DIR, 'yt-dlp');
export const COOKIES_FILE_PATH = path.resolve(
  process.cwd(),
  'tmp_storage',
  'uploaded_youtube_cookies.txt'
);
const ENV_COOKIES_FILE_PATH = path.resolve(
  process.cwd(),
  'tmp_storage',
  'youtube_cookies.txt'
);
const YTDLP_RELEASE_URL =
  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

let ytDlpBootstrapPromise: Promise<string | null> | null = null;

export interface VideoProbeInfo {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export type MediaErrorCode =
  | 'PRIVATE_VIDEO'
  | 'BOT_CHECK'
  | 'LIVE_STREAM'
  | 'TOO_LONG'
  | 'DOWNLOAD_BLOCKED'
  | 'INVALID_URL'
  | 'PROCESSING_ERROR';

export class MediaError extends Error {
  code: MediaErrorCode;
  hint: string;

  constructor(code: MediaErrorCode, message: string, hint: string) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

async function whichBinary(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', [bin], { timeout: 3000 });
    const resolved = stdout.trim();
    return resolved || null;
  } catch {
    return null;
  }
}

/**
 * Ensures yt-dlp is available by checking PATH first, then the local managed
 * binary in tmp_storage/bin/yt-dlp, downloading the official standalone release
 * automatically if needed.
 */
export async function ensureYtDlpBinary(): Promise<string | null> {
  const sysPath = await whichBinary('yt-dlp');
  if (sysPath) return sysPath;

  if (fs.existsSync(MANAGED_YTDLP_PATH)) {
    try {
      await fsp.access(MANAGED_YTDLP_PATH, fs.constants.X_OK);
      return MANAGED_YTDLP_PATH;
    } catch {
      await fsp.chmod(MANAGED_YTDLP_PATH, 0o755).catch(() => {});
      return MANAGED_YTDLP_PATH;
    }
  }

  if (!ytDlpBootstrapPromise) {
    ytDlpBootstrapPromise = (async () => {
      try {
        await fsp.mkdir(BIN_DIR, { recursive: true });
        const res = await fetch(YTDLP_RELEASE_URL, {
          redirect: 'follow',
          headers: { 'User-Agent': 'ReelMaker/1.0' },
        });
        if (!res.ok || !res.body) {
          return null;
        }
        const tempPath = `${MANAGED_YTDLP_PATH}.tmp`;
        const nodeStream = Readable.fromWeb(
          res.body as unknown as import('node:stream/web').ReadableStream
        );
        await pipeline(nodeStream, fs.createWriteStream(tempPath));
        await fsp.chmod(tempPath, 0o755);
        await fsp.rename(tempPath, MANAGED_YTDLP_PATH);
        return MANAGED_YTDLP_PATH;
      } catch {
        return null;
      } finally {
        ytDlpBootstrapPromise = null;
      }
    })();
  }

  return ytDlpBootstrapPromise;
}

export function getYoutubeCookiesStatus(): {
  configured: boolean;
  source: 'env' | 'file' | 'none';
} {
  if (fs.existsSync(COOKIES_FILE_PATH)) {
    const stat = fs.statSync(COOKIES_FILE_PATH);
    if (stat.size > 0) {
      return { configured: true, source: 'file' };
    }
  }
  if ((process.env.YOUTUBE_COOKIES || '').trim().length > 0) {
    return { configured: true, source: 'env' };
  }
  return { configured: false, source: 'none' };
}

export async function saveYoutubeCookies(rawText: string): Promise<void> {
  const cleaned = rawText.trim();
  if (!cleaned || cleaned.length < 20) {
    throw new Error(
      'Cookies file looks empty. Export a Netscape cookies.txt file from YouTube in your browser.'
    );
  }
  await fsp.mkdir(path.dirname(COOKIES_FILE_PATH), { recursive: true });
  await fsp.writeFile(COOKIES_FILE_PATH, `${cleaned}\n`, 'utf8');
}

export async function clearYoutubeCookies(): Promise<void> {
  if (fs.existsSync(COOKIES_FILE_PATH)) {
    await fsp.unlink(COOKIES_FILE_PATH);
  }
}

async function resolveYoutubeCookiesPath(): Promise<string | undefined> {
  // Prefer cookies.txt uploaded via the UI so users can refresh expired env cookies
  if (fs.existsSync(COOKIES_FILE_PATH)) {
    const stat = fs.statSync(COOKIES_FILE_PATH);
    if (stat.size > 0) return COOKIES_FILE_PATH;
  }

  const envVal = (process.env.YOUTUBE_COOKIES || '').trim();
  if (envVal) {
    await fsp.mkdir(path.dirname(ENV_COOKIES_FILE_PATH), { recursive: true });
    // Support raw Netscape text, single-line escaped \n text, or base64-encoded cookies.txt
    const unescaped = envVal.includes('\\n')
      ? envVal.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t')
      : envVal;
    const decoded =
      unescaped.includes('youtube.com') || unescaped.includes('# Netscape')
        ? unescaped
        : Buffer.from(unescaped, 'base64').toString('utf8');
    await fsp.writeFile(ENV_COOKIES_FILE_PATH, `${decoded.trim()}\n`, 'utf8');
    return ENV_COOKIES_FILE_PATH;
  }

  return undefined;
}

export async function checkToolAvailability(): Promise<{
  ffmpeg: boolean;
  ffprobe: boolean;
  ytDlp: boolean;
  youtubeCookies: boolean;
}> {
  const [ffmpegPath, ffprobePath, ytDlpPath] = await Promise.all([
    whichBinary('ffmpeg'),
    whichBinary('ffprobe'),
    ensureYtDlpBinary(),
  ]);
  const cookies = getYoutubeCookiesStatus();
  return {
    ffmpeg: Boolean(ffmpegPath),
    ffprobe: Boolean(ffprobePath),
    ytDlp: Boolean(ytDlpPath),
    youtubeCookies: cookies.configured,
  };
}

export async function probeVideo(filePath: string): Promise<VideoProbeInfo> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filePath,
      ],
      { timeout: 30000 }
    );
    const parsed = JSON.parse(stdout);
    const streams: Array<{ codec_type?: string; width?: number; height?: number }> =
      parsed.streams ?? [];
    const videoStream = streams.find((s) => s.codec_type === 'video');
    const audioStream = streams.find((s) => s.codec_type === 'audio');
    const duration = Number(parsed.format?.duration ?? 0);

    if (!videoStream || !Number.isFinite(duration) || duration <= 0) {
      throw new MediaError(
        'PROCESSING_ERROR',
        'The file does not appear to contain a valid video track.',
        'Upload an MP4, MOV, or WebM video with playable video frames.'
      );
    }

    if (duration > MAX_VIDEO_DURATION_SECONDS) {
      throw new MediaError(
        'TOO_LONG',
        `Video is ${Math.round(duration / 60)} minutes long, which exceeds the 2-hour limit.`,
        'Trim your source video under 2 hours or upload a shorter segment.'
      );
    }

    return {
      duration,
      width: videoStream.width ?? 1280,
      height: videoStream.height ?? 720,
      hasAudio: Boolean(audioStream),
    };
  } catch (err) {
    if (err instanceof MediaError) throw err;
    throw new MediaError(
      'PROCESSING_ERROR',
      'Could not read video metadata with FFprobe.',
      'Ensure the file is a valid MP4, MOV, or WebM video.'
    );
  }
}

export function isPlatformVideoUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    return (
      host.includes('youtube.com') ||
      host.includes('youtu.be') ||
      host.includes('twitch.tv') ||
      host.includes('vimeo.com') ||
      host.includes('tiktok.com') ||
      host.includes('instagram.com') ||
      host.includes('x.com') ||
      host.includes('twitter.com')
    );
  } catch {
    return false;
  }
}

export async function downloadVideoFromUrl(
  rawUrl: string,
  destDir: string
): Promise<{ filePath: string; title: string }> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl.trim());
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error('Unsupported protocol');
    }
  } catch {
    throw new MediaError(
      'INVALID_URL',
      'Please enter a valid http:// or https:// video URL.',
      'Paste a YouTube link, Twitch VOD URL, or a direct .mp4 video link.'
    );
  }

  await fsp.mkdir(destDir, { recursive: true });

  if (isPlatformVideoUrl(rawUrl)) {
    const ytDlpBin = await ensureYtDlpBinary();
    if (!ytDlpBin) {
      throw new MediaError(
        'DOWNLOAD_BLOCKED',
        'Could not initialize yt-dlp on this server.',
        'Upload your video file directly, paste a direct .mp4 URL, or run the Sample Video.'
      );
    }

    const cookiesPath = await resolveYoutubeCookiesPath();
    const proxyUrl = (process.env.YTDLP_PROXY || '').trim();
    const outputTemplate = path.join(destDir, 'source.%(ext)s');

    const args: string[] = [
      '--js-runtimes',
      'node',
      '--no-playlist',
      '--no-warnings',
      '--max-filesize',
      '800M',
      '--match-filter',
      `!is_live & duration <= ${MAX_VIDEO_DURATION_SECONDS}`,
      '-f',
      'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
      '--merge-output-format',
      'mp4',
      '--print',
      'title',
      '--print',
      'after_move:filepath',
      '-o',
      outputTemplate,
    ];

    if (cookiesPath) {
      args.push('--cookies', cookiesPath);
    }
    if (proxyUrl) {
      args.push('--proxy', proxyUrl);
    }

    args.push(rawUrl.trim());

    try {
      const { stdout } = await execFileAsync(ytDlpBin, args, {
        timeout: 10 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const lines = stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const downloadedPath =
        lines.find((l) => fs.existsSync(l)) || path.join(destDir, 'source.mp4');
      const title =
        lines.find((l) => l !== downloadedPath) || parsedUrl.hostname;

      if (!fs.existsSync(downloadedPath)) {
        // Check if --match-filter skipped the video (e.g. currently live or > 2 hours)
        throw new MediaError(
          'TOO_LONG',
          'This video was skipped because it is currently live streaming or exceeds the 2-hour limit.',
          'Wait for the livestream to finish archiving (under 2 hours), or upload a trimmed MP4 file.'
        );
      }
      return { filePath: downloadedPath, title };
    } catch (err: unknown) {
      if (err instanceof MediaError) throw err;

      const stderr = String(
        (err as { stderr?: string; message?: string })?.stderr ??
          (err as { message?: string })?.message ??
          ''
      );

      if (/Sign in to confirm you.?re not a bot|bot/i.test(stderr)) {
        throw new MediaError(
          'BOT_CHECK',
          'YouTube requested bot verification for this cloud server IP.',
          cookiesPath
            ? 'Your saved YouTube cookies may have expired. Export a fresh cookies.txt file and retry, or upload the MP4 directly.'
            : 'Upload a YouTube cookies.txt file below (one-time setup) to unlock YouTube URLs on this server, or upload the MP4 file directly.'
        );
      }

      if (/This live event|is currently live|Premieres in/i.test(stderr)) {
        throw new MediaError(
          'LIVE_STREAM',
          'This video is an active livestream or upcoming premiere.',
          'Wait until the livestream finishes and becomes a VOD, or upload a recorded clip.'
        );
      }

      if (/private video|members-only|Sign in|login required/i.test(stderr)) {
        throw new MediaError(
          'PRIVATE_VIDEO',
          'This video is private, age-restricted, or members-only.',
          'Upload a YouTube cookies.txt file from an authorized account, make the video unlisted/public, or upload the MP4 directly.'
        );
      }

      if (/duration|too long|File is larger than max-filesize/i.test(stderr)) {
        throw new MediaError(
          'TOO_LONG',
          'This video exceeds the 2-hour length or 800MB size limit.',
          'Choose a shorter video or trim it locally and upload.'
        );
      }

      const errorLine =
        stderr
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.startsWith('ERROR:'))
          ?.replace(/^ERROR:\s*/i, '') ||
        'The platform blocked server-side video download.';

      throw new MediaError(
        'DOWNLOAD_BLOCKED',
        errorLine,
        'Upload your cookies.txt file if required by the site, upload the MP4 directly, or try the Sample Video.'
      );
    }
  }

  // Direct video URL streaming download
  const response = await fetch(parsedUrl.toString(), {
    redirect: 'follow',
    headers: { 'User-Agent': 'ReelMaker/1.0' },
  }).catch(() => {
    throw new MediaError(
      'DOWNLOAD_BLOCKED',
      'Could not reach that video URL.',
      'Check that the URL is publicly accessible or upload the file directly.'
    );
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new MediaError(
        'PRIVATE_VIDEO',
        `Access denied (HTTP ${response.status}) when fetching this video.`,
        'Ensure the video link is public or upload the video file directly.'
      );
    }
    throw new MediaError(
      'DOWNLOAD_BLOCKED',
      `Failed to download video (HTTP ${response.status}).`,
      'Double-check the direct video link or upload the MP4 file.'
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (
    !contentType.includes('video') &&
    !contentType.includes('octet-stream') &&
    !/\.(mp4|mov|webm|mkv|m4v)(\?|$)/i.test(parsedUrl.pathname)
  ) {
    throw new MediaError(
      'INVALID_URL',
      'This URL does not point directly to a playable video file.',
      'Paste a direct .mp4/.webm/.mov URL, or upload a video file from your device.'
    );
  }

  const destPath = path.join(destDir, 'source.mp4');
  if (!response.body) {
    throw new MediaError(
      'DOWNLOAD_BLOCKED',
      'Empty response body from video URL.',
      'Try another direct link or upload the file directly.'
    );
  }

  const nodeStream = Readable.fromWeb(
    response.body as unknown as import('node:stream/web').ReadableStream
  );
  await pipeline(nodeStream, fs.createWriteStream(destPath));

  const fileName = decodeURIComponent(
    path.basename(parsedUrl.pathname) || parsedUrl.hostname
  );
  return { filePath: destPath, title: fileName };
}

/**
 * Generates a real 72-second 1280x720 MP4 studio video via FFmpeg with animated
 * dual-host studio backdrop visuals, energy waveforms, and stereo audio peaks.
 */
export async function generateSampleStudioVideo(
  outputPath: string
): Promise<{ filePath: string; title: string }> {
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  const audioExpr =
    "0.16*sin(2*PI*210*t)+0.09*sin(2*PI*315*t)*(1+0.4*sin(2*PI*1.5*t))" +
    "+0.48*between(t,12,17)*sin(2*PI*520*t)*sin(2*PI*6*t)" +
    "+0.52*between(t,34,40)*sin(2*PI*460*t)*sin(2*PI*7*t)" +
    "+0.50*between(t,58,64)*sin(2*PI*580*t)*sin(2*PI*5*t)";

  const filterComplex = [
    `aevalsrc='${audioExpr}':s=44100:d=72[a]`,
    `color=c=#12141B:s=1280x720:r=24:d=72[bg]`,
    `[a]asplit=2[aout][avis]`,
    `[avis]showwaves=s=1280x320:mode=cline:rate=24:colors=#F5B700|#38BDF8[waves]`,
    `[bg][waves]overlay=0:200,drawbox=x=80:y=60:w=520:h=600:color=#1D2230@0.75:t=fill,drawbox=x=680:y=60:w=520:h=600:color=#231D28@0.75:t=fill,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='STUDIO CAM A  ·  HOST':fontcolor=white@0.85:fontsize=24:x=110:y=92,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='STUDIO CAM B  ·  GUEST':fontcolor=white@0.85:fontsize=24:x=710:y=92,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='LATE NIGHT PODCAST  ·  EP. 42':fontcolor=#F5B700@0.9:fontsize=20:x=110:y=612[v]`,
  ].join(';');

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-filter_complex',
      filterComplex,
      '-map',
      '[v]',
      '-map',
      '[aout]',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '26',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-movflags',
      '+faststart',
      '-t',
      '72',
      outputPath,
    ],
    { timeout: 60000 }
  );

  return {
    filePath: outputPath,
    title: 'Late Night Podcast Ep. 42 — Studio Session (Sample)',
  };
}

/**
 * Extracts compressed mono MP3 audio for Gemini transcription AND detects
 * real volume/laughter energy spikes across 1-second buckets using FFmpeg astats.
 */
export async function extractAudioAndSpikes(
  videoPath: string,
  workDir: string,
  duration: number
): Promise<{ audioPath: string; spikes: AudioSpike[] }> {
  const audioPath = path.join(workDir, 'audio.mp3');

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      videoPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-b:a',
      '32k',
      audioPath,
    ],
    { timeout: 120000 }
  );

  const spikes: AudioSpike[] = [];
  try {
    const { stderr } = await execFileAsync(
      'ffmpeg',
      [
        '-i',
        audioPath,
        '-af',
        'asetnsamples=16000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level',
        '-f',
        'null',
        '-',
      ],
      { timeout: 60000, maxBuffer: 8 * 1024 * 1024 }
    );

    const rmsValues: Array<{ time: number; db: number }> = [];
    const lines = stderr.split('\n');
    let currentTime = 0;

    for (const line of lines) {
      const ptsMatch = line.match(/pts_time:([\d.]+)/);
      if (ptsMatch) {
        currentTime = Number(ptsMatch[1]);
      }
      const rmsMatch = line.match(/lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+)/);
      if (rmsMatch) {
        const db = Number(rmsMatch[1]);
        if (Number.isFinite(db)) {
          rmsValues.push({ time: currentTime, db });
        }
      }
    }

    if (rmsValues.length > 2) {
      const avgDb =
        rmsValues.reduce((sum, item) => sum + item.db, 0) / rmsValues.length;
      const maxDb = Math.max(...rmsValues.map((r) => r.db));
      const spread = Math.max(4, maxDb - avgDb);

      for (const sample of rmsValues) {
        const delta = sample.db - avgDb;
        if (delta >= 2.8) {
          const normalized = Math.max(
            0.35,
            Math.min(1, 0.4 + (delta / spread) * 0.6)
          );
          const last = spikes[spikes.length - 1];
          if (!last || sample.time - last.time >= 2.0) {
            spikes.push({
              time: Number(sample.time.toFixed(1)),
              intensity: Number(normalized.toFixed(2)),
              label: normalized > 0.78 ? 'laughter' : 'volume-spike',
            });
          }
        }
      }
    }
  } catch {
    if (duration > 10) {
      spikes.push({
        time: Number((duration * 0.25).toFixed(1)),
        intensity: 0.72,
        label: 'volume-spike',
      });
    }
  }

  return { audioPath, spikes };
}

function escapeAssPathForFfmpeg(assFilePath: string): string {
  return assFilePath
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
}

export interface RenderClipOptions {
  sourceVideoPath: string;
  outputVideoPath: string;
  assOutputPath: string;
  start: number;
  end: number;
  layout: LayoutMode;
  includeCaptions: boolean;
  words: TranscriptWord[];
  customization: CaptionCustomization;
  hookTitle: string;
  showHookTitle: boolean;
}

/**
 * Cuts [start, end] from sourceVideoPath, reframes to 720x1280 (9:16) using the chosen layout,
 * and burns animated ASS captions directly into the output MP4 via FFmpeg libass.
 */
export async function renderVerticalClip(
  options: RenderClipOptions
): Promise<void> {
  const {
    sourceVideoPath,
    outputVideoPath,
    assOutputPath,
    start,
    end,
    layout,
    includeCaptions,
    words,
    customization,
    hookTitle,
    showHookTitle,
  } = options;

  const duration = Math.max(1.0, end - start);
  await fsp.mkdir(path.dirname(outputVideoPath), { recursive: true });

  let layoutGraph: string;
  if (layout === 'fit-blur') {
    layoutGraph =
      '[0:v]split=2[bgsrc][fgsrc];' +
      '[bgsrc]scale=180:320:force_original_aspect_ratio=increase,crop=180:320,boxblur=6:2,scale=720:1280,eq=brightness=-0.12[bg];' +
      '[fgsrc]scale=720:-2:force_original_aspect_ratio=decrease[fg];' +
      '[bg][fg]overlay=(W-w)/2:(H-h)/2[framed]';
  } else if (layout === 'split-screen') {
    layoutGraph =
      '[0:v]split=2[topsrc][botsrc];' +
      '[topsrc]crop=iw/2:ih:0:0,scale=720:640:force_original_aspect_ratio=increase,crop=720:640[top];' +
      '[botsrc]crop=iw/2:ih:iw/2:0,scale=720:640:force_original_aspect_ratio=increase,crop=720:640[bot];' +
      '[top][bot]vstack=inputs=2[framed]';
  } else {
    layoutGraph =
      '[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280[framed]';
  }

  let filterComplex = layoutGraph;
  let finalVideoMap = '[framed]';

  if (includeCaptions) {
    const assScript = generateAssSubtitles({
      words,
      clipStart: start,
      clipEnd: end,
      customization,
      hookTitle,
      showHookTitle,
      playResX: 720,
      playResY: 1280,
    });
    await fsp.writeFile(assOutputPath, assScript, 'utf8');
    const escapedAss = escapeAssPathForFfmpeg(assOutputPath);
    filterComplex = `${layoutGraph};[framed]ass='${escapedAss}'[vout]`;
    finalVideoMap = '[vout]';
  }

  const args = [
    '-y',
    '-ss',
    start.toFixed(2),
    '-t',
    duration.toFixed(2),
    '-i',
    sourceVideoPath,
    '-filter_complex',
    filterComplex,
    '-map',
    finalVideoMap,
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputVideoPath,
  ];

  await execFileAsync('ffmpeg', args, {
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

export async function cleanupExpiredJobs(
  storageRoot: string,
  maxAgeMs = SEVEN_DAYS_MS
): Promise<number> {
  if (!fs.existsSync(storageRoot)) return 0;
  const entries = await fsp.readdir(storageRoot, { withFileTypes: true });
  const now = Date.now();
  let removed = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(storageRoot, entry.name);
    try {
      const stat = await fsp.stat(fullPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        await fsp.rm(fullPath, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      // Ignore transient stat failures
    }
  }
  return removed;
}
