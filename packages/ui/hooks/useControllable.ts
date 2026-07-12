/**
 * Package-level re-export of the signal-first controllable-value contract. The canonical
 * implementation lives with the fields taxonomy (its first consumer); re-exporting here gives every
 * other taxonomy a single stable `@projective/ui/hooks` import path without duplicating the logic.
 */
export { useControllable } from "../fields/hooks/useControllable.ts";
export type { Controllable } from "../fields/hooks/useControllable.ts";
