export type ClipCountOption = '3' | '5' | '10' | 'auto';
export type ClipLengthOption = '15-30' | '30-60' | '60-90';
export type StyleFocusOption = 'funny' | 'hype' | 'shocking' | 'wholesome' | 'mixed';
export type LayoutMode = 'fill' | 'fit-blur' | 'split-screen';
export type CaptionPosition = 'top' | 'middle' | 'bottom';
export type CaptionAnimation =
  | 'bounce'
  | 'pop'
  | 'highlight-box'
  | 'glow'
  | 'typewriter'
  | 'impact'
  | 'emoji-pop'
  | 'speaker-shift';

export interface CaptionTemplate {
  id: string;
  name: string;
  description: string;
  font: string;
  assFont: string;
  fontSize: number;
  primaryColor: string;
  accentColor: string;
  outlineColor: string;
  boxColor: string;
  position: CaptionPosition;
  animation: CaptionAnimation;
  wordsPerLine: number;
  uppercase: boolean;
  showEmoji: boolean;
  memeMode?: boolean;
  speakerColors?: Record<string, string>;
  sampleWords: Array<{ word: string; speaker?: string; isKeyword?: boolean }>;
}

export interface CaptionCustomization {
  templateId: string;
  font?: string;
  fontSize?: number;
  primaryColor?: string;
  accentColor?: string;
  outlineColor?: string;
  boxColor?: string;
  position?: CaptionPosition;
  animation?: CaptionAnimation;
  wordsPerLine?: number;
  uppercase?: boolean;
  showEmoji?: boolean;
}

export interface ClipSettings {
  clipCount: ClipCountOption;
  clipLength: ClipLengthOption;
  styleFocus: StyleFocusOption;
  templateId: string;
  layout: LayoutMode;
  includeCaptions: boolean;
}

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  speaker?: string;
  isKeyword?: boolean;
  emoji?: string;
}

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  speaker: string;
  text: string;
  words: TranscriptWord[];
  audioTag?: 'laughter' | 'applause' | 'gasp' | 'shouting' | 'spike';
}

export interface AudioSpike {
  time: number;
  intensity: number; // 0 to 1 normalized loudness spike
  label: 'laughter' | 'volume-spike' | 'reaction';
}

export interface MomentSignals {
  llmScore: number; // 0-100
  audioScore: number; // 0-100
  reactionScore: number; // 0-100
  pacingScore: number; // 0-100
}

export interface MomentCandidate {
  id: string;
  start: number;
  end: number;
  score: number; // 0-100 combined score
  reason: string;
  hookTitle: string;
  styleTag: StyleFocusOption;
  signals: MomentSignals;
}

export interface ClipItem {
  id: string;
  index: number;
  start: number;
  end: number;
  duration: number;
  score: number;
  reason: string;
  hookTitle: string;
  showHookTitle: boolean;
  styleTag: StyleFocusOption;
  signals: MomentSignals;
  layout: LayoutMode;
  captions: CaptionCustomization;
  words: TranscriptWord[];
  videoUrl: string;
  downloadUrl: string;
  renderStatus: 'ready' | 'rendering' | 'error';
  renderVersion: number;
  errorMessage?: string;
}

export type JobStageId =
  | 'downloading'
  | 'transcribing'
  | 'finding_moments'
  | 'cutting'
  | 'adding_captions'
  | 'done';

export interface JobStepStatus {
  id: JobStageId;
  label: string;
  status: 'pending' | 'active' | 'completed' | 'error';
  detail?: string;
}

export interface JobRecord {
  id: string;
  createdAt: string;
  expiresAt: string;
  sourceType: 'url' | 'upload' | 'sample';
  sourceLabel: string;
  sourceUrl?: string;
  videoDuration: number;
  videoWidth: number;
  videoHeight: number;
  settings: ClipSettings;
  status: 'queued' | 'processing' | 'completed' | 'error';
  currentStage: JobStageId;
  progress: number; // 0-100
  steps: JobStepStatus[];
  errorCode?:
    | 'PRIVATE_VIDEO'
    | 'BOT_CHECK'
    | 'LIVE_STREAM'
    | 'TOO_LONG'
    | 'DOWNLOAD_BLOCKED'
    | 'INVALID_URL'
    | 'AI_ERROR'
    | 'PROCESSING_ERROR';
  errorMessage?: string;
  errorHint?: string;
  transcript: TranscriptSegment[];
  audioSpikes: AudioSpike[];
  moments: MomentCandidate[];
  clips: ClipItem[];
}
