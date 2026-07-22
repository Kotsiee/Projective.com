import { signal } from "@preact/signals";
import type { ExploreParams } from "./explore-state.ts";

/**
 * filter-bridge — the cross-island channel that connects the relocated Search filter lane (rendered in
 * the navigation sidebar by the shell) to the {@link SearchDashboard} island (which owns the query
 * state + fetching, in the page body). The two are separate hydration roots, but both import this
 * singleton module, so the signals below are one shared instance across them (the same pattern the
 * project board/view/submission islands use — CLAUDE.md Decisions #33/#35).
 *
 * Data flows one loop:
 *   SearchDashboard  ──(publishes params + commit on mount/change)──▶  bridge  ──▶  filter lane reads
 *   filter lane      ──(user toggles a facet, calls bridgeCommit)────▶  SearchDashboard.commit → fetch
 *
 * The lane still SSR-renders from its own `initialParams` prop (correct first paint); the bridge only
 * takes over live, so there is no hydration flash and no empty sidebar before the dashboard hydrates.
 */

/** The live query params — published by SearchDashboard on every change; read by the filter lane. */
export const bridgeParams = signal<ExploreParams | null>(null);

/**
 * SearchDashboard's `commit(next)` — applies a new params set (fetch + shareable URL push). Set on the
 * dashboard's mount and cleared on unmount; the filter lane calls it to apply a facet change. Null
 * until the dashboard hydrates (a brief window in which facet clicks are inert by design).
 */
export const bridgeCommit = signal<((next: ExploreParams) => void) | null>(null);
