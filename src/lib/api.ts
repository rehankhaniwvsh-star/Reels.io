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

export class AuthRequiredError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export function apiUrl(endpoint: string): string {
  const clean = endpoint.replace(/^\/+/, '');
  if (typeof window === 'undefined') return `/${clean}`;
  const basePath = window.location.pathname.endsWith('/')
    ? window.location.pathname
    : window.location.pathname.replace(/\/[^/]*$/, '/');
  return `${window.location.origin}${basePath}${clean}`;
}

export function withPasscodeUrl(url: string): string {
  const resolved = /^https?:\/\//i.test(url) ? url : apiUrl(url);
  const pass = getSavedPasscode();
  if (!pass) return resolved;
  const sep = resolved.includes('?') ? '&' : '?';
  return `${resolved}${sep}passcode=${encodeURIComponent(pass)}`;
}

async function apiFetch(
  endpoint: string,
  init?: RequestInit
): Promise<Response> {
  const target = apiUrl(endpoint);
  let res = await fetch(target, init);

  // If the server is mid-restart or behind a warming proxy, retry once on transient non-JSON errors
  if (
    res.status === 404 ||
    res.status === 502 ||
    res.status === 503 ||
    res.status === 504
  ) {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      res = await fetch(target, init);
    }
  }
  return res;
}

async function handleJson<T>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 401 && data?.passwordRequired) {
      savePasscode('');
      throw new AuthRequiredError(
        typeof data?.error === 'string' ? data.error : 'Authentication required'
      );
    }
    if (typeof data?.error === 'string') {
      throw new Error(data.error);
    }
    if (res.status === 404) {
      throw new Error(
        'Backend server is temporarily unavailable (HTTP 404). Make sure you are on the live app URL (not a static export), then refresh and try again.'
      );
    }
    if (res.status === 413) {
      throw new Error(
        'Video upload exceeded the 32 MB proxy upload limit. Try a shorter clip or paste a direct video URL instead.'
      );
    }
    throw new Error(`Request failed (HTTP ${res.status})`);
  }
  return (data ?? {}) as T;
}

export async function getAuthStatus(): Promise<{ passwordRequired: boolean }> {
  const res = await apiFetch('/api/auth/status');
  return handleJson(res);
}

export async function verifyPasscode(passcode: string): Promise<boolean> {
  const res = await apiFetch('/api/auth/verify', {
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
  const res = await apiFetch('/api/health', { headers: authHeaders() });
  return handleJson(res);
}

export async function saveYoutubeCookiesApi(
  cookies: string
): Promise<{ ok: boolean; configured: boolean; source: string }> {
  const res = await apiFetch('/api/ytdlp/cookies', {
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
  const res = await apiFetch('/api/ytdlp/cookies', {
    method: 'DELETE',
    headers: authHeaders(),
  });
  return handleJson(res);
}

export async function fetchTemplates(): Promise<CaptionTemplate[]> {
  const res = await apiFetch('/api/templates', { headers: authHeaders() });
  const data = await handleJson<{ templates: CaptionTemplate[] }>(res);
  return data.templates;
}

export async function listJobs(): Promise<JobRecord[]> {
  const res = await apiFetch('/api/jobs', { headers: authHeaders() });
  const data = await handleJson<{ jobs: JobRecord[] }>(res);
  return data.jobs;
}

export async function getJob(jobId: string): Promise<JobRecord> {
  const res = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
    headers: authHeaders(),
  });
  const data = await handleJson<{ job: JobRecord }>(res);
  return data.job;
}

export async function deleteJob(jobId: string): Promise<void> {
  const res = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  await handleJson(res);
}

export async function startUrlJob(
  url: string,
  settings: ClipSettings
): Promise<JobRecord> {
  const res = await apiFetch('/api/jobs/url', {
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
  const res = await apiFetch('/api/jobs/upload', {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  const data = await handleJson<{ job: JobRecord }>(res);
  return data.job;
}

export async function startSampleJob(settings: ClipSettings): Promise<JobRecord> {
  const res = await apiFetch('/api/jobs/sample', {
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
  const res = await apiFetch(
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
