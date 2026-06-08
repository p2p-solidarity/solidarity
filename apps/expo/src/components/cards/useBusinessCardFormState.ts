/**
 * useBusinessCardFormState — local state machine for the card editor.
 *
 * Lives in its own file so the BusinessCardForm view stays under the
 * project complexity budget. Mirrors Swift BusinessCardFormView's
 * `@State` properties + the `hydrate()` lifecycle hook.
 */
import { useEffect, useState } from 'react';

import { type BusinessCard, type SharingFormat } from '@solidarity/shared';

export type SelectableSharingFormat = Extract<SharingFormat, 'zkProof' | 'didSigned'>;

export interface BusinessCardFormState {
  readonly name: string;
  readonly title: string;
  readonly company: string;
  readonly email: string;
  readonly phone: string;
  readonly skillsText: string;
  readonly categoriesText: string;
  readonly linkedInHandle: string;
  readonly githubHandle: string;
  readonly allowForwarding: boolean;
  readonly selectedFormat: SelectableSharingFormat;

  readonly setName: (next: string) => void;
  readonly setTitle: (next: string) => void;
  readonly setCompany: (next: string) => void;
  readonly setEmail: (next: string) => void;
  readonly setPhone: (next: string) => void;
  readonly setSkillsText: (next: string) => void;
  readonly setCategoriesText: (next: string) => void;
  readonly setLinkedInHandle: (next: string) => void;
  readonly setGithubHandle: (next: string) => void;
  readonly setAllowForwarding: (next: boolean) => void;
  readonly setSelectedFormat: (next: SelectableSharingFormat) => void;
}

interface BusinessCardFormValues {
  readonly name: string;
  readonly title: string;
  readonly company: string;
  readonly email: string;
  readonly phone: string;
  readonly skillsText: string;
  readonly categoriesText: string;
  readonly linkedInHandle: string;
  readonly githubHandle: string;
  readonly allowForwarding: boolean;
  readonly selectedFormat: SelectableSharingFormat;
}

const EMPTY_FORM_VALUES: BusinessCardFormValues = {
  name: '',
  title: '',
  company: '',
  email: '',
  phone: '',
  skillsText: '',
  categoriesText: '',
  linkedInHandle: '',
  githubHandle: '',
  allowForwarding: false,
  selectedFormat: 'zkProof',
};

export function useBusinessCardFormState(initialCard?: BusinessCard): BusinessCardFormState {
  const initialValues = formValuesFromCard(initialCard);
  const [name, setName] = useState(initialValues.name);
  const [title, setTitle] = useState(initialValues.title);
  const [company, setCompany] = useState(initialValues.company);
  const [email, setEmail] = useState(initialValues.email);
  const [phone, setPhone] = useState(initialValues.phone);
  const [skillsText, setSkillsText] = useState(initialValues.skillsText);
  const [categoriesText, setCategoriesText] = useState(initialValues.categoriesText);
  const [linkedInHandle, setLinkedInHandle] = useState(initialValues.linkedInHandle);
  const [githubHandle, setGithubHandle] = useState(initialValues.githubHandle);
  const [allowForwarding, setAllowForwarding] = useState(initialValues.allowForwarding);
  const [selectedFormat, setSelectedFormat] = useState(initialValues.selectedFormat);

  // Re-hydrate when the parent swaps the card (e.g. router navigation).
  useEffect(() => {
    if (!initialCard) return;
    const next = formValuesFromCard(initialCard);
    setName(next.name);
    setTitle(next.title);
    setCompany(next.company);
    setEmail(next.email);
    setPhone(next.phone);
    setSkillsText(next.skillsText);
    setCategoriesText(next.categoriesText);
    setLinkedInHandle(next.linkedInHandle);
    setGithubHandle(next.githubHandle);
    setAllowForwarding(next.allowForwarding);
    setSelectedFormat(next.selectedFormat);
  }, [initialCard]);

  return {
    name,
    title,
    company,
    email,
    phone,
    skillsText,
    categoriesText,
    linkedInHandle,
    githubHandle,
    allowForwarding,
    selectedFormat,
    setName,
    setTitle,
    setCompany,
    setEmail,
    setPhone,
    setSkillsText,
    setCategoriesText,
    setLinkedInHandle,
    setGithubHandle,
    setAllowForwarding,
    setSelectedFormat,
  };
}

function formValuesFromCard(card?: BusinessCard): BusinessCardFormValues {
  if (!card) return EMPTY_FORM_VALUES;

  return {
    name: card.name,
    title: card.title ?? '',
    company: card.company ?? '',
    email: card.email ?? '',
    phone: card.phone ?? '',
    skillsText: card.skills.map((s) => s.name).join(', '),
    categoriesText: card.categories.join(', '),
    linkedInHandle: socialHandle(card, 'LinkedIn'),
    githubHandle: socialHandle(card, 'GitHub'),
    allowForwarding: card.sharingPreferences.allowForwarding,
    selectedFormat: selectableSharingFormat(card.sharingPreferences.sharingFormat),
  };
}

function socialHandle(card: BusinessCard, platform: 'LinkedIn' | 'GitHub'): string {
  return card.socialNetworks.find((s) => s.platform === platform)?.username ?? '';
}

function selectableSharingFormat(format: SharingFormat): SelectableSharingFormat {
  return format === 'didSigned' ? 'didSigned' : 'zkProof';
}
