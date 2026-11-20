import fsp from 'node:fs/promises';
import { GoogleGenAI, Type } from '@google/genai';
import {
  getClipLengthBounds,
  getTargetClipCount,
  selectRankedMoments,
  type RawLLMMoment,
} from '../src/shared/momentScoring.ts';
import { getEmojiForWord, isKeywordWord } from '../src/shared/captionEngine.ts';
import type {
  AudioSpike,
  ClipSettings,
  MomentCandidate,
  StyleFocusOption,
  TranscriptSegment,
  TranscriptWord,
} from '../src/shared/types.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured. Add your Gemini API key in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function distributeWordsOverRange(
  text: string,
  start: number,
  end: number,
  speaker: string
): TranscriptWord[] {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return [];

  const totalChars = tokens.reduce((sum, t) => sum + Math.max(2, t.length), 0);
  const span = Math.max(0.4, end - start);
  let cursor = start;

  return tokens.map((token, idx) => {
    const weight = Math.max(2, token.length) / totalChars;
    const dur = Math.max(0.08, span * weight);
    const wordStart = cursor;
    const wordEnd = idx === tokens.length - 1 ? end : Math.min(end, cursor + dur);
    cursor = wordEnd;
    return {
      word: token,
      start: Number(wordStart.toFixed(2)),
      end: Number(wordEnd.toFixed(2)),
      speaker,
      isKeyword: isKeywordWord(token),
      emoji: getEmojiForWord(token),
    };
  });
}

/**
 * Transcribes extracted audio using Gemini (`gemini-3.5-transcribe` + `gemini-4-hydrogen`
 * timestamp/speaker structuring) and returns word-level timestamped segments.
 */
export async function transcribeAudioWithGemini(
  audioPath: string,
  videoDuration: number
): Promise<TranscriptSegment[]> {
  const ai = getGeminiClient();
  const audioBuffer = await fsp.readFile(audioPath);

  if (audioBuffer.byteLength > 19 * 1024 * 1024) {
    throw new Error(
      'Extracted audio payload exceeds single-request limit. Please upload a shorter clip under 60 minutes.'
    );
  }

  const base64Audio = audioBuffer.toString('base64');
  const audioPart = {
    inlineData: {
      mimeType: 'audio/mp3',
      data: base64Audio,
    },
  };

  // Step 1: Verbatim speech transcription via gemini-3.5-transcribe
  let rawTranscript = '';
  try {
    const transcribeRes = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: {
        parts: [
          audioPart,
          {
            text: 'Transcribe all speech in this audio accurately, noting audible laughter, gasps, or applause where they occur.',
          },
        ],
      },
    });
    rawTranscript = (transcribeRes.text ?? '').trim();
  } catch {
    // Fallback directly to multimodal gemini-4-hydrogen structured transcription if audio has sparse speech
    rawTranscript = '';
  }

  // Step 2: Structured timestamped speaker-diarized segmentation via gemini-4-hydrogen
  const prompt = rawTranscript
    ? `Here is the audio and its verbatim transcript (total duration: ${videoDuration.toFixed(1)} seconds).
Break it into natural sentence-level segments with accurate start/end timestamps in seconds (between 0 and ${videoDuration.toFixed(1)}), speaker labels (e.g. "Host", "Guest", "Speaker A"), and optional audioTag ("laughter", "applause", "gasp", "shouting", "spike") when audible reactions occur.

Verbatim transcript:
${rawTranscript}`
    : `Listen to this audio (total duration: ${videoDuration.toFixed(1)} seconds) and transcribe it into natural sentence-level segments with accurate start/end timestamps in seconds (between 0 and ${videoDuration.toFixed(1)}), speaker labels ("Host", "Guest", "Speaker A"), and optional audioTag ("laughter", "applause", "gasp", "shouting", "spike").`;

  const structuredRes = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts: [audioPart, { text: prompt }] },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            start: { type: Type.NUMBER, description: 'Start time in seconds' },
            end: { type: Type.NUMBER, description: 'End time in seconds' },
            speaker: { type: Type.STRING, description: 'Speaker name or label' },
            text: { type: Type.STRING, description: 'Spoken sentence text' },
            audioTag: {
              type: Type.STRING,
              description: 'Optional tag: laughter, applause, gasp, shouting, or spike',
            },
          },
          required: ['start', 'end', 'speaker', 'text'],
        },
      },
    },
  });

  const parsed: Array<{
    start: number;
    end: number;
    speaker: string;
    text: string;
    audioTag?: string;
  }> = JSON.parse((structuredRes.text ?? '[]').trim());

  const validTags = new Set(['laughter', 'applause', 'gasp', 'shouting', 'spike']);
  const segments: TranscriptSegment[] = parsed
    .filter((s) => typeof s.text === 'string' && s.text.trim().length > 0)
    .map((s, idx) => {
      const start = Math.max(0, Math.min(videoDuration - 0.5, Number(s.start) || 0));
      const end = Math.max(
        start + 0.5,
        Math.min(videoDuration, Number(s.end) || start + 3)
      );
      const speaker = (s.speaker || 'Host').trim();
      const text = s.text.trim();
      const audioTag =
        s.audioTag && validTags.has(s.audioTag)
          ? (s.audioTag as TranscriptSegment['audioTag'])
          : undefined;
      return {
        id: `seg-${idx + 1}`,
        start: Number(start.toFixed(2)),
        end: Number(end.toFixed(2)),
        speaker,
        text,
        audioTag,
        words: distributeWordsOverRange(text, start, end, speaker),
      };
    })
    .sort((a, b) => a.start - b.start);

  if (segments.length === 0) {
    throw new Error(
      'No spoken dialogue could be transcribed from this video. Make sure the video has clear speech audio.'
    );
  }

  return segments;
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        /503|500|502|504|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded/i.test(
          msg
        );
      if (!isTransient || attempt === maxAttempts) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, attempt * 1200));
    }
  }
  throw lastError;
}

