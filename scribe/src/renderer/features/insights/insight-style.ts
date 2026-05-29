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
};

const SENTIMENT_TEXT: Record<InsightSentiment['label'], string> = {
  positive: 'text-sentiment-positive',
  neutral: 'text-sentiment-neutral',
  negative: 'text-sentiment-negative',
};

export function sentimentClass(label: InsightSentiment['label']): string {
  return SENTIMENT_TEXT[label];
}
