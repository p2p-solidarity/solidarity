import { describe, expect, it } from 'bun:test';

import {
  buildPresentModel,
  resolvePresentAttestationsState,
  resolvePresentCardState,
  selectPresentCardPresets,
} from '@/present/presentModel';
import type { ShareFieldPreferences } from '@/cards/solidarityQrTypes';
import type { BusinessCard } from '@solidarity/shared';

const ALL_OFF: ShareFieldPreferences = {
  shareTitle: false,
  shareCompany: false,
  shareEmail: false,
  sharePhone: false,
  shareProfileImage: false,
  shareSocialNetworks: false,
  shareSkills: false,
};

function businessCard(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Ada Lovelace',
    title: 'Engineer',
    company: 'Analytical Engines',
    email: 'ada@example.com',
    phone: '+44 1234',
    socialNetworks: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        platform: 'Website',
        username: 'ada',
        url: 'https://ada.example.com',
      },
    ],
    skills: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Mathematics',
        category: 'Science',
        proficiencyLevel: 'Expert',
      },
    ],
    categories: [],
    verifiedFields: undefined,
    sharingPreferences: {
      publicFields: new Set(),
      professionalFields: new Set(),
      personalFields: new Set(),
      allowForwarding: true,
      useZK: false,
      sharingFormat: 'zkProof',
    },
    nameType: 'display_name',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('buildPresentModel', () => {
  it('pairs profile links with visibility and defaults missing visibility to public', () => {
    const model = buildPresentModel({
      cardState: { kind: 'empty' },
      links: [
        { label: 'Website', url: 'https://example.com' },
        { label: 'Private', url: 'https://private.example.com' },
        { label: 'Writing', url: 'https://writing.example.com' },
      ],
      linkVisibility: ['public', 'private'],
      preferences: ALL_OFF,
    });

    expect(model.publicLinks.map((entry) => entry.link.label)).toEqual([
      'Website',
      'Writing',
    ]);
    expect(model.publicLinks.map((entry) => entry.sourceIndex)).toEqual([0, 2]);
  });

  it('keeps only populated QR-supported card fields in fixed display order', () => {
    const card = businessCard({ company: '   ', phone: undefined });
    const model = buildPresentModel({
      cardState: { kind: 'ready', card },
      links: [],
      linkVisibility: [],
      preferences: {
        ...ALL_OFF,
        shareTitle: true,
        shareCompany: true,
        shareEmail: true,
        sharePhone: true,
        shareProfileImage: true,
        shareSocialNetworks: true,
        shareSkills: true,
      },
    });

    expect(model.cardOnlyFields.map((entry) => entry.field)).toEqual([
      'title',
      'email',
      'socialNetworks',
      'skills',
    ]);
    expect(model.cardOnlyFields.map((entry) => entry.preferenceKey)).toEqual([
      'shareTitle',
      'shareEmail',
      'shareSocialNetworks',
      'shareSkills',
    ]);
    expect(model.selectedCardOnlyCount).toBe(4);
  });

  it('treats blank scalar and grouped values as absent', () => {
    const model = buildPresentModel({
      cardState: {
        kind: 'ready',
        card: businessCard({
          title: '\t',
          company: '',
          email: '   ',
          phone: '\n',
          socialNetworks: [{
            id: '44444444-4444-4444-8444-444444444444',
            platform: 'Other',
            username: '   ',
          }],
          skills: [{
            id: '55555555-5555-4555-8555-555555555555',
            name: ' ',
            category: '',
            proficiencyLevel: 'Beginner',
          }],
        }),
      },
      links: [],
      linkVisibility: [],
      preferences: { ...ALL_OFF, shareTitle: true, shareSkills: true },
    });

    expect(model.cardOnlyFields).toEqual([]);
    expect(model.selectedCardOnlyCount).toBe(0);
  });

  it('starts with all optional Card Only fields off while name remains mandatory', () => {
    const model = buildPresentModel({
      cardState: { kind: 'ready', card: businessCard() },
      links: [],
      linkVisibility: [],
      preferences: ALL_OFF,
    });

    expect(model.mandatoryName).toBe('Ada Lovelace');
    expect(model.cardOnlyFields.every((entry) => !entry.selected)).toBe(true);
    expect(model.selectedCardOnlyCount).toBe(0);
  });

  it('does not mutate card, profile-link, visibility, or preference inputs', () => {
    const links = Object.freeze([
      Object.freeze({ label: 'Website', url: 'https://example.com' }),
    ]);
    const visibility = Object.freeze(['public'] as const);
    const preferences = Object.freeze({ ...ALL_OFF, shareTitle: true });
    const card = businessCard();
    Object.freeze(card.socialNetworks);
    Object.freeze(card.skills);
    Object.freeze(card);

    expect(() => buildPresentModel({
      cardState: { kind: 'ready', card },
      links,
      linkVisibility: visibility,
      preferences,
    })).not.toThrow();
    expect(links[0]?.label).toBe('Website');
    expect(card.title).toBe('Engineer');
  });
});

describe('resolvePresentCardState', () => {
  it('reports loading, empty, ready, and error without inventing card data', () => {
    const card = businessCard();

    expect(resolvePresentCardState({
      detailsHydrated: false,
      hasManifest: false,
      card: undefined,
      hasError: false,
    })).toEqual({ kind: 'loading' });
    expect(resolvePresentCardState({
      detailsHydrated: true,
      hasManifest: false,
      card: undefined,
      hasError: false,
    })).toEqual({ kind: 'empty' });
    expect(resolvePresentCardState({
      detailsHydrated: true,
      hasManifest: true,
      card,
      hasError: false,
    })).toEqual({ kind: 'ready', card });
    expect(resolvePresentCardState({
      detailsHydrated: false,
      hasManifest: true,
      card: undefined,
      hasError: true,
    })).toEqual({ kind: 'error' });
  });
});

describe('resolvePresentAttestationsState', () => {
  it('distinguishes loading, failure, truthful empty, and ready data', () => {
    expect(resolvePresentAttestationsState({
      hydrated: false,
      hasError: false,
      claimCount: 0,
    })).toBe('loading');
    expect(resolvePresentAttestationsState({
      hydrated: false,
      hasError: true,
      claimCount: 0,
    })).toBe('error');
    expect(resolvePresentAttestationsState({
      hydrated: true,
      hasError: false,
      claimCount: 0,
    })).toBe('empty');
    expect(resolvePresentAttestationsState({
      hydrated: true,
      hasError: false,
      claimCount: 2,
    })).toBe('ready');
  });
});

describe('selectPresentCardPresets', () => {
  it('uses one stable empty array while no preset has been saved', () => {
    const preferences = {} as Parameters<typeof selectPresentCardPresets>[0];

    expect(
      Object.is(
        selectPresentCardPresets(preferences),
        selectPresentCardPresets(preferences)
      )
    ).toBe(true);
  });

  it('returns the stored preset array unchanged', () => {
    const presets = [{ name: 'Conference', preferenceKeys: ['shareEmail'] }] as const;
    const preferences = {
      presentCardPresets: presets,
    } as unknown as Parameters<typeof selectPresentCardPresets>[0];

    expect(selectPresentCardPresets(preferences)).toBe(presets);
  });
});
