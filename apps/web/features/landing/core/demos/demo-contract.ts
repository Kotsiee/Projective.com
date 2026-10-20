/**
 * demo-contract — what the demo stage's host hands every demo, and what a demo is
 * (`flows/LANDING.md` §2.1 notes 10–13, §4.4, §6; work order L3).
 *
 * The stage (`components/DemoStage.tsx`) renders one tabbed viewport; its island host
 * (`islands/DemoHost.island.tsx`) lazily imports only the active demo module and renders its
 * default export with {@link DemoProps}. Each demo lives in
 * `features/landing/components/demos/<Name>.demo.tsx` (outside `islands/`, so the server snapshot
 * never evaluates it) and imports its own stylesheet, `features/landing/styles/demos/<name>.css`.
 * A demo is a pure simulation over typed fixtures: it never fetches and never writes.
 */
import type * as preact from "preact";

// #region Contract
export type DemoId = "board" | "payments" | "booking" | "splits";

export interface DemoProps {
	/** Platform fee in basis points from the server (PublicMetricsService platformFeeBp); null = unavailable → drop every fee clause per LANDING.md §4 "If the fee is unavailable". */
	feeBp: number | null;
	/** Either reduced-motion channel is on: render the FRAME MODE (a labelled sequence with Previous step / Next step / "Step {n} of {total}") instead of live motion. */
	reducedMotion: boolean;
	/** Increments each time the stage's "Start again" is pressed; reset all demo state when it changes. */
	resetSignal: number;
	/** Polite live-region announcement owned by the host. */
	announce: (message: string) => void;
}

export type DemoComponent = (props: DemoProps) => preact.JSX.Element;
// #endregion
