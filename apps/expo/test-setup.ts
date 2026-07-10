/**
 * bun test preload — runs once before any test file.
 *
 * Globals like `expect.each` / `it.each` are bun built-ins (since bun 1.2).
 * Native modules that touch JSI (mmkv, secure-store, vision-camera, nitro)
 * are stubbed lazily — only the suites that import them install a mock,
 * which keeps the parity tests (pure TS over fixtures) fast + isolated.
 */
/* eslint-disable @typescript-eslint/require-await */
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

Object.defineProperty(globalThis, 'expo', {
  configurable: true,
  value: {
    EventEmitter: class {
      addListener(): { remove: () => undefined } {
        return { remove: (): undefined => undefined };
      }
      removeAllListeners(): undefined {
        return undefined;
      }
    },
  },
  writable: true,
});

const host = (type: string) => type;

const baseReactNativeMock = {
  ActivityIndicator: host('ActivityIndicator'),
  AppRegistry: {
    registerComponent: () => undefined,
    registerRunnable: () => undefined,
    runApplication: () => undefined,
    unmountApplicationComponentAtRootTag: () => undefined,
  },
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
  LogBox: {
    ignoreAllLogs: () => undefined,
    ignoreLogs: () => undefined,
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
};

Object.defineProperty(globalThis, '__AIRMEISHI_RN_MOCK__', {
  configurable: true,
  value: baseReactNativeMock,
  writable: false,
});

await mock.module('react-native', () => baseReactNativeMock);

await mock.module('react-native/Libraries/NativeComponent/NativeComponentRegistry', () => ({
  get: (name: string) => host(name),
  getWithFallback_DEPRECATED: (name: string) => host(name),
  setRuntimeConfigProvider: () => undefined,
}));

class MockAsset {
  uri: string;
  localUri: string | null;
  downloaded = true;

  constructor(uri = '') {
    this.uri = uri;
    this.localUri = uri;
  }

  static fromModule(moduleId: unknown): MockAsset {
    return new MockAsset(typeof moduleId === 'string' ? moduleId : '');
  }

  static fromURI(uri: string): MockAsset {
    return new MockAsset(uri);
  }

  async downloadAsync(): Promise<this> {
    return this;
  }
}

await mock.module('expo-asset', () => ({
  Asset: MockAsset,
  useAssets: () => [[], null],
}));

await mock.module('expo-asset/build/ExpoAsset', () => ({
  downloadAsync: async (url: string) => url,
}));

await mock.module('expo-asset/build/ExpoAsset.js', () => ({
  downloadAsync: async (url: string) => url,
}));

await mock.module('expo-constants', () => ({
  default: {
    expoConfig: {},
    manifest: {},
    platform: { ios: {}, android: {} },
  },
  expoConfig: {},
  manifest: {},
}));

await mock.module('expo-local-authentication', () => ({
  hasHardwareAsync: async () => true,
  isEnrolledAsync: async () => true,
  authenticateAsync: async () => ({ success: true }),
}));

const mockSQLiteDatabase = {
  execAsync: async () => undefined,
  runAsync: async () => ({ changes: 0, lastInsertRowId: 0 }),
  getAllAsync: async () => [],
  getFirstAsync: async () => null,
  closeAsync: async () => undefined,
};

await mock.module('expo-sqlite', () => ({
  openDatabaseAsync: async () => mockSQLiteDatabase,
  openDatabaseSync: () => mockSQLiteDatabase,
}));

await mock.module('expo-sqlite/build/ExpoSQLite', () => ({
  default: {
    openDatabaseAsync: async () => mockSQLiteDatabase,
    openDatabaseSync: () => mockSQLiteDatabase,
  },
}));

await mock.module('expo-sqlite/build/ExpoSQLite.js', () => ({
  default: {
    openDatabaseAsync: async () => mockSQLiteDatabase,
    openDatabaseSync: () => mockSQLiteDatabase,
  },
}));
