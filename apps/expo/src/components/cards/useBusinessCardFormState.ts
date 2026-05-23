/**
 * useBusinessCardFormState — local state machine for the card editor.
 *
 * Lives in its own file so the BusinessCardForm view stays under the
 * project complexity budget. Mirrors Swift BusinessCardFormView's
 * `@State` properties + the `hydrate()` lifecycle hook.
 */
import { useEffect, useState } from 'react';

import { type BusinessCard, type SharingFormat } from '@solidarity/shared';

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
  readonly useZK: boolean;
  readonly allowForwarding: boolean;
  readonly selectedFormat: SharingFormat;

  readonly setName: (next: string) => void;
  readonly setTitle: (next: string) => void;
  readonly setCompany: (next: string) => void;
  readonly setEmail: (next: string) => void;
  readonly setPhone: (next: string) => void;
  readonly setSkillsText: (next: string) => void;
  readonly setCategoriesText: (next: string) => void;
  readonly setLinkedInHandle: (next: string) => void;
  readonly setGithubHandle: (next: string) => void;
  readonly setUseZK: (next: boolean) => void;
  readonly setAllowForwarding: (next: boolean) => void;
  readonly setSelectedFormat: (next: SharingFormat) => void;
}

export function useBusinessCardFormState(
  initialCard?: BusinessCard
): BusinessCardFormState {
  const [name, setName] = useState(initialCard?.name ?? '');
  const [title, setTitle] = useState(initialCard?.title ?? '');
  const [company, setCompany] = useState(initialCard?.company ?? '');
  const [email, setEmail] = useState(initialCard?.email ?? '');
  const [phone, setPhone] = useState(initialCard?.phone ?? '');
  const [skillsText, setSkillsText] = useState(
    initialCard?.skills.map((s) => s.name).join(', ') ?? ''
  );
  const [categoriesText, setCategoriesText] = useState(
    initialCard?.categories.join(', ') ?? ''
  );
  const [linkedInHandle, setLinkedInHandle] = useState(
    initialCard?.socialNetworks.find((s) => s.platform === 'LinkedIn')?.username ?? ''
  );
  const [githubHandle, setGithubHandle] = useState(
    initialCard?.socialNetworks.find((s) => s.platform === 'GitHub')?.username ?? ''
  );
  const [useZK, setUseZK] = useState(initialCard?.sharingPreferences.useZK ?? true);
  const [allowForwarding, setAllowForwarding] = useState(
    initialCard?.sharingPreferences.allowForwarding ?? false
  );
  const [selectedFormat, setSelectedFormat] = useState<SharingFormat>(
    initialCard?.sharingPreferences.sharingFormat ?? 'didSigned'
  );

  // Re-hydrate when the parent swaps the card (e.g. router navigation).
  useEffect(() => {
    if (!initialCard) return;
    setName(initialCard.name);
    setTitle(initialCard.title ?? '');
    setCompany(initialCard.company ?? '');
    setEmail(initialCard.email ?? '');
    setPhone(initialCard.phone ?? '');
    setSkillsText(initialCard.skills.map((s) => s.name).join(', '));
    setCategoriesText(initialCard.categories.join(', '));
    setLinkedInHandle(
      initialCard.socialNetworks.find((s) => s.platform === 'LinkedIn')?.username ?? ''
    );
    setGithubHandle(
      initialCard.socialNetworks.find((s) => s.platform === 'GitHub')?.username ?? ''
    );
    setUseZK(initialCard.sharingPreferences.useZK);
    setAllowForwarding(initialCard.sharingPreferences.allowForwarding);
    setSelectedFormat(initialCard.sharingPreferences.sharingFormat);
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
    useZK,
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
    setUseZK,
    setAllowForwarding,
    setSelectedFormat,
  };
}
