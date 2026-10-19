/**
 * The props of the legal version controls island, in a module of their own so the server-rendered
 * document view (and its render test) can type the island slot without importing the island — an
 * island imports CSS, which `deno test` cannot load.
 *
 * @module
 */
import type { LegalVersionStatus } from "../core/versions.ts";

/** One version as the controls offer it. */
export interface LegalVersionOption {
	version: string;
	/** `2.0 — current`, `1.0 — effective 1 August 2026` (formatted on the server). */
	label: string;
	status: LegalVersionStatus;
}

/** Props for the `LegalVersionControls` island. */
export interface LegalVersionControlsProps {
	slug: string;
	/** Every version, newest first. */
	versions: LegalVersionOption[];
	/** The version shown on the page. */
	shown: string;
	/** The version in effect today. */
	current: string;
	/** The older version the page is compared against, or `null`. */
	compare: string | null;
	/** One sentence about the only version, when there is just one (`1.0 · in effect since …`). */
	onlyVersionNote?: string;
}
