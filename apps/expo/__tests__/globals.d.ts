/**
 * Test-only ambient types. `@babel/core` ships untyped and is reached through
 * the workspace root's hoisted install; the artifact-level worklet test uses
 * exactly this slice of its API, so declare that instead of adding
 * `@types/babel__core` as a dependency for one test.
 */
declare module '@babel/core' {
  export interface BabelFileResult {
    readonly code: string | null;
  }
  export function transformFileSync(
    filename: string,
    options: {
      readonly babelrc?: boolean;
      readonly configFile?: boolean;
      readonly presets?: readonly string[];
      readonly plugins?: readonly string[];
    },
  ): BabelFileResult | null;
}
