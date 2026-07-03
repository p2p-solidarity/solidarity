/**
 * bun test preload — runs once before any test file.
 *
 * Globals like `expect.each` / `it.each` are bun built-ins (since bun 1.2).
 * Native modules that touch JSI (mmkv, secure-store, vision-camera, nitro)
 * are stubbed lazily — only the suites that import them install a mock,
 * which keeps the parity tests (pure TS over fixtures) fast + isolated.
 */
import { mock } from 'bun:test';

Object.defineProperty(globalThis, '__DEV__', {
  configurable: true,
  value: false,
  writable: true,
});

Object.defineProperty(globalThis, 'NitroModulesProxy', {
  configurable: true,
  value: {
    version: '0.35.7',
    createHybridObject: (): never => {
      throw new Error('NitroModulesProxy is unavailable in bun tests');
    },
  },
  writable: true,
});

const host = (type: string) => type;

await mock.module('react-native', () => ({
  ActivityIndicator: host('ActivityIndicator'),
  Appearance: {
    getColorScheme: () => 'light',
    setColorScheme: () => undefined,
  },
  AppState: {
    currentState: 'active',
    addEventListener: () => ({ remove: (): undefined => undefined }),
  },
  Dimensions: {
    get: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  },
  DeviceEventEmitter: {
    addListener: () => ({ remove: (): undefined => undefined }),
    emit: () => undefined,
    removeAllListeners: () => undefined,
  },
  FlatList: host('FlatList'),
  Image: host('Image'),
  Linking: {
    canOpenURL: async () => true,
    openURL: async () => undefined,
  },
  Modal: host('Modal'),
  NativeEventEmitter: class {
    addListener(): { remove: () => undefined } {
      return { remove: (): undefined => undefined };
    }
    removeAllListeners(): undefined {
      return undefined;
    }
  },
  NativeModules: {},
  PixelRatio: {
    get: () => 3,
    getFontScale: () => 1,
    getPixelSizeForLayoutSize: (size: number) => Math.round(size * 3),
    roundToNearestPixel: (size: number) => size,
  },
  Platform: {
    OS: 'ios',
    select: <T,>(spec: { readonly ios?: T; readonly android?: T; readonly web?: T; readonly default?: T }) =>
      spec.ios ?? spec.default,
  },
  Pressable: host('Pressable'),
  RefreshControl: host('RefreshControl'),
  ScrollView: host('ScrollView'),
  Share: {
    sharedAction: 'sharedAction',
    dismissedAction: 'dismissedAction',
    share: async () => ({ action: 'sharedAction' }),
  },
  StyleSheet: {
    create: <T extends object>(styles: T): T => styles,
    flatten: (style: unknown): unknown => style,
  },
  Switch: host('Switch'),
  Text: host('Text'),
  TextInput: host('TextInput'),
  TurboModuleRegistry: {
    get: () => null,
    getEnforcing: () => ({ install: (): undefined => undefined }),
  },
  View: host('View'),
  findNodeHandle: () => null,
  useColorScheme: () => 'light',
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

await mock.module('react-native/Libraries/NativeComponent/NativeComponentRegistry', () => ({
  get: (name: string) => host(name),
  getWithFallback_DEPRECATED: (name: string) => host(name),
  setRuntimeConfigProvider: () => undefined,
}));
