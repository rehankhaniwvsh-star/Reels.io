import rawTemplates from './captionTemplates.json' with { type: 'json' };
import type {
  CaptionCustomization,
  CaptionPosition,
  CaptionTemplate,
  TranscriptWord,
} from './types.ts';

export const CAPTION_TEMPLATES: CaptionTemplate[] = rawTemplates as CaptionTemplate[];

export function getTemplateById(templateId: string): CaptionTemplate {
  return (
    CAPTION_TEMPLATES.find((tpl) => tpl.id === templateId) ?? CAPTION_TEMPLATES[0]
  );
}

export function resolveCaptionConfig(
  customization: CaptionCustomization
): CaptionTemplate {
  const base = getTemplateById(customization.templateId);
  return {
    ...base,
    font: customization.font ?? base.font,
    fontSize: customization.fontSize ?? base.fontSize,
    primaryColor: customization.primaryColor ?? base.primaryColor,
    accentColor: customization.accentColor ?? base.accentColor,
    outlineColor: customization.outlineColor ?? base.outlineColor,
    boxColor: customization.boxColor ?? base.boxColor,
    position: customization.position ?? base.position,
    animation: customization.animation ?? base.animation,
    wordsPerLine: customization.wordsPerLine ?? base.wordsPerLine,
    uppercase: customization.uppercase ?? base.uppercase,
    showEmoji: customization.showEmoji ?? base.showEmoji,
  };
}

const KEYWORD_SET = new Set([
  'no',
  'way',
  'bro',
  'what',
  'wait',
  'insane',
  'crazy',
  'hilarious',
  'laughing',
  'roast',
  'roasted',
  'exposed',
  'shocking',
  'unreal',
  'never',
  'actually',
  'died',
  'fire',
  'wild',
  'genius',
  'twist',
  'plot',
  'secret',
  'million',
  'billion',
  'seriously',
  'stop',
  'dead',
  'legend',
  'cooked',
  'punchline',
  'broken',
  'live',
]);

const EMOJI_MAP: Record<string, string> = {
  laugh: '😂',
  laughing: '😂',
  funny: '😂',
  hilarious: '🤣',
  died: '💀',
  dead: '💀',
  bro: '😭',
  wait: '😳',
  what: '🤯',
  insane: '🤯',
  crazy: '🤯',
  shocking: '😱',
  fire: '🔥',
  roast: '🔥',
  roasted: '🔥',
  cooked: '🔥',
  money: '💸',
  million: '💰',
  billion: '💰',
  love: '❤️',
  wholesome: '🥹',
  clap: '👏',
  applause: '👏',
  stop: '🛑',
  secret: '🤫',
  exposed: '👀',
  look: '👀',
  twist: '🌀',
  win: '🏆',
  legend: '👑',
  mic: '🎙️',
  fail: '😬',
  awkward: '😬',
};

