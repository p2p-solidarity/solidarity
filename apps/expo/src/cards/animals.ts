/**
 * AnimalCharacter — mirrors solidarity/Models/AnimalCharacter.swift.
 *
 * The five selectable avatar animals plus their UX strings. The shared
 * `animalSchema` (packages/shared) is the canonical wire-format enum;
 * this file adds the per-case display metadata (name, personality blurb,
 * SF Symbol fallback) the Swift app keeps inline on the enum.
 *
 * Asset pipeline TODO: the Swift `ImageProvider.animalImage(for:)` ships
 * a PNG per animal. We don't have those bundled in Expo yet, so the
 * selector renders an SF Symbol placeholder via `symbolFallback`.
 */
import type { SFSymbol } from 'expo-symbols';

import { type Animal } from '@solidarity/shared';

export const ANIMAL_CASES: readonly Animal[] = [
  'dog',
  'horse',
  'pig',
  'sheep',
  'dove',
] as const;

interface AnimalMeta {
  readonly displayName: string;
  readonly personality: string;
  /** SF Symbol placeholder until PNG assets ship. */
  readonly symbolFallback: SFSymbol;
}

const META: Readonly<Record<Animal, AnimalMeta>> = {
  dog: {
    displayName: 'Dog',
    personality: 'Loyal connector — warm intros, steady follow‑through.',
    symbolFallback: 'pawprint.fill',
  },
  horse: {
    displayName: 'Horse',
    personality: 'Driven achiever — fast pace, big energy, bold goals.',
    symbolFallback: 'hare.fill',
  },
  pig: {
    displayName: 'Pig',
    personality: 'Practical strategist — grounded, systematic, gets results.',
    symbolFallback: 'leaf.fill',
  },
  sheep: {
    displayName: 'Sheep',
    personality: 'Calm collaborator — inclusive, thoughtful, team‑first.',
    symbolFallback: 'cloud.fill',
  },
  dove: {
    displayName: 'Dove',
    personality: 'Diplomatic storyteller — clear voice, builds trust quickly.',
    symbolFallback: 'bird.fill',
  },
};

export function animalDisplayName(a: Animal): string {
  return META[a].displayName;
}

export function animalPersonality(a: Animal): string {
  return META[a].personality;
}

export function animalSymbolFallback(a: Animal): SFSymbol {
  return META[a].symbolFallback;
}
