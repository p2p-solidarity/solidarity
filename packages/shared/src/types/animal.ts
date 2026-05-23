/**
 * Avatar animal — mirrors solidarity/Models/AnimalCharacter.swift.
 *
 * Wire format: lowercase string. `defaultAnimalForId` uses a deterministic
 * UTF-8 byte-sum modulo 5 so the same identity always gets the same avatar
 * across the Swift app, the Expo app, and the App Clip (Solidarity uses
 * this for "I don't remember the contact's name but I remember their pig").
 */
import { z } from 'zod';

export const animalSchema = z.enum(['dog', 'horse', 'pig', 'sheep', 'dove']);
export type Animal = z.infer<typeof animalSchema>;

const BY_INDEX = {
  0: 'dog',
  1: 'horse',
  2: 'pig',
  3: 'sheep',
  4: 'dove',
} as const satisfies Record<number, Animal>;

/** Deterministic default avatar derived from a stable id (e.g. card UUID). */
export function defaultAnimalForId(id: string): Animal {
  const bytes = new TextEncoder().encode(id);
  let sum = 0;
  for (const b of bytes) sum = (sum + b) % 5;
  return BY_INDEX[sum as 0 | 1 | 2 | 3 | 4];
}
