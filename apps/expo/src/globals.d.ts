/// <reference types="react-native" />

declare module '*.css';
declare module '*.json' {
  const value: unknown;
  export default value;
}

/** `bare-pack --out *.bundle.js` output (see pear/worklet/index.js header)
 *  — a `bundle.cjs`-format module whose default export is the raw bundle
 *  string `Worklet.start('/app.bundle', bundle)` expects. */
declare module '*.bundle.js' {
  const bundle: string;
  export default bundle;
}
