/// <reference types="react-native" />

declare module '*.css';
declare module '*.json' {
  const value: unknown;
  export default value;
}
