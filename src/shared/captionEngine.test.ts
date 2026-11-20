import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTION_TEMPLATES,
  buildCaptionChunks,
  generateAssSubtitles,
  formatAssTime,
  hexToAssColor,
  isKeywordWord,
  getEmojiForWord,
} from './captionEngine';
import type { TranscriptWord } from './types';

const SAMPLE_WORDS: TranscriptWord[] = [
  { word: 'Wait,', start: 10.1, end: 10.5, speaker: 'Host' },
  { word: 'no', start: 10.5, end: 10.7, speaker: 'Host' },
  { word: 'way', start: 10.7, end: 11.1, speaker: 'Host' },
  { word: 'bro', start: 11.2, end: 11.5, speaker: 'Guest' },
  { word: 'I', start: 11.6, end: 11.8, speaker: 'Guest' },
  { word: 'died', start: 11.8, end: 12.2, speaker: 'Guest' },
  { word: 'laughing!', start: 12.2, end: 12.9, speaker: 'Guest' },
];

test('all 8 required JSON caption templates are loaded with valid metadata', () => {
  assert.ok(CAPTION_TEMPLATES.length >= 8, `expected >= 8 templates, got ${CAPTION_TEMPLATES.length}`);
  const ids = new Set(CAPTION_TEMPLATES.map((t) => t.id));
  const required = [
    'karaoke-pop',
    'bold-minimal',
    'boxed-highlight',
    'neon-glow',
    'typewriter',
    'meme-style',
    'emoji-auto',
    'speaker-colors',
  ];
  for (const id of required) {
    assert.ok(ids.has(id), `missing required template: ${id}`);
  }
});

test('hexToAssColor converts RGB hex to ASS BGR format', () => {
  assert.equal(hexToAssColor('#FFE033'), '&H0033E0FF');
  assert.equal(hexToAssColor('#E11D48', '30'), '&H30481DE1');
});

test('formatAssTime outputs H:MM:SS.cs format', () => {
  assert.equal(formatAssTime(0), '0:00:00.00');
  assert.equal(formatAssTime(65.43), '0:01:05.43');
});

test('keyword detection and emoji mapping identify trigger words', () => {
  assert.equal(isKeywordWord('way'), true);
  assert.equal(isKeywordWord('laughing!'), true);
  assert.equal(getEmojiForWord('laughing!'), '😂');
  assert.equal(getEmojiForWord('died'), '💀');
});

test('buildCaptionChunks normalizes clip-relative timestamps and respects wordsPerLine', () => {
  const chunks = buildCaptionChunks(SAMPLE_WORDS, 10.0, 15.0, 3);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].words.length, 3);
  assert.ok(chunks[0].start >= 0 && chunks[0].start < 0.2);
});

test('generateAssSubtitles produces valid ASS script across all 8 templates with hook banner and emoji toggle', () => {
  for (const tpl of CAPTION_TEMPLATES) {
    const ass = generateAssSubtitles({
      words: SAMPLE_WORDS,
      clipStart: 10.0,
      clipEnd: 15.0,
      customization: {
        templateId: tpl.id,
        showEmoji: tpl.id === 'emoji-auto',
      },
      hookTitle: 'Wait for the roast',
      showHookTitle: true,
    });

    assert.ok(ass.includes('[Script Info]'), `${tpl.id}: missing Script Info`);
    assert.ok(ass.includes('[V4+ Styles]'), `${tpl.id}: missing V4+ Styles`);
    assert.ok(ass.includes('[Events]'), `${tpl.id}: missing Events`);
    assert.ok(ass.includes('Dialogue:'), `${tpl.id}: missing Dialogue lines`);

    if (tpl.id === 'emoji-auto') {
      assert.ok(ass.includes('😂') || ass.includes('💀'), 'emoji-auto should inject emojis');
    }
    if (tpl.id === 'meme-style') {
      assert.ok(ass.includes('WAIT FOR THE ROAST'), 'meme-style should render uppercase hook banner');
    }
  }
});
