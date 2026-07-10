import { describe, expect, it, mock } from 'bun:test';

await mock.module('react-native', () => ({
  ...((globalThis as unknown as { __AIRMEISHI_RN_MOCK__: Record<string, unknown> })
    .__AIRMEISHI_RN_MOCK__),
  Appearance: { getColorScheme: () => 'light' },
  FlatList: 'FlatList',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  StyleSheet: {
    create: <T extends object>(styles: T): T => styles,
    flatten: (style: unknown): unknown => style,
  },
  Switch: 'Switch',
  Text: 'Text',
  TurboModuleRegistry: {
    get: () => null,
    getEnforcing: () => ({}),
  },
  View: 'View',
  findNodeHandle: () => null,
  useColorScheme: () => 'light',
}));

await mock.module('@/components/icons/SfIcon', () => ({
  SfIcon: 'SfIcon',
}));

await mock.module('@/components/common/PressableScale', () => ({
  PressableScale: 'PressableScale',
}));

const { SettingsScreenTitle } = await import('../../src/components/settings/SettingsBlocks');

interface ElementLike {
  type?: unknown;
  props?: Record<string, unknown> & {
    children?: unknown;
    accessibilityLabel?: string;
    style?: Record<string, unknown>;
  };
}

function childrenOf(node: ElementLike): unknown[] {
  const children = node.props?.children;
  if (children == null || typeof children === 'boolean') return [];
  return Array.isArray(children) ? children : [children];
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

function findText(node: unknown, content: string): ElementLike | undefined {
  if (node == null || typeof node !== 'object') return undefined;
  const element = node as ElementLike;
  if (element.type === 'Text' && element.props?.children === content) return element;

  for (const child of childrenOf(element)) {
    const match = findText(child, content);
    if (match) return match;
  }

  return undefined;
}

describe('SettingsScreenTitle', () => {
  it('keeps the back action, title, and trailing action on one navigation row', () => {
    const onBack = () => undefined;
    const onScan = () => undefined;

    const tree = SettingsScreenTitle({
      title: 'Settings',
      leadingAction: {
        icon: 'chevron.left',
        accessibilityLabel: 'Back',
        onPress: onBack,
      },
      trailingAction: {
        icon: 'qrcode.viewfinder',
        accessibilityLabel: 'Scan',
        onPress: onScan,
      },
    } satisfies Parameters<typeof SettingsScreenTitle>[0]);

    expect(findText(tree, 'Settings')).toBeDefined();

    const backAction = findByAccessibilityLabel(tree, 'Back');
    expect(backAction?.props?.['onPress']).toBe(onBack);
    expect(backAction?.props?.style).toMatchObject({ left: 8, width: 44 });

    const trailingAction = findByAccessibilityLabel(tree, 'Scan');
    expect(trailingAction?.props?.['onPress']).toBe(onScan);
    expect(trailingAction?.props?.style).toMatchObject({ right: 8, width: 44 });
  });
});
