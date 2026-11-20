import type {
  AudioSpike,
  ClipCountOption,
  ClipLengthOption,
  MomentCandidate,
  StyleFocusOption,
  TranscriptSegment,
  TranscriptWord,
} from './types.ts';

export interface RawLLMMoment {
  start: number;
  end: number;
  llmScore: number;
  reason: string;
  hookTitle: string;
  styleTag?: StyleFocusOption;
}

const REACTION_PHRASES = [
  'no way',
  'bro',
  'what',
  'wait',
  'hold on',
  'are you serious',
  'shut up',
  'oh my god',
  'ain\'t no way',
  'dead',
  'crying',
  'gasp',
  'laugh',
  'hilarious',
  'insane',
  'wild',
  'stop',
  'excuse me',
];

export function getClipLengthBounds(option: ClipLengthOption): {
  min: number;
  max: number;
  target: number;
} {
  switch (option) {
    case '15-30':
      return { min: 15, max: 30, target: 22 };
    case '30-60':
      return { min: 30, max: 60, target: 42 };
    case '60-90':
      return { min: 60, max: 90, target: 72 };
  }
}

export function getTargetClipCount(
  option: ClipCountOption,
  videoDurationSeconds: number
): number {
  if (option === '3') return 3;
  if (option === '5') return 5;
  if (option === '10') return 10;
  // auto: scale gracefully with video duration (min 2, max 8)
  if (videoDurationSeconds <= 60) return 2;
  if (videoDurationSeconds <= 180) return 3;
  if (videoDurationSeconds <= 600) return 5;
  return 7;
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Scores reaction-worthy phrases ("no way", "bro", "what", "wait", gasps, exclamation cadence)
 * inside a transcript window [start, end].
 */
export function scoreReactionSignals(
  segments: TranscriptSegment[],
  start: number,
  end: number
): number {
  const windowSegments = segments.filter((s) => s.end > start && s.start < end);
  if (windowSegments.length === 0) return 20;

  let hits = 0;
  let audioTagBonus = 0;
  let punctuationHits = 0;

  for (const seg of windowSegments) {
    const lower = seg.text.toLowerCase();
    for (const phrase of REACTION_PHRASES) {
      if (lower.includes(phrase)) {
        hits += 1;
      }
    }
    if (seg.audioTag === 'laughter' || seg.audioTag === 'gasp' || seg.audioTag === 'shouting') {
      audioTagBonus += 18;
    } else if (seg.audioTag === 'applause' || seg.audioTag === 'spike') {
      audioTagBonus += 12;
    }
    const exclamations = (seg.text.match(/[!?]/g) ?? []).length;
    punctuationHits += exclamations;
  }

  return clampScore(32 + hits * 14 + audioTagBonus + Math.min(20, punctuationHits * 5));
}

/**
 * Scores audio excitement (laughter, applause, shouting, sudden volume spikes)
 * from FFmpeg-extracted AudioSpike events within [start, end].
 */
export function scoreAudioEnergy(
  spikes: AudioSpike[],
  start: number,
  end: number
): number {
  const inWindow = spikes.filter((s) => s.time >= start && s.time <= end);
  if (inWindow.length === 0) return 35;

  const maxIntensity = Math.max(...inWindow.map((s) => s.intensity));
  const avgIntensity =
    inWindow.reduce((sum, s) => sum + s.intensity, 0) / inWindow.length;
  const densityBonus = Math.min(20, inWindow.length * 6);

  return clampScore(35 + maxIntensity * 35 + avgIntensity * 15 + densityBonus);
}

/**
 * Scores pacing: rewards strong spoken density, strong hook within first 2 seconds,
 * and penalizes dead air or slow intros.
 */
export function scorePacing(
  words: TranscriptWord[],
  start: number,
  end: number
): number {
  const duration = Math.max(1, end - start);
  const windowWords = words.filter((w) => w.end > start && w.start < end);
  if (windowWords.length === 0) return 15;

  const firstWordDelay = Math.max(0, windowWords[0].start - start);
  const hookBonus = firstWordDelay <= 1.2 ? 22 : firstWordDelay <= 2.0 ? 14 : -15;

  // Measure longest dead-air gap inside clip
  let maxGap = firstWordDelay;
  for (let i = 1; i < windowWords.length; i += 1) {
    const gap = windowWords[i].start - windowWords[i - 1].end;
    if (gap > maxGap) maxGap = gap;
  }
  const deadAirPenalty = maxGap > 3.5 ? 25 : maxGap > 2.2 ? 12 : 0;

  const wordsPerSecond = windowWords.length / duration;
  const paceScore = wordsPerSecond >= 2.1 && wordsPerSecond <= 4.2 ? 72 : wordsPerSecond >= 1.4 ? 58 : 42;

  return clampScore(paceScore + hookBonus - deadAirPenalty);
}

/**
 * Trims leading dead air so the clip hits its spoken hook within the first 2 seconds,
 * and snaps start/end to clean sentence/segment boundaries (never mid-word).
 */
export function snapToSentenceBoundariesAndHook(
  rawStart: number,
  rawEnd: number,
  segments: TranscriptSegment[],
  videoDuration: number
): { start: number; end: number } {
  if (segments.length === 0) {
    return {
      start: Math.max(0, rawStart),
      end: Math.min(videoDuration, Math.max(rawStart + 1, rawEnd)),
    };
  }

  // Find first segment overlapping or starting near rawStart
  let startIdx = segments.findIndex((s) => s.end > rawStart + 0.25);
  if (startIdx === -1) startIdx = 0;

  // Find last segment ending near rawEnd
  let endIdx = startIdx;
  for (let i = startIdx; i < segments.length; i += 1) {
    if (segments[i].start < rawEnd - 0.25) {
      endIdx = i;
    } else {
      break;
    }
  }

  const startSeg = segments[startIdx];
  const endSeg = segments[endIdx];

  // Lead-in: snap to sentence boundary, ensuring first spoken word hits within <= 0.35s (well inside 2s hook rule)
  const firstWordStart =
    startSeg.words.length > 0 ? startSeg.words[0].start : startSeg.start;
  const snappedStart = Math.max(0, Math.max(startSeg.start, firstWordStart - 0.2));

  // Tail: include complete final word + slight breath room for laugh/payoff
  const lastWordEnd =
    endSeg.words.length > 0
      ? endSeg.words[endSeg.words.length - 1].end
      : endSeg.end;
  const snappedEnd = Math.min(
    videoDuration,
    Math.max(snappedStart + 1.5, Math.max(endSeg.end, lastWordEnd) + 0.25)
  );

  return {
    start: Number(snappedStart.toFixed(2)),
    end: Number(snappedEnd.toFixed(2)),
  };
}

/**
 * Combines LLM transcript analysis, audio energy spikes, reaction detection, and pacing
 * into a unified 0-100 score, enforces sentence boundaries + <2s hook + non-overlapping clips,
 * and returns top ranked MomentCandidates.
 */
export function selectRankedMoments(params: {
  rawCandidates: RawLLMMoment[];
  segments: TranscriptSegment[];
  audioSpikes: AudioSpike[];
  videoDuration: number;
  clipCount: ClipCountOption;
  clipLength: ClipLengthOption;
  styleFocus: StyleFocusOption;
}): MomentCandidate[] {
  const {
    rawCandidates,
    segments,
    audioSpikes,
    videoDuration,
    clipCount,
    clipLength,
    styleFocus,
  } = params;

  const allWords = segments.flatMap((s) => s.words);
  const targetCount = getTargetClipCount(clipCount, videoDuration);
  const bounds = getClipLengthBounds(clipLength);

  // If rawCandidates is empty (e.g. very short video), build sliding window fallbacks over segments
  const sourceCandidates: RawLLMMoment[] =
    rawCandidates.length > 0
      ? rawCandidates
      : buildHeuristicCandidates(segments, audioSpikes, videoDuration, bounds.target, styleFocus);

  const scored: MomentCandidate[] = sourceCandidates.map((cand, idx) => {
    const snapped = snapToSentenceBoundariesAndHook(
      cand.start,
      cand.end,
      segments,
      videoDuration
    );

    const llmScore = clampScore(cand.llmScore);
    const audioScore = scoreAudioEnergy(audioSpikes, snapped.start, snapped.end);
    const reactionScore = scoreReactionSignals(segments, snapped.start, snapped.end);
    const pacingScore = scorePacing(allWords, snapped.start, snapped.end);

    // Weighted fusion: LLM comedy/storytelling (45%), Audio energy (22%), Reactions (20%), Pacing (13%)
    let combined =
      llmScore * 0.45 +
      audioScore * 0.22 +
      reactionScore * 0.2 +
      pacingScore * 0.13;

    // Slight bonus if candidate matches requested style focus
    if (styleFocus !== 'mixed' && cand.styleTag === styleFocus) {
      combined += 4;
    }

    return {
      id: `moment-${idx + 1}`,
      start: snapped.start,
      end: snapped.end,
      score: clampScore(combined),
      reason: cand.reason.trim() || 'High-energy reaction and strong punchline payoff',
      hookTitle: cand.hookTitle.trim() || 'Wait for the ending...',
      styleTag: cand.styleTag ?? (styleFocus === 'mixed' ? 'funny' : styleFocus),
      signals: {
        llmScore,
        audioScore,
        reactionScore,
        pacingScore,
      },
    };
  });

  // Sort descending by score, then greedy non-overlapping selection
  scored.sort((a, b) => b.score - a.score);

  const selected: MomentCandidate[] = [];
  for (const candidate of scored) {
    if (selected.length >= targetCount) break;
    const overlaps = selected.some(
      (existing) =>
        candidate.start < existing.end - 0.5 && candidate.end > existing.start + 0.5
    );
    if (!overlaps && candidate.end - candidate.start >= 3) {
      selected.push(candidate);
    }
  }

  return selected.map((m, i) => ({
    ...m,
    id: `clip-${i + 1}`,
  }));
}

function buildHeuristicCandidates(
  segments: TranscriptSegment[],
  audioSpikes: AudioSpike[],
  videoDuration: number,
  targetLength: number,
  styleFocus: StyleFocusOption
): RawLLMMoment[] {
  if (segments.length === 0) return [];
  const results: RawLLMMoment[] = [];
  const windowDuration = Math.min(targetLength, Math.max(8, videoDuration / 2));

  let cursor = 0;
  let idx = 0;
  while (cursor < videoDuration - 4 && idx < 12) {
    const end = Math.min(videoDuration, cursor + windowDuration);
    const reaction = scoreReactionSignals(segments, cursor, end);
    const audio = scoreAudioEnergy(audioSpikes, cursor, end);
    const segInWindow = segments.find((s) => s.start >= cursor && s.start < end);
    results.push({
      start: cursor,
      end,
      llmScore: clampScore((reaction + audio) / 2 + 10),
      reason: segInWindow?.audioTag
        ? `Strong ${segInWindow.audioTag} peak right after setup`
        : 'Fast-paced conversational highlight with crisp payoff',
      hookTitle: segInWindow
        ? segInWindow.text.split(' ').slice(0, 6).join(' ')
        : `Highlight #${idx + 1}`,
      styleTag: styleFocus === 'mixed' ? 'funny' : styleFocus,
    });
    cursor += Math.max(6, windowDuration * 0.85);
    idx += 1;
  }
  return results;
}

export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
