import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { BusinessCard, SharingFormat } from '@solidarity/shared';
import type { ReactNode } from 'react';

interface ButtonProps {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onPress?: () => void | Promise<void>;
}

const capturedButtons: ButtonProps[] = [];
const react = await import('react');
let hookStates: unknown[] = [];
let hookIndex = 0;

await mock.module('react', () => ({
  ...react,
  useEffect: () => undefined,
  useState: <T,>(initialValue: T | (() => T)): [T, (next: T | ((previous: T) => T)) => void] => {
    const index = hookIndex;
    hookIndex += 1;
    if (!(index in hookStates)) {
      hookStates[index] =
        typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue;
    }
    return [
      hookStates[index] as T,
      (next) => {
        const previous = hookStates[index] as T;
        hookStates[index] = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
      },
    ];
  },
}));

await mock.module('react-native', () => ({
  Appearance: { getColorScheme: () => 'light' },
  Platform: { OS: 'ios' },
  Pressable: ({
    accessibilityLabel,
    accessibilityValue,
    children,
    onPress,
  }: {
    readonly accessibilityLabel?: string;
    readonly accessibilityValue?: { readonly text?: string };
    readonly children?: ReactNode;
    readonly onPress?: () => void;
  }) =>
    host('Pressable', {
      accessibilityLabel,
      accessibilityValue,
      children,
      onPress,
    }),
  Switch: ({ value }: { readonly value?: boolean }) => host('Switch', { value }),
  Text: 'span',
  TextInput: ({
    onChangeText,
    placeholder,
    value,
  }: {
    readonly onChangeText?: (value: string) => void;
    readonly placeholder?: string;
    readonly value?: string;
  }) =>
    host('TextInput', {
      accessibilityLabel: placeholder,
      onChangeText,
      placeholder,
      value,
    }),
  View: 'div',
  useColorScheme: () => 'light',
}));

await mock.module('@/components/icons/SfIcon', () => ({
  SfIcon: 'SfIcon',
}));

await mock.module('@/components/themed', () => ({
  ThemedButton: (props: ButtonProps) => {
    capturedButtons.push(props);
    return host('ThemedButton', { children: props.label, disabled: props.disabled });
  },
}));

await mock.module('@/feedback/confirmDialog', () => ({
  confirmDialog: () => Promise.resolve(false),
}));

const { BusinessCardForm } = await import('../../src/components/cards/BusinessCardForm');
type BusinessCardFormProps = Parameters<typeof BusinessCardForm>[0];

interface ElementLike {
  readonly type?: unknown;
  readonly props?: Record<string, unknown> & {
    readonly accessibilityLabel?: string;
    readonly accessibilityValue?: { readonly text: string };
    readonly children?: unknown;
    readonly onChangeText?: unknown;
    readonly onPress?: unknown;
  };
}

function host(type: string, props: Record<string, unknown>): ElementLike {
  return { type, props };
}

function childrenOf(node: ElementLike): unknown[] {
  const children = node.props?.children;
  if (children == null || typeof children === 'boolean') return [];
  return Array.isArray(children) ? children : [children];
}

function renderNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(renderNode);
  if (node == null || typeof node !== 'object') return node;

  const element = node as ElementLike;
  if (isComponent(element.type)) {
    return renderNode(element.type(element.props ?? {}));
  }

  return {
    ...element,
    props: {
      ...element.props,
      children: childrenOf(element).map(renderNode),
    },
  };
}

function isComponent(type: unknown): type is (props: Record<string, unknown>) => unknown {
  return typeof type === 'function';
}

function isTextChangeHandler(value: unknown): value is (next: string) => void {
  return typeof value === 'function';
}

function isPressHandler(value: unknown): value is () => void {
  return typeof value === 'function';
}

function textContent(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (node == null || typeof node !== 'object') return '';
  return childrenOf(node as ElementLike)
    .map(textContent)
    .join('');
}

function renderForm(props: BusinessCardFormProps): unknown {
  hookIndex = 0;
  capturedButtons.length = 0;
  return renderNode(BusinessCardForm(props));
}