export function normalizeWordToken(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isKeywordWord(word: string): boolean {
  const token = normalizeWordToken(word);
  return KEYWORD_SET.has(token) || word.endsWith('!') || word.endsWith('?');
}

export function getEmojiForWord(word: string): string | undefined {
  const token = normalizeWordToken(word);
  return EMOJI_MAP[token];
}

export interface CaptionChunk {
  start: number;
  end: number;
  speaker: string;
  words: TranscriptWord[];
}

/**
 * Splits a clip's words into timed chunks of at most `wordsPerLine` words,
 * clipping relative timestamps into [0, clipDuration].
 */
export function buildCaptionChunks(
  words: TranscriptWord[],
  clipStart: number,
  clipEnd: number,
  wordsPerLine: number
): CaptionChunk[] {
  const safePerLine = Math.max(1, Math.min(8, Math.round(wordsPerLine || 3)));
  const clipDuration = Math.max(0.5, clipEnd - clipStart);

  const relativeWords = words
    .filter((w) => w.end > clipStart && w.start < clipEnd && w.word.trim().length > 0)
    .map((w) => ({
      ...w,
      start: Math.max(0, w.start - clipStart),
      end: Math.min(clipDuration, Math.max(w.start - clipStart + 0.08, w.end - clipStart)),
      isKeyword: w.isKeyword ?? isKeywordWord(w.word),
      emoji: w.emoji ?? getEmojiForWord(w.word),
    }));

  const chunks: CaptionChunk[] = [];
  for (let i = 0; i < relativeWords.length; i += safePerLine) {
    const slice = relativeWords.slice(i, i + safePerLine);
    if (slice.length === 0) continue;
    chunks.push({
      start: slice[0].start,
      end: slice[slice.length - 1].end,
      speaker: slice[0].speaker ?? 'Host',
      words: slice,
    });
  }
  return chunks;
}

/**
 * Converts a CSS hex color (#RRGGBB) to ASS BGR hex format (&H00BBGGRR&).
 */
export function hexToAssColor(hex: string, alphaHex = '00'): string {
  const clean = hex.replace('#', '').trim();
  if (clean.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(clean)) {
    return `&H${alphaHex}FFFFFF`;
  }
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H${alphaHex}${b}${g}${r}`.toUpperCase();
}

/**
 * Formats seconds to ASS timestamp `H:MM:SS.cs` (centiseconds).
 */
export function formatAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const totalCs = Math.round(clamped * 100);
  const cs = totalCs % 100;
  const totalSeconds = Math.floor(totalCs / 100);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);

  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

function positionToAlignment(pos: CaptionPosition): { alignment: number; marginV: number } {
  switch (pos) {
    case 'top':
      return { alignment: 8, marginV: 180 };
    case 'middle':
      return { alignment: 5, marginV: 60 };
    case 'bottom':
    default:
      return { alignment: 2, marginV: 210 };
  }
}

export function getSpeakerColor(
  template: CaptionTemplate,
  speaker?: string
): string {
  const palette = template.speakerColors ?? {
    Host: '#F5B700',
    Guest: '#38BDF8',
    'Speaker A': '#F5B700',
    'Speaker B': '#38BDF8',
    'Speaker C': '#FB7185',
  };
  if (speaker && palette[speaker]) {
    return palette[speaker];
  }
  const values = Object.values(palette);
  if (!speaker || values.length === 0) return template.primaryColor;
  let hash = 0;
  for (let i = 0; i < speaker.length; i += 1) {
    hash = (hash * 31 + speaker.charCodeAt(i)) % values.length;
  }
  return values[Math.abs(hash) % values.length];
}

export interface GenerateAssOptions {
  words: TranscriptWord[];
  clipStart: number;
  clipEnd: number;
  customization: CaptionCustomization;
  hookTitle?: string;
  showHookTitle?: boolean;
  playResX?: number;
  playResY?: number;
}

/**
 * Generates a full ASS (Advanced SubStation Alpha) subtitle script for FFmpeg libass burn-in.
 */
export function generateAssSubtitles(options: GenerateAssOptions): string {
  const {
    words,
    clipStart,
    clipEnd,
    customization,
    hookTitle,
    showHookTitle = true,
    playResX = 720,
    playResY = 1280,
  } = options;

  const tpl = resolveCaptionConfig(customization);
  const clipDuration = Math.max(0.5, clipEnd - clipStart);
  const chunks = buildCaptionChunks(words, clipStart, clipEnd, tpl.wordsPerLine);

  const primaryAss = hexToAssColor(tpl.primaryColor);
  const accentAss = hexToAssColor(tpl.accentColor);
  const outlineAss = hexToAssColor(tpl.outlineColor);
  const backAss =
    tpl.boxColor && tpl.boxColor !== 'transparent'
      ? hexToAssColor(tpl.boxColor, '30')
      : '&H80000000';

  const borderStyle = tpl.animation === 'highlight-box' ? 3 : 1;
  const outlineSize =
    tpl.animation === 'glow' ? 5 : tpl.animation === 'impact' ? 6 : 4;
  const shadowSize = tpl.animation === 'glow' ? 0 : 2;
  const { alignment, marginV } = positionToAlignment(tpl.position);
  const scaledFontSize = Math.round((tpl.fontSize / 54) * 58);

  const header = [
    '[Script Info]',
    'Title: ReelMaker Captions',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${tpl.assFont},${scaledFontSize},${primaryAss},${accentAss},${outlineAss},${backAss},-1,0,0,0,100,100,0,0,${borderStyle},${outlineSize},${shadowSize},${alignment},44,44,${marginV},1`,
    `Style: MemeTop,Liberation Sans Narrow,60,&H00FFFFFF,&H0033E0FF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,6,2,8,36,36,96,1`,
    `Style: HookBanner,Liberation Sans,40,&H00100D0C,&H00100D0C,&H0000B7F5,&H0000B7F5,-1,0,0,0,100,100,0,0,3,12,0,8,48,48,88,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events: string[] = [];

  // Optional Hook Title Banner in the first 3.5 seconds (or full clip for Meme Style)
  if (showHookTitle && hookTitle && hookTitle.trim().length > 0) {
    const cleanHook = escapeAssText(
      tpl.memeMode ? hookTitle.trim().toUpperCase() : hookTitle.trim()
    );
    const hookEnd = tpl.memeMode ? clipDuration : Math.min(clipDuration, 3.8);
    const styleName = tpl.memeMode ? 'MemeTop' : 'HookBanner';
    events.push(
      `Dialogue: 2,${formatAssTime(0)},${formatAssTime(hookEnd)},${styleName},,0,0,0,,{\\fad(120,220)}${cleanHook}`
    );
  }

  for (const chunk of chunks) {
    for (let activeIdx = 0; activeIdx < chunk.words.length; activeIdx += 1) {
      const activeWord = chunk.words[activeIdx];
      const nextWord = chunk.words[activeIdx + 1];
      const segStart = activeWord.start;
      const segEnd = nextWord ? Math.max(activeWord.end, nextWord.start) : chunk.end;

      // For typewriter, only display words revealed up to activeIdx
      const visibleWords =
        tpl.animation === 'typewriter'
          ? chunk.words.slice(0, activeIdx + 1)
          : chunk.words;

      const renderedTokens = visibleWords.map((w, idx) => {
        const displayRaw = tpl.uppercase ? w.word.toUpperCase() : w.word;
        const safeText = escapeAssText(displayRaw);
        const emojiSuffix =
          tpl.showEmoji && w.emoji ? ` ${w.emoji}` : '';

        const isActive = idx === activeIdx;
        const speakerHex =
          tpl.animation === 'speaker-shift'
            ? getSpeakerColor(tpl, w.speaker)
            : tpl.primaryColor;
        const baseColor = w.isKeyword
          ? hexToAssColor(tpl.accentColor)
          : hexToAssColor(speakerHex);

        if (isActive) {
          const activeColor = hexToAssColor(tpl.accentColor);
          if (tpl.animation === 'bounce') {
            return `{\\1c${activeColor}\\fscx114\\fscy114\\t(0,140,\\fscx100\\fscy100)}${safeText}${emojiSuffix}{\\rCaption}`;
          }
          if (tpl.animation === 'highlight-box') {
            const boxOutline = hexToAssColor(tpl.boxColor || '#E11D48');
            return `{\\1c&H00FFFFFF\\3c${boxOutline}\\bord10}${safeText}${emojiSuffix}{\\rCaption}`;
          }
          if (tpl.animation === 'glow') {
            return `{\\1c${activeColor}\\3c${activeColor}\\blur6}${safeText}${emojiSuffix}{\\rCaption}`;
          }
          if (tpl.animation === 'emoji-pop') {
            return `{\\1c${activeColor}\\fscx110\\fscy110}${safeText}${emojiSuffix}{\\rCaption}`;
          }
          return `{\\1c${activeColor}}${safeText}${emojiSuffix}{\\rCaption}`;
        }

        return `{\\1c${baseColor}}${safeText}${emojiSuffix}{\\rCaption}`;
      });

      const lineBody = renderedTokens.join(' ');
      const lineStyle = tpl.memeMode ? 'Caption' : 'Caption';
      events.push(
        `Dialogue: 1,${formatAssTime(segStart)},${formatAssTime(segEnd)},${lineStyle},,0,0,0,,${lineBody}`
      );
    }
  }

  return [...header, ...events, ''].join('\n');
}
