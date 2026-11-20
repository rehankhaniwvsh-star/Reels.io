import { useEffect, useMemo, useState } from 'react';
import {
  buildCaptionChunks,
  getEmojiForWord,
  getSpeakerColor,
  isKeywordWord,
  resolveCaptionConfig,
} from '../shared/captionEngine';
import type {
  CaptionCustomization,
  CaptionTemplate,
  TranscriptWord,
} from '../shared/types';

interface CaptionPreviewRendererProps {
  template: CaptionTemplate;
  customization?: CaptionCustomization;
  words?: TranscriptWord[];
  clipStart?: number;
  clipEnd?: number;
  currentTime?: number;
  hookTitle?: string;
  showHookTitle?: boolean;
  compact?: boolean;
  customSampleText?: string;
}

export function CaptionPreviewRenderer({
  template,
  customization,
  words,
  clipStart = 0,
  clipEnd = 10,
  currentTime,
  hookTitle,
  showHookTitle = false,
  compact = false,
  customSampleText,
}: CaptionPreviewRendererProps) {
  const resolved = useMemo(
    () =>
      customization
        ? resolveCaptionConfig(customization)
        : template,
    [template, customization]
  );

  // Auto-cycle index when used in template gallery without an active video clock
  const isLiveSynced = typeof currentTime === 'number' && Array.isArray(words);
  const [tick, setTick] = useState(0);

  const sampleSequence = useMemo(() => {
    if (customSampleText && customSampleText.trim().length > 0) {
      return customSampleText
        .trim()
        .split(/\s+/)
        .map((word, idx) => ({
          word,
          speaker: idx % 4 < 2 ? 'Host' : 'Guest',
          isKeyword: isKeywordWord(word),
          emoji: getEmojiForWord(word),
        }));
    }
    return resolved.sampleWords.map((item) => ({
      ...item,
      isKeyword: item.isKeyword ?? isKeywordWord(item.word),
      emoji: getEmojiForWord(item.word),
    }));
  }, [resolved.sampleWords, customSampleText]);

  useEffect(() => {
    if (isLiveSynced) return;
    const interval = window.setInterval(() => {
      setTick((prev) => (prev + 1) % Math.max(1, sampleSequence.length));
    }, 520);
    return () => window.clearInterval(interval);
  }, [isLiveSynced, sampleSequence.length]);

  const activeLine = useMemo(() => {
    if (isLiveSynced && words) {
      const chunks = buildCaptionChunks(
        words,
        clipStart,
        clipEnd,
        resolved.wordsPerLine
      );
      const t = Math.max(0, currentTime ?? 0);
      const activeChunk =
        chunks.find((c) => t >= c.start && t <= c.end + 0.15) ??
        chunks.find((c) => c.start >= t) ??
        chunks[chunks.length - 1];

      if (!activeChunk) {
        return { words: [], activeWordIdx: -1 };
      }

      let activeIdx = activeChunk.words.findIndex(
        (w) => t >= w.start && t <= w.end + 0.08
      );
      if (activeIdx === -1) activeIdx = 0;

      return {
        words: activeChunk.words.map((w) => ({
          word: w.word,
          speaker: w.speaker,
          isKeyword: w.isKeyword ?? isKeywordWord(w.word),
          emoji: w.emoji ?? getEmojiForWord(w.word),
        })),
        activeWordIdx: activeIdx,
      };
    }

    const perLine = Math.max(1, resolved.wordsPerLine);
    const chunkIdx = Math.floor(tick / perLine);
    const startIdx = chunkIdx * perLine;
    const slice = sampleSequence.slice(startIdx, startIdx + perLine);
    const activeWordIdx = tick - startIdx;
    return { words: slice, activeWordIdx };
  }, [
    isLiveSynced,
    words,
    clipStart,
    clipEnd,
    resolved.wordsPerLine,
    currentTime,
    tick,
    sampleSequence,
  ]);

  const positionClass =
    resolved.position === 'top'
      ? 'justify-start pt-5'
      : resolved.position === 'middle'
      ? 'justify-center'
      : 'justify-end pb-5';

  const visibleWords =
    resolved.animation === 'typewriter'
      ? activeLine.words.slice(0, Math.max(1, activeLine.activeWordIdx + 1))
      : activeLine.words;

  const fontFamilyStyle =
    resolved.font === 'JetBrains Mono'
      ? 'var(--font-mono)'
      : resolved.font === 'Impact'
      ? 'Impact, "Arial Narrow", sans-serif'
      : resolved.font === 'Bricolage Grotesque'
      ? 'var(--font-display)'
      : 'var(--font-sans)';

  const scaledPx = compact
    ? Math.max(13, Math.round(resolved.fontSize * 0.32))
    : Math.max(18, Math.round(resolved.fontSize * 0.5));

  const outlineShadow =
    resolved.animation === 'glow'
      ? `0 0 10px ${resolved.accentColor}, 0 0 22px ${resolved.outlineColor}, 0 2px 4px rgba(0,0,0,0.9)`
      : `-2px -2px 0 ${resolved.outlineColor}, 2px -2px 0 ${resolved.outlineColor}, -2px 2px 0 ${resolved.outlineColor}, 2px 2px 0 ${resolved.outlineColor}, 0 4px 10px rgba(0,0,0,0.75)`;

  return (
    <div
      className={`pointer-events-none absolute inset-0 flex flex-col px-3 ${positionClass}`}
      aria-hidden="true"
    >
      {/* Optional Hook Title Banner or Meme Top Text */}
      {(showHookTitle && hookTitle) || resolved.memeMode ? (
        <div
          className={`absolute inset-x-3 top-3 flex justify-center text-center ${
            resolved.memeMode ? '' : ''
          }`}
        >
          {resolved.memeMode ? (
            <span
              style={{
                fontFamily: 'Impact, "Arial Narrow", sans-serif',
                fontSize: compact ? '13px' : '21px',
                textShadow:
                  '-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000',
              }}
              className="uppercase tracking-wide font-extrabold text-white leading-tight"
            >
              {hookTitle || 'POV: THE MIC WAS UNMUTED'}
            </span>
          ) : (
            <span
              className={`rounded-md bg-[#F5B700] px-2.5 py-1 font-display font-bold text-[#0C0D10] shadow-md leading-snug ${
                compact ? 'text-[10px]' : 'text-xs sm:text-sm'
              }`}
            >
              {hookTitle}
            </span>
          )}
        </div>
      ) : null}

      {/* Main Caption Line */}
      <div
        className={`flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center ${
          resolved.animation === 'typewriter'
            ? 'rounded-md bg-black/75 px-2.5 py-1.5 backdrop-blur-xs'
            : ''
        }`}
      >
        {visibleWords.map((item, idx) => {
          const isActive = idx === activeLine.activeWordIdx;
          const displayWord = resolved.uppercase
            ? item.word.toUpperCase()
            : item.word;
          const speakerColor =
            resolved.animation === 'speaker-shift'
              ? getSpeakerColor(resolved, item.speaker)
              : resolved.primaryColor;

          const textColor = isActive
            ? resolved.animation === 'highlight-box'
              ? '#FFFFFF'
              : resolved.accentColor
            : item.isKeyword
            ? resolved.accentColor
            : speakerColor;

          const activeBoxBg =
            isActive &&
            resolved.animation === 'highlight-box' &&
            resolved.boxColor !== 'transparent'
              ? resolved.boxColor
              : 'transparent';

          const animClass = isActive
            ? resolved.animation === 'bounce'
              ? 'animate-karaoke-pop'
              : resolved.animation === 'typewriter'
              ? 'animate-slide-up-word'
              : ''
            : '';

          return (
            <span
              key={`${idx}-${item.word}`}
              style={{
                fontFamily: fontFamilyStyle,
                fontSize: `${scaledPx}px`,
                color: textColor,
                backgroundColor: activeBoxBg,
                textShadow:
                  activeBoxBg !== 'transparent' ? 'none' : outlineShadow,
              }}
              className={`inline-flex items-center gap-1 rounded px-1 font-extrabold leading-tight tracking-tight transition-transform duration-150 ${animClass}`}
            >
              <span>{displayWord}</span>
              {resolved.showEmoji && item.emoji ? (
                <span className="animate-emoji-bounce inline-block">
                  {item.emoji}
                </span>
              ) : null}
            </span>
          );
        })}
        {resolved.animation === 'typewriter' ? (
          <span
            style={{ fontSize: `${scaledPx}px` }}
            className="inline-block font-mono font-bold text-[#4ADE80]"
          >
            _
          </span>
        ) : null}
      </div>
    </div>
  );
}
