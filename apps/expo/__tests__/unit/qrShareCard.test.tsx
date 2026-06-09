import { describe, expect, it, mock } from 'bun:test';

const react = await import('react');
let hookStates: unknown[] = [];
let hookIndex = 0;

await mock.module('react', () => ({
  ...react,
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
  Text: 'Text',
  View: 'View',
}));

await mock.module('expo-image', () => ({
  Image: (props: Record<string, unknown>) => host('ExpoImage', props),
}));

await mock.module('react-native-qrcode-svg', () => ({
  default: (props: Record<string, unknown>) => host('QRCode', props),
}));

await mock.module('@/components/common/PressableScale', () => ({
  PressableScale: (props: Record<string, unknown>) => host('PressableScale', props),
}));

await mock.module('@/components/icons/SfIcon', () => ({
  SfIcon: (props: Record<string, unknown>) => host('SfIcon', props),
}));

await mock.module('@/components/share/FieldPillRow', () => ({
  FieldPillRow: (props: Record<string, unknown>) => host('FieldPillRow', props),
}));

await mock.module('@/components/themed', () => ({
  ThemedButton: (props: Record<string, unknown>) => host('ThemedButton', props),
}));

await mock.module('@/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const { QrShareCard } = await import('../../src/components/share/QrShareCard');

interface ElementLike {
  readonly type?: unknown;
  readonly props?: Record<string, unknown> & {
    readonly children?: unknown;
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

function isComponent(type: unknown): type is (props: Record<string, unknown>) => unknown {
  return typeof type === 'function';
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

function findByType(node: unknown, type: string): ElementLike | undefined {
  if (node == null || typeof node !== 'object') return undefined;
  const element = node as ElementLike;
  if (element.type === type) return element;
  for (const child of childrenOf(element)) {
    const match = findByType(child, type);
    if (match) return match;
  }
  return undefined;
}

describe('QrShareCard', () => {
  it('renders a generated QR image URI instead of encoding raw payload in-place', () => {
    hookStates = [true, 240];
    hookIndex = 0;
    const qrImageUri = 'data:image/svg+xml;base64,PHN2Zy8+';

    const tree = renderNode(
      QrShareCard({
        qrImageUri,
        cardName: 'Ada Lovelace',
        enabledFields: ['name'],
        hasRealHuman: false,
        onOpenSettings: () => undefined,
        onShare: () => undefined,
      })
    );

    const image = findByType(tree, 'ExpoImage');
    expect(image?.props?.['source']).toEqual({ uri: qrImageUri });
    expect(findByType(tree, 'QRCode')).toBeUndefined();
  });
});
