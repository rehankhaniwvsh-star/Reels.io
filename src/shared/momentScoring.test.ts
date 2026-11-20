import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreReactionSignals,
  scoreAudioEnergy,
  scorePacing,
  snapToSentenceBoundariesAndHook,
  selectRankedMoments,
  formatTimecode,
} from './momentScoring';
import type { AudioSpike, TranscriptSegment } from './types';

const SAMPLE_SEGMENTS: TranscriptSegment[] = [
  {
    id: 'seg-1',
    start: 2.0,
    end: 9.0,
    speaker: 'Host',
    text: 'Wait, no way he actually tried to cook pasta in a coffee maker!',
    audioTag: 'laughter',
    words: [
      { word: 'Wait,', start: 2.2, end: 2.6, speaker: 'Host' },
      { word: 'no', start: 2.7, end: 2.9, speaker: 'Host' },
      { word: 'way', start: 3.0, end: 3.3, speaker: 'Host' },
      { word: 'he', start: 3.4, end: 3.6, speaker: 'Host' },
      { word: 'actually', start: 3.7, end: 4.3, speaker: 'Host' },
      { word: 'tried', start: 4.4, end: 4.8, speaker: 'Host' },
      { word: 'to', start: 4.9, end: 5.1, speaker: 'Host' },
      { word: 'cook', start: 5.2, end: 5.6, speaker: 'Host' },
      { word: 'pasta', start: 5.7, end: 6.2, speaker: 'Host' },
      { word: 'in', start: 6.3, end: 6.5, speaker: 'Host' },
      { word: 'a', start: 6.6, end: 6.8, speaker: 'Host' },
      { word: 'coffee', start: 6.9, end: 7.4, speaker: 'Host' },
      { word: 'maker!', start: 7.5, end: 8.6, speaker: 'Host' },
    ],
  },
  {
    id: 'seg-2',
    start: 10.0,
    end: 20.0,
    speaker: 'Guest',
    text: 'Bro I was completely broke in college and it tasted like espresso marinara.',
    audioTag: 'laughter',
    words: [
      { word: 'Bro', start: 10.2, end: 10.6, speaker: 'Guest' },
      { word: 'I', start: 10.7, end: 10.9, speaker: 'Guest' },
      { word: 'was', start: 11.0, end: 11.3, speaker: 'Guest' },
      { word: 'completely', start: 11.4, end: 12.1, speaker: 'Guest' },
      { word: 'broke', start: 12.2, end: 12.7, speaker: 'Guest' },
      { word: 'in', start: 12.8, end: 13.0, speaker: 'Guest' },
      { word: 'college', start: 13.1, end: 13.8, speaker: 'Guest' },
      { word: 'and', start: 13.9, end: 14.2, speaker: 'Guest' },
      { word: 'it', start: 14.3, end: 14.6, speaker: 'Guest' },
      { word: 'tasted', start: 14.7, end: 15.3, speaker: 'Guest' },
      { word: 'like', start: 15.4, end: 15.8, speaker: 'Guest' },
      { word: 'espresso', start: 15.9, end: 16.8, speaker: 'Guest' },
      { word: 'marinara.', start: 16.9, end: 18.2, speaker: 'Guest' },
    ],
  },
  {
    id: 'seg-3',
    start: 28.0,
    end: 42.0,
    speaker: 'Host',
    text: 'Hold on, the landlord walked in right when the smoke alarm went off.',
    audioTag: 'gasp',
    words: [
      { word: 'Hold', start: 28.2, end: 28.6, speaker: 'Host' },
      { word: 'on,', start: 28.7, end: 29.0, speaker: 'Host' },
      { word: 'the', start: 29.1, end: 29.3, speaker: 'Host' },
      { word: 'landlord', start: 29.4, end: 30.1, speaker: 'Host' },
      { word: 'walked', start: 30.2, end: 30.7, speaker: 'Host' },
      { word: 'in', start: 30.8, end: 31.1, speaker: 'Host' },
      { word: 'right', start: 31.2, end: 31.6, speaker: 'Host' },
      { word: 'when', start: 31.7, end: 32.1, speaker: 'Host' },
      { word: 'the', start: 32.2, end: 32.5, speaker: 'Host' },
      { word: 'smoke', start: 32.6, end: 33.2, speaker: 'Host' },
      { word: 'alarm', start: 33.3, end: 34.0, speaker: 'Host' },
      { word: 'went', start: 34.1, end: 34.6, speaker: 'Host' },
      { word: 'off.', start: 34.7, end: 35.4, speaker: 'Host' },
    ],
  },
];

