/**
 * `/files` — the asset hub's root.
 *
 * The handler and the page are the wildcard route's, re-exported rather than restated. That is
 * deliberate: the root and a deep folder differ by exactly one thing — how many path segments the URL
 * carried — and everything else (which owner the read is attributed to, how the simulation overlay is
 * parsed, which params the bootstrap is given, which island renders) is identical. Two copies of that
 * resolution would be two places for the library root to start behaving differently from the folder
 * one click inside it, and the divergence would show up as a bug nobody could reproduce from the
 * deep link.
 *
 * `[...path].tsx` already matches zero trailing segments, so this file exists for explicitness — a
 * reader looking for "where does `/files` come from" finds it named — and it resolves through the
 * same module, so the two can never drift.
 */
export { default, handler } from "./[...path].tsx";
