/**
 * `@projective/ui/display/blurhash` — the pure BlurHash decoder alone, importable where no DOM and
 * no stylesheet may follow (a server module, a unit test). Same module as `./display/image` exports;
 * a narrower door.
 */

export { blurHashAverage, decodeBlurHash, isBlurHash } from "./core/blurhash.ts";
