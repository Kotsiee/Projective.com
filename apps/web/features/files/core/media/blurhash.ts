/**
 * blurhash — re-exported from `@projective/types/files`, where the encoder now lives so the server-side
 * media pipeline and this browser extractor run the same code. Kept at this path so existing imports
 * (and `blurhash.test.ts`) are unchanged.
 */
export { componentsFor, encodeBlurHash } from "@projective/types/files";