function findByAccessibilityLabel(node: unknown, label: string): ElementLike | undefined {
  if (node == null || typeof node !== 'object') return undefined;
  const element = node as ElementLike;
  if (element.props?.accessibilityLabel === label) return element;

  for (const child of childrenOf(element)) {
    const match = findByAccessibilityLabel(child, label);
    if (match) return match;
  }

  return undefined;
}

beforeEach(() => {
  capturedButtons.length = 0;
  hookStates = [];
  hookIndex = 0;
});

function makeCard(format: SharingFormat): BusinessCard {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    name: 'Ada Lovelace',
    title: 'Founder',
    company: 'Solidarity',
    email: 'ada@example.com',
    phone: '+15555550100',
    profileImage: undefined,
    animal: undefined,
    socialNetworks: [],
    skills: [],
    categories: [],
    sharingPreferences: {
      publicFields: new Set(['name']),
      professionalFields: new Set(['name', 'title', 'company', 'email']),
      personalFields: new Set(['name', 'email', 'phone']),
      allowForwarding: false,
      expirationDate: undefined,
      useZK: true,
      sharingFormat: format,
    },
    groupContext: undefined,
    verifiedFields: undefined,
    nameType: 'display_name',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('BusinessCardForm sharing format policy', () => {
  it('renders the ZK/DID format switch without plaintext', () => {
    const tree = renderForm({ initialCard: makeCard('zkProof'), onSave: () => undefined });
    const text = textContent(tree);

    expect(text).toContain('Sharing format');
    expect(text).toContain('ZK Proof');
    expect(text).not.toContain('Use ZK proof');
    expect(text).not.toContain('Plaintext');
  });

  it('creates new cards with ZK proof sharing format', async () => {
    let saved: BusinessCard | undefined;

    let tree = renderForm({
      forceCreate: true,
      onSave: (card) => {
        saved = card;
      },
    });
    const nameField = findByAccessibilityLabel(tree, 'Name');
    const onChangeText = nameField?.props?.onChangeText;
    if (!isTextChangeHandler(onChangeText)) throw new Error('Name input not found');
    onChangeText('Ada Lovelace');
    tree = renderForm({
      forceCreate: true,
      onSave: (card) => {
        saved = card;
      },
    });
    expect(textContent(tree)).toContain('ZK Proof');

    const createButton = capturedButtons.find((button) => button.label === 'Create Card');
    expect(createButton?.onPress).toBeDefined();
    await createButton?.onPress?.();

    expect(saved?.sharingPreferences.sharingFormat).toBe('zkProof');
  });

  it('saves legacy plaintext cards as ZK proof unless the user switches format', async () => {
    let saved: BusinessCard | undefined;

    renderForm({
      initialCard: makeCard('plaintext'),
      onSave: (card) => {
        saved = card;
      },
    });

    const saveButton = capturedButtons.find((button) => button.label === 'Save Changes');
    expect(saveButton?.onPress).toBeDefined();
    await saveButton?.onPress?.();

    expect(saved?.sharingPreferences.sharingFormat).toBe('zkProof');
  });

  it('can switch from ZK proof to DID-signed and save that choice', async () => {
    let saved: BusinessCard | undefined;

    let tree = renderForm({
      initialCard: makeCard('zkProof'),
      onSave: (card) => {
        saved = card;
      },
    });

    const formatRow = findByAccessibilityLabel(tree, 'Sharing format');
    expect(formatRow?.props?.accessibilityValue).toEqual({ text: 'ZK Proof' });
    const onPress = formatRow?.props?.onPress;
    if (!isPressHandler(onPress)) throw new Error('Sharing format row not found');
    onPress();

    tree = renderForm({
      initialCard: makeCard('zkProof'),
      onSave: (card) => {
        saved = card;
      },
    });
    expect(textContent(tree)).toContain('DID-Signed');

    const saveButton = capturedButtons.find((button) => button.label === 'Save Changes');
    expect(saveButton?.onPress).toBeDefined();
    await saveButton?.onPress?.();

    expect(saved?.sharingPreferences.sharingFormat).toBe('didSigned');
  });
});
