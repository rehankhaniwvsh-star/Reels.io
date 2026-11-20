import type {
  CaptionCustomization,
  CaptionTemplate,
  ClipItem,
  ClipSettings,
  JobRecord,
  LayoutMode,
  TranscriptWord,
} from '../shared/types';

const PASSCODE_STORAGE_KEY = 'reelmaker_passcode';

export function getSavedPasscode(): string {
  try {
    return window.sessionStorage.getItem(PASSCODE_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function savePasscode(passcode: string): void {
  try {
    if (passcode) {
      window.sessionStorage.setItem(PASSCODE_STORAGE_KEY, passcode);
    } else {
      window.sessionStorage.removeItem(PASSCODE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const pass = getSavedPasscode();
  return {
    ...(extra ?? {}),
    ...(pass ? { 'x-reelmaker-passcode': pass } : {}),
  };
}

export function withPasscodeUrl(url: string): string {
  const pass = getSavedPasscode();
  if (!pass) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}passcode=${encodeURIComponent(pass)}`;
}

async function handleJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof data?.error === 'string'
        ? data.error
        : `Request failed (HTTP ${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export async function getAuthStatus(): Promise<{ passwordRequired: boolean }> {
  const res = await fetch('/api/auth/status');
  return handleJson(res);
}

export async function verifyPasscode(passcode: string): Promise<boolean> {
  const res = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode }),
  });
  if (!res.ok) return false;
  savePasscode(passcode);
  return true;
}

export async function getHealth(): Promise<{
  status: string;
  tools: {
    ffmpeg: boolean;
    ffprobe: boolean;
    ytDlp: boolean;
    youtubeCookies: boolean;
  };
  maxDurationSeconds: number;
  retentionDays: number;
}> {
  const res = await fetch('/api/health', { headers: authHeaders() });
  return handleJson(res);
}

export async function saveYoutubeCookiesApi(
  cookies: string
): Promise<{ ok: boolean; configured: boolean; source: string }> {
  const res = await fetch('/api/ytdlp/cookies', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ cookies }),
  });
  return handleJson(res);
}

export async function clearYoutubeCookiesApi(): Promise<{
  ok: boolean;
  configured: boolean;
  source: string;
}> {
  const res = await fetch('/api/ytdlp/cookies', {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handleJson(res);
}

export async function fetchTemplates(): Promise<CaptionTemplate[]> {
  const res = await fetch('/api/templates', { headers: authHeaders() });
  const data = await handleJson<{ templates: CaptionTemplate[] }>(res);
  return data.templates;
}

export async function listJobs(): Promise<JobRecord[]> {
  const res = await fetch('/api/jobs', { headers: authHeaders() });
  const data = await handleJson<{ jobs: JobRecord[] }>(res);
  return data.jobs;
}

export async function getJob(jobId: string): Promise<JobRecord> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
    headers: authHeaders(),
  });
  const data = await handleJson<{ job: JobRecord }>(res);
  return data.job;
}

export async function deleteJob(jobId: string): Promise<void> {
  const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  await handleJson(res);
}

export async function startUrlJob(
  url: string,
  settings: ClipSettings
): Promise<JobRecord> {
  const res = await fetch('/api/jobs/url', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ url, settings }),
  });
  const data = await handleJson<{ job: JobRecord }>(res);
  return data.job;
}

export async function startUploadJob(
  file: File,
  settings: ClipSettings
): Promise<JobRecord> {
  const form = new FormData();
  form.append('video', file);
  form.append('settings', JSON.stringify(settings));
  const res = await fetch('/api/jobs/upload', {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  const data = await handleJson<{ job: JobRecord }>(res);
  return data.job;
}

export async function startSampleJob(settings: ClipSettings): Promise<JobRecord> {
  const res = await fetch('/api/jobs/sample', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ settings }),
  });
  const data = await handleJson<{ job: JobRecord }>(res);
  return data.job;
}

export async function regenerateClip(
  jobId: string,
  clipId: string,
  payload: {
    start: number;
    end: number;
    hookTitle: string;
    showHookTitle: boolean;
    layout: LayoutMode;
    captions: CaptionCustomization;
    words: TranscriptWord[];
    includeCaptions: boolean;
  }
): Promise<ClipItem> {
  const res = await fetch(
    `/api/jobs/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}/regenerate`,
    {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    }
  );
  const data = await handleJson<{ clip: ClipItem }>(res);
  return data.clip;
}

export function getZipDownloadUrl(jobId: string): string {
  return withPasscodeUrl(`/api/jobs/${encodeURIComponent(jobId)}/download-zip`);
}