const SAMPLE_SPIKES: AudioSpike[] = [
  { time: 8.5, intensity: 0.92, label: 'laughter' },
  { time: 17.5, intensity: 0.88, label: 'laughter' },
  { time: 35.0, intensity: 0.78, label: 'reaction' },
];

test('reaction detection scores high when reaction phrases and laughter tags appear', () => {
  const high = scoreReactionSignals(SAMPLE_SEGMENTS, 2, 20);
  const empty = scoreReactionSignals(SAMPLE_SEGMENTS, 50, 60);
  assert.ok(high >= 75, `expected high reaction score >= 75, got ${high}`);
  assert.equal(empty, 20);
});

test('audio energy scoring rewards loudness spikes inside window', () => {
  const hot = scoreAudioEnergy(SAMPLE_SPIKES, 2, 20);
  const quiet = scoreAudioEnergy(SAMPLE_SPIKES, 45, 55);
  assert.ok(hot > quiet + 30, `expected hot (${hot}) >> quiet (${quiet})`);
});

test('pacing penalizes slow dead-air intros and rewards immediate hooks', () => {
  const words = SAMPLE_SEGMENTS[0].words;
  const tightHook = scorePacing(words, 2.0, 9.0);
  const slowIntro = scorePacing(words, 0.0, 9.0);
  assert.ok(tightHook > slowIntro, `tight hook (${tightHook}) should beat slow intro (${slowIntro})`);
});

test('sentence boundary snapping trims leading dead air so hook starts within 2 seconds', () => {
  const snapped = snapToSentenceBoundariesAndHook(0.0, 19.0, SAMPLE_SEGMENTS, 60);
  assert.ok(snapped.start >= 2.0 && snapped.start <= 2.2, `expected start near 2.0s, got ${snapped.start}`);
  assert.ok(snapped.end >= 20.0, `expected end snapped to full segment boundary, got ${snapped.end}`);
});

test('selectRankedMoments enforces non-overlapping clips and sorts by combined score', () => {
  const moments = selectRankedMoments({
    rawCandidates: [
      {
        start: 1.5,
        end: 19.5,
        llmScore: 92,
        reason: 'Big laugh after coffee maker pasta punchline',
        hookTitle: 'Pasta in a coffee maker?!',
        styleTag: 'funny',
      },
      {
        // Overlapping duplicate candidate with lower score — must be filtered out
        start: 5.0,
        end: 18.0,
        llmScore: 70,
        reason: 'Overlapping slice',
        hookTitle: 'Duplicate slice',
        styleTag: 'funny',
      },
      {
        start: 27.5,
        end: 41.5,
        llmScore: 84,
        reason: 'Unexpected landlord twist and smoke alarm panic',
        hookTitle: 'The landlord walked in right then',
        styleTag: 'shocking',
      },
    ],
    segments: SAMPLE_SEGMENTS,
    audioSpikes: SAMPLE_SPIKES,
    videoDuration: 45,
    clipCount: '3',
    clipLength: '15-30',
    styleFocus: 'funny',
  });

  assert.equal(moments.length, 2, 'should reject overlapping candidate and keep 2 distinct clips');
  assert.ok(moments[0].score >= moments[1].score, 'clips should be sorted descending by score');
  assert.ok(moments[0].end <= moments[1].start + 0.5, 'selected clips must not overlap');
});

test('formatTimecode renders MM:SS cleanly', () => {
  assert.equal(formatTimecode(0), '00:00');
  assert.equal(formatTimecode(65), '01:05');
  assert.equal(formatTimecode(125.8), '02:05');
});
