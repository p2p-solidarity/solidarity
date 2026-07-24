import { beforeEach, describe, expect, it, mock } from 'bun:test';

interface ButtonProps {
  readonly label: string;
  readonly onPress?: () => void;
}

interface ElementLike {
  readonly type?: unknown;
  readonly props?: Record<string, unknown> & {
    readonly children?: unknown;
  };
}

const events: string[] = [];
const capturedButtons: ButtonProps[] = [];
const react = await import('react');
let hookIndex = 0;
let hookStates: unknown[] = [];

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

await mock.module('react', () => ({
  ...react,
  useState: <T,>(initialValue: T | (() => T)): [T, (next: T) => void] => {
    const index = hookIndex;
    hookIndex += 1;
    if (!(index in hookStates)) {
      hookStates[index] =
        typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue;
    }
    return [
      hookStates[index] as T,
      (next) => {
        hookStates[index] = next;
      },
    ];
  },
}));

await mock.module('expo-router', () => ({
  router: {
    push: () => {
      events.push('navigate');
    },
  },
}));

await mock.module('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

await mock.module('@/components/common/PressableScale', () => ({
  PressableScale: 'PressableScale',
}));

await mock.module('@/components/icons/SfIcon', () => ({
  SfIcon: 'SfIcon',
}));

await mock.module('@/components/themed', () => ({
  ThemedButton: (props: ButtonProps) => {
    capturedButtons.push(props);
    return host('ThemedButton', { children: props.label });
  },
  ThemedText: 'ThemedText',
}));

await mock.module('@/components/scan/VerifiedProfileView', () => ({
  VerifiedProfileView: 'VerifiedProfileView',
}));

await mock.module('@/constants/Colors', () => ({
  Colors: {
    destructive: 'destructive',
    pageBg: 'pageBg',
    text2: 'text2',
  },
}));

await mock.module('@/feedback/confirmDialog', () => ({
  confirmDialog: async () => true,
}));

await mock.module('@/feedback/toast', () => ({
  pushToast: () => {
    events.push('toast');
  },
}));

await mock.module('@/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

await mock.module('@/people/profileSnapshots', () => ({
  useProfileSnapshot: () => undefined,
  useProfileSnapshotStore: (
    selector: (state: { mergeVerified: () => { kind: 'saved' } }) => unknown,
  ) =>
    selector({
      mergeVerified: () => {
        events.push('merge');
        return { kind: 'saved' };
      },
    }),
}));

await mock.module('@/scan/verifiedPageResult', () => ({
  useVerifiedPageResult: (
    selector: (state: {
      result: {
        kind: 'verified';
        record: { did: string };
        jws: string;
      };
      resolving: boolean;
      dismiss: () => void;
    }) => unknown,
  ) =>
    selector({
      result: {
        kind: 'verified',
        record: { did: 'did:key:zAlice' },
        jws: 'signed-profile',
      },
      resolving: false,
      dismiss: () => {
        events.push('dismiss');
      },
    }),
}));

const { VerifiedPageResultSheet } = await import(
  '../../src/components/scan/VerifiedPageResultSheet'
);

function renderSheet(): void {
  hookIndex = 0;
  capturedButtons.length = 0;
  renderNode(VerifiedPageResultSheet());
}

beforeEach(() => {
  events.length = 0;
  capturedButtons.length = 0;
  hookIndex = 0;
  hookStates = [];
});

describe('VerifiedPageResultSheet save navigation', () => {
  it('saves, toasts, and dismisses back to the launch origin without navigating', () => {
    renderSheet();

    const save = capturedButtons.find((button) => button.label === 'verifiedPage.saveToPeople');
    expect(save?.onPress).toBeDefined();
    save?.onPress?.();

    expect(events).toEqual(['merge', 'toast', 'dismiss']);
  });

  it('only opens the saved People detail when the user deliberately chooses View in People', () => {
    renderSheet();

    const view = capturedButtons.find((button) => button.label === 'people.viewInPeople');
    expect(view?.onPress).toBeDefined();
    view?.onPress?.();

    expect(events).toEqual(['merge', 'toast', 'dismiss', 'navigate']);
  });
});
