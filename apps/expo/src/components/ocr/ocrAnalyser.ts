/**
 * ocrAnalyser — port of the field-extraction half of
 * solidarity/Services/Card/OCRManager.swift (Apple Vision).
 *
 * Vision-camera v4 doesn't ship a text-recognition frame processor in this
 * monorepo (see `apps/expo/package.json`). Until a Nitro OCR module lands,
 * `recogniseText` returns an empty array; the screen surfaces a clear
 * "OCR coming soon" message rather than crashing.
 *
 * The pure-TS heuristic in `extractBusinessCardFields` is identical to
 * Swift so we get parity tests for free the moment the recogniser lands.
 */
import { uuid, type BusinessCard, type SharingPreferences } from '@solidarity/shared';

export interface RecognizedText {
  /** Recognised string. */
  readonly text: string;
  /** Confidence in [0, 1]. */
  readonly confidence: number;
  /**
   * Vertical position in [0, 1] — top of image is 0, bottom is 1. The Swift
   * implementation sorts by `boundingBox.minY` descending so visually-top
   * lines come first; the TS sort below preserves the same ordering.
   */
  readonly topRatio: number;
}

export interface OcrResult {
  readonly card: BusinessCard;
  readonly confidenceScores: Readonly<Record<string, number>>;
}

/**
 * Placeholder recogniser. Returns an empty list until a Nitro OCR module
 * is wired. The screen renders the language picker, scanning options, and
 * preview unchanged so the visual port stays 1:1 with Swift.
 *
 * Returns a Promise so callers can await without changing shape once the
 * real implementation arrives.
 *
 * TODO(nitro-ocr): replace with a frame-processor plugin (Apple Vision on
 * iOS, ML Kit on Android) that returns `RecognizedText[]`.
 */
export function recogniseText(
  _imageUri: string,
  _languages: readonly string[]
): Promise<readonly RecognizedText[]> {
  return Promise.resolve([] as readonly RecognizedText[]);
}

export function extractBusinessCardFields(
  observations: readonly RecognizedText[]
): OcrResult {
  const confidenceScores: Record<string, number> = {};
  // Top → bottom matches Swift `sort { $0.boundingBox.minY > $1.boundingBox.minY }`.
  // In Vision's coordinate system minY=0 is the bottom, so the largest minY
  // corresponds to the visually-highest line. Our `topRatio` is already
  // image-space-with-zero-at-top, so we sort ascending.
  const sorted = [...observations].sort((a, b) => a.topRatio - b.topRatio);

  let name = '';
  let title: string | undefined;
  let company: string | undefined;
  let email: string | undefined;
  let phone: string | undefined;

  const processed = new Set<string>();

  for (const obs of sorted) {
    const trimmed = obs.text.trim();
    if (trimmed.length < 2 || processed.has(trimmed)) continue;
    processed.add(trimmed);

    if (email === undefined) {
      const value = extractEmail(trimmed);
      if (value !== undefined) {
        email = value;
        confidenceScores['email'] = obs.confidence;
        continue;
      }
    }

    if (phone === undefined) {
      const value = extractPhone(trimmed);
      if (value !== undefined) {
        phone = value;
        confidenceScores['phone'] = obs.confidence;
        continue;
      }
    }

    if (company === undefined && isLikelyCompany(trimmed)) {
      company = trimmed;
      confidenceScores['company'] = obs.confidence;
      continue;
    }

    if (title === undefined && isLikelyJobTitle(trimmed)) {
      title = trimmed;
      confidenceScores['title'] = obs.confidence;
      continue;
    }

    if (name.length === 0 && isLikelyName(trimmed)) {
      name = trimmed;
      confidenceScores['name'] = obs.confidence;
    }
  }

  if (name.length === 0) {
    const first = sorted[0];
    if (first) {
      name = first.text.trim();
      confidenceScores['name'] = first.confidence;
    }
  }

  return {
    card: buildExtractedCard({ name, title, company, email, phone }),
    confidenceScores,
  };
}

interface ExtractedFields {
  readonly name: string;
  readonly title: string | undefined;
  readonly company: string | undefined;
  readonly email: string | undefined;
  readonly phone: string | undefined;
}

function buildExtractedCard(fields: ExtractedFields): BusinessCard {
  const now = new Date();
  const preferences: SharingPreferences = {
    publicFields: new Set(['name']),
    professionalFields: new Set(['name', 'title', 'company', 'email']),
    personalFields: new Set(['name', 'email', 'phone']),
    allowForwarding: true,
    useZK: false,
    sharingFormat: 'didSigned',
    expirationDate: undefined,
  };

  return {
    id: uuid(),
    name: fields.name,
    title: fields.title,
    company: fields.company,
    email: fields.email,
    phone: fields.phone,
    profileImage: undefined,
    animal: undefined,
    socialNetworks: [],
    skills: [],
    categories: [],
    sharingPreferences: preferences,
    groupContext: undefined,
    verifiedFields: undefined,
    nameType: 'display_name',
    createdAt: now,
    updatedAt: now,
  };
}

// MARK: - Text Pattern Recognition (1:1 port)

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u;

function extractEmail(text: string): string | undefined {
  const m = EMAIL_RE.exec(text);
  return m ? m[0] : undefined;
}

const PHONE_PATTERNS: readonly RegExp[] = [
  /\+?1?[0-9]{10,}/u,
  /[0-9]{3}[0-9]{3}[0-9]{4}/u,
];

function extractPhone(text: string): string | undefined {
  const cleaned = text
    .replace(/ /gu, '')
    .replace(/-/gu, '')
    .replace(/\(/gu, '')
    .replace(/\)/gu, '')
    .replace(/\./gu, '');
  for (const re of PHONE_PATTERNS) {
    const m = re.exec(cleaned);
    if (m && m[0].length >= 10) return text;
  }
  return undefined;
}

const COMPANY_INDICATORS: readonly string[] = [
  'Inc',
  'LLC',
  'Corp',
  'Corporation',
  'Company',
  'Co.',
  'Ltd',
  'Limited',
  'Group',
  'Associates',
  'Partners',
  'Consulting',
  'Solutions',
  'Services',
  'Technologies',
  'Tech',
  'Systems',
  'Enterprises',
  'Holdings',
];

function isLikelyCompany(text: string): boolean {
  const lower = text.toLowerCase();
  return COMPANY_INDICATORS.some((ind) => lower.includes(ind.toLowerCase()));
}

const TITLE_INDICATORS: readonly string[] = [
  'CEO',
  'CTO',
  'CFO',
  'COO',
  'President',
  'Vice President',
  'VP',
  'Director',
  'Manager',
  'Senior',
  'Lead',
  'Principal',
  'Chief',
  'Head',
  'Supervisor',
  'Coordinator',
  'Specialist',
  'Analyst',
  'Engineer',
  'Developer',
  'Designer',
  'Consultant',
  'Associate',
  'Executive',
  'Officer',
  'Administrator',
  'Representative',
];

function isLikelyJobTitle(text: string): boolean {
  const lower = text.toLowerCase();
  return TITLE_INDICATORS.some((ind) => lower.includes(ind.toLowerCase()));
}

const NAME_ALLOWED_RE = /^[\p{L} '-]+$/u;

function isLikelyName(text: string): boolean {
  const words = text.split(/\s+/u).filter((w) => w.length > 0);
  if (words.length < 1 || words.length > 4) return false;
  for (const word of words) {
    const first = word[0];
    if (first === undefined) return false;
    if (first !== first.toUpperCase()) return false;
  }
  return NAME_ALLOWED_RE.test(text);
}
