/**
 * AnimalCharacter — mirrors solidarity/Models/AnimalCharacter.swift.
 *
 * The five selectable avatar animals plus their UX strings. The shared
 * `animalSchema` (packages/shared) is the canonical wire-format enum;
 * this file adds the per-case display metadata (name, personality blurb,
 * PNG source) the Swift app keeps inline on the enum.
 *
 * Asset pipeline: ports `solidarity/Resources/{dog,horse,pig,sheep,dove}.png`
 * 1:1 into apps/expo/assets/animals/. Swift `ImageProvider.animalImage(for:)`
 * loads the same plain colored PNGs (not the "-white" variants).
 */
import type { ImageSourcePropType } from 'react-native';

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
  readonly png: ImageSourcePropType;
}

const META: Readonly<Record<Animal, AnimalMeta>> = {
  dog: {
    displayName: 'Dog',
    personality: 'Loyal connector — warm intros, steady follow‑through.',
    png: require('../../assets/animals/dog.png') as ImageSourcePropType,
  },
  horse: {
    displayName: 'Horse',
    personality: 'Driven achiever — fast pace, big energy, bold goals.',
    png: require('../../assets/animals/horse.png') as ImageSourcePropType,
  },
  pig: {
    displayName: 'Pig',
    personality: 'Practical strategist — grounded, systematic, gets results.',
    png: require('../../assets/animals/pig.png') as ImageSourcePropType,
  },
  sheep: {
    displayName: 'Sheep',
    personality: 'Calm collaborator — inclusive, thoughtful, team‑first.',
    png: require('../../assets/animals/sheep.png') as ImageSourcePropType,
  },
  dove: {
    displayName: 'Dove',
    personality: 'Diplomatic storyteller — clear voice, builds trust quickly.',
    png: require('../../assets/animals/dove.png') as ImageSourcePropType,
  },
};

export function animalDisplayName(a: Animal): string {
  return META[a].displayName;
}

export function animalPersonality(a: Animal): string {
  return META[a].personality;
}

/** Mirrors Swift `ImageProvider.animalImage(for:)` — returns the plain PNG. */
export function animalImageSource(a: Animal): ImageSourcePropType {
  return META[a].png;
}

const SYMBOL_FALLBACK: Readonly<Record<Animal, SFSymbol>> = {
  dog: 'pawprint.fill',
  horse: 'hare.fill',
  pig: 'leaf.fill',
  sheep: 'cloud.fill',
  dove: 'bird.fill',
};

/** SF Symbol shown when the PNG asset for an animal isn't bundled. */
export function animalSymbolFallback(a: Animal): SFSymbol {
  return SYMBOL_FALLBACK[a];
}