/**
 * Calls Gemini (`gemini-4-hydrogen`) to identify the funniest, most engaging, reaction-worthy
 * moments, then fuses LLM scores with FFmpeg audio spikes, reaction phrases, and pacing rules.
 */
export async function findEngagingMomentsWithGemini(params: {
  segments: TranscriptSegment[];
  audioSpikes: AudioSpike[];
  settings: ClipSettings;
  videoDuration: number;
  isSampleSession?: boolean;
}): Promise<MomentCandidate[]> {
  const {
    segments,
    audioSpikes,
    settings,
    videoDuration,
    isSampleSession = false,
  } = params;

  const bounds = getClipLengthBounds(settings.clipLength);
  const targetCount = getTargetClipCount(settings.clipCount, videoDuration);

  let rawCandidates: RawLLMMoment[] = [];

  if (isSampleSession) {
    rawCandidates = buildSampleCuratedCandidates(settings.styleFocus);
  } else {
    const formattedTranscript = segments
      .map(
        (s) =>
          `[${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s] ${s.speaker}${
            s.audioTag ? ` (${s.audioTag})` : ''
          }: ${s.text}`
      )
      .join('\n');

    const formattedSpikes =
      audioSpikes.length > 0
        ? audioSpikes
            .map(
              (sp) =>
                `${sp.time.toFixed(1)}s (${sp.label}, intensity ${Math.round(
                  sp.intensity * 100
                )}%)`
            )
            .join(', ')
        : 'None detected';

    const ai = getGeminiClient();
    const systemInstruction = `You are an elite viral short-form video editor (TikTok, YouTube Shorts, Instagram Reels).
Your job is to pick the funniest, most engaging, and reaction-worthy moments from a video transcript.
Rules:
1. Prioritize punchlines, jokes, roasts, unexpected twists, funny stories, strong opinions, awkward moments, shocking statements, and big reactions ("no way", "bro", "what", "wait", laughter, gasps).
2. Style focus requested: "${settings.styleFocus}".
3. Every clip MUST start with a strong hook within the first 2 seconds (skip slow greetings/intros).
4. Every clip MUST include BOTH the setup AND the payoff of the joke or story.
5. Clip boundaries MUST align with segment start/end timestamps (never mid-word) and MUST NOT overlap.
6. Aim for clips around ${bounds.min}s to ${bounds.max}s (or fit naturally if total video is shorter).
7. Return up to ${Math.min(10, targetCount + 2)} candidate clips sorted from best to good, each with a punchy 1-line reason and a scroll-stopping hookTitle (max 8 words).`;

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Video duration: ${videoDuration.toFixed(1)}s
Detected audio volume/laughter spikes: ${formattedSpikes}

Transcript:
${formattedTranscript}`,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                start: { type: Type.NUMBER, description: 'Start timestamp in seconds' },
                end: { type: Type.NUMBER, description: 'End timestamp in seconds' },
                llmScore: {
                  type: Type.NUMBER,
                  description: 'Engagement and comedy score from 0 to 100',
                },
                reason: {
                  type: Type.STRING,
                  description:
                    'One concise line explaining why this moment hits (e.g. Big laugh after unexpected punchline)',
                },
                hookTitle: {
                  type: Type.STRING,
                  description:
                    'Punchy hook banner title for the top of the reel (max 8 words)',
                },
                styleTag: {
                  type: Type.STRING,
                  description: 'One of: funny, hype, shocking, wholesome',
                },
              },
              required: ['start', 'end', 'llmScore', 'reason', 'hookTitle'],
            },
          },
        },
      })
    );

    const parsed: Array<{
      start: number;
      end: number;
      llmScore: number;
      reason: string;
      hookTitle: string;
      styleTag?: string;
    }> = JSON.parse((response.text ?? '[]').trim());

    const validStyles = new Set(['funny', 'hype', 'shocking', 'wholesome', 'mixed']);
    rawCandidates = parsed.map((item) => ({
      start: Number(item.start) || 0,
      end: Number(item.end) || 15,
      llmScore: Number(item.llmScore) || 75,
      reason: String(item.reason || 'High-energy punchline and reaction'),
      hookTitle: String(item.hookTitle || 'Wait for the ending'),
      styleTag:
        item.styleTag && validStyles.has(item.styleTag)
          ? (item.styleTag as StyleFocusOption)
          : settings.styleFocus,
    }));
  }

  return selectRankedMoments({
    rawCandidates,
    segments,
    audioSpikes,
    videoDuration,
    clipCount: settings.clipCount,
    clipLength: settings.clipLength,
    styleFocus: settings.styleFocus,
  });
}

/**
 * Deterministic synced multi-speaker transcript for the 72-second FFmpeg Sample Studio Session.
 */
export function buildSampleStudioTranscript(): TranscriptSegment[] {
  const script: Array<{
    start: number;
    end: number;
    speaker: string;
    text: string;
    audioTag?: TranscriptSegment['audioTag'];
  }> = [
    {
      start: 0.4,
      end: 5.0,
      speaker: 'Host',
      text: 'Wait, no way you actually told the CEO his logo looked like a melted pretzel!',
      audioTag: 'gasp',
    },
    {
      start: 5.2,
      end: 10.6,
      speaker: 'Guest',
      text: 'Bro I thought my mic was muted on Zoom and the entire boardroom went dead silent.',
    },
    {
      start: 10.8,
      end: 16.5,
      speaker: 'Host',
      text: 'Stop! What did he say? Tell me you did not double down on the pretzel roast!',
      audioTag: 'laughter',
    },
    {
      start: 16.7,
      end: 21.8,
      speaker: 'Guest',
      text: 'I panicked and said honestly pretzels are timeless, and somehow he promoted me to brand lead!',
      audioTag: 'laughter',
    },
    {
      start: 23.2,
      end: 28.4,
      speaker: 'Host',
      text: 'Hold on, that reminds me of the wildest cooking disaster I ever witnessed live.',
    },
    {
      start: 28.6,
      end: 34.0,
      speaker: 'Guest',
      text: 'Wait are you talking about the coffee maker pasta incident from sophomore year?',
      audioTag: 'gasp',
    },
    {
      start: 34.2,
      end: 40.4,
      speaker: 'Host',
      text: 'Bro he brewed angel hair pasta inside a drip machine and served espresso marinara to our landlord!',
      audioTag: 'laughter',
    },
    {
      start: 40.6,
      end: 45.8,
      speaker: 'Guest',
      text: 'No way! The smoke alarm went off and the landlord still asked for the secret recipe!',
      audioTag: 'applause',
    },
    {
      start: 47.4,
      end: 52.8,
      speaker: 'Guest',
      text: 'Honestly the most wholesome twist was when our whole hallway pitched in to buy him a real stove.',
    },
    {
      start: 53.0,
      end: 58.2,
      speaker: 'Host',
      text: 'Wait, did he actually learn to cook or did he immediately set off the new oven too?',
    },
    {
      start: 58.4,
      end: 64.5,
      speaker: 'Guest',
      text: 'He cooked a five-course dinner for twelve people and now runs the best taco truck in Austin!',
      audioTag: 'applause',
    },
    {
      start: 64.8,
      end: 70.6,
      speaker: 'Host',
      text: 'What?! From coffee-maker pasta to Austin legend—that is genuinely the craziest comeback ever!',
      audioTag: 'laughter',
    },
  ];

  return script.map((item, idx) => ({
    id: `seg-${idx + 1}`,
    start: item.start,
    end: item.end,
    speaker: item.speaker,
    text: item.text,
    audioTag: item.audioTag,
    words: distributeWordsOverRange(item.text, item.start, item.end, item.speaker),
  }));
}

function buildSampleCuratedCandidates(
  styleFocus: StyleFocusOption
): RawLLMMoment[] {
  return [
    {
      start: 0.4,
      end: 21.8,
      llmScore: 95,
      reason: 'Big laugh after accidental unmuted Zoom roast turns into a promotion',
      hookTitle: 'Unmuted on Zoom with the CEO',
      styleTag: styleFocus === 'mixed' ? 'funny' : styleFocus,
    },
    {
      start: 23.2,
      end: 45.8,
      llmScore: 91,
      reason: 'Shocking coffee-maker pasta twist with explosive studio laughter',
      hookTitle: 'He cooked pasta in a coffee maker?!',
      styleTag: 'shocking',
    },
    {
      start: 47.4,
      end: 70.6,
      llmScore: 87,
      reason: 'Wholesome hallway surprise builds into an unreal comeback payoff',
      hookTitle: 'The wildest comeback story ever',
      styleTag: 'wholesome',
    },
  ];
}
