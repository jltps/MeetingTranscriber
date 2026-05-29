import type { InsightSentiment } from '../../../shared/types';

// Shared styling for Gladia insights (V08), used by both the dedicated
// InsightsView and the inline weave in TranscriptPanel. Class strings are
// literal so Tailwind's JIT picks up the entity/sentiment color utilities backed
// by the design tokens in index.css.

export type EntityToken = 'person' | 'org' | 'location' | 'date' | 'other';

export function entityKindToken(kind: string): EntityToken {
  const k = kind.toLowerCase();
  if (k.includes('person') || k.includes('name')) return 'person';
  if (k.includes('org') || k.includes('company')) return 'org';
  if (k.includes('loc') || k.includes('place') || k.includes('gpe')) return 'location';
  if (k.includes('date') || k.includes('time')) return 'date';
  return 'other';
}

const ENTITY_UNDERLINE: Record<EntityToken, string> = {
  person: 'decoration-entity-person',
  org: 'decoration-entity-org',
  location: 'decoration-entity-location',
  date: 'decoration-entity-date',
  other: 'decoration-entity-other',
};

const ENTITY_TEXT: Record<EntityToken, string> = {
  person: 'text-entity-person',
  org: 'text-entity-org',
  location: 'text-entity-location',
  date: 'text-entity-date',
  other: 'text-entity-other',
};

/** Inline underline style for an entity span (used in the transcript weave). */
export function entityUnderlineClass(kind: string): string {
  return `underline decoration-2 underline-offset-2 ${ENTITY_UNDERLINE[entityKindToken(kind)]}`;
}

/** Text-color class for an entity chip/label (used in the Insights view). */
export function entityTextClass(kind: string): string {
  return ENTITY_TEXT[entityKindToken(kind)];
}

export const SENTIMENT_GLYPH: Record<InsightSentiment['label'], string> = {
  positive: '😊',
  neutral: '😐',
  negative: '😟',
  mixed: '🤔',
  unknown: '❔',
};

/** Human-readable label per sentiment (for sentences/headings). */
export const SENTIMENT_LABEL: Record<InsightSentiment['label'], string> = {
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative',
  mixed: 'Mixed',
  unknown: 'Unknown',
};

const SENTIMENT_TEXT: Record<InsightSentiment['label'], string> = {
  positive: 'text-sentiment-positive',
  neutral: 'text-sentiment-neutral',
  negative: 'text-sentiment-negative',
  mixed: 'text-sentiment-mixed',
  unknown: 'text-sentiment-unknown',
};

export function sentimentClass(label: InsightSentiment['label']): string {
  return SENTIMENT_TEXT[label] ?? SENTIMENT_TEXT.unknown;
}

// V081 — Gladia's 25 emotions → emoji. Unknown/missing falls back to a neutral
// face so the UI degrades gracefully if Gladia adds new emotions.
const EMOTION_GLYPH: Record<string, string> = {
  adoration: '🥰',
  amusement: '😄',
  anger: '😠',
  awe: '😮',
  confusion: '😕',
  contempt: '😒',
  contentment: '😌',
  desire: '😍',
  disappointment: '😞',
  disgust: '🤢',
  distress: '😣',
  ecstatic: '🤩',
  elation: '😁',
  embarrassment: '😳',
  fear: '😨',
  interest: '🤔',
  pain: '😖',
  realization: '💡',
  relief: '😅',
  sadness: '😢',
  negative_surprise: '😧',
  positive_surprise: '😲',
  sympathy: '🤝',
  triumph: '🏆',
  neutral: '😐',
};

export function emotionGlyph(emotion: string): string {
  return EMOTION_GLYPH[emotion.toLowerCase()] ?? '💬';
}

/** Title-case a Gladia emotion key for display (e.g. positive_surprise → "Positive surprise"). */
export function emotionLabel(emotion: string): string {
  const s = emotion.replace(/_/g, ' ').trim();
  return s.length ? s[0].toUpperCase() + s.slice(1) : emotion;
}
