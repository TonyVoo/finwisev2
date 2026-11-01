/** Bundled images are imported as the numeric asset id React Native's `Image` takes as a `source`. */
declare module '*.png' {
  const source: number;
  export default source;
}
