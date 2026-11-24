import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import type { WorkloadCapacity } from "@projective/types/projects";
import { ProgressBar } from "@projective/ui/feedback";
import "../styles/workload.css";
import { gaugeCopy } from "../core/workload-copy.ts";
import { ensureWorkload, workloadWith } from "../core/workload-state.ts";

/** The bar's ramp per level; the note below it says the same thing in words. */
const SEVERITY = { normal: "primary", near: "warning", at: "danger" } as const;

/** Props for {@link WorkloadGauge}. */
export interface WorkloadGaugeProps {
	/**
	 * The caller's load as the route read it (`ProjectWorkloadService.mine`), so the server renders the
	 * figures and the header never jumps; `null` when the read failed or answered nothing.
	 */
	initial: WorkloadCapacity | null;
}

/**
 * WorkloadGauge — the freelancer's own Σ W_i against their global cap (PRODUCT_SPEC §Resource
 * Allocation & Ticketing 3; PROJECTS ST4, Decision ruling 15), in the `/projects` header:
 *
 *     WORKLOAD                       2 of 5
 *     ▓▓▓▓▓▓▓░░░░░░░░░░
 *     2 tickets held · 3 free
 *
 * Unboxed type on the header's ground: a section-header label, a tabular figure, the ui
 * `ProgressBar`, and one meta line that states the level in words, so colour is never its only
 * channel. Reads the shared `workload-state` store (a claim elsewhere on the page moves it) and the
 * Dev Context Switcher's `workload` axis. Renders nothing without a figure.
 */
export default function WorkloadGauge({ initial }: WorkloadGaugeProps): JSX.Element | null {
	// The external read only when the route had none; a store other surfaces share coalesces it.
	useEffect(() => {
		if (!initial) ensureWorkload();
	}, []);

	const capacity = workloadWith(initial);
	if (!capacity) return null;
	const copy = gaugeCopy(capacity);

	return (
		<section class="prj-load" data-level={copy.level} aria-labelledby="prj-load-title">
			<p class="prj-load__head">
				<span class="prj-load__title" id="prj-load-title">Workload</span>
				<span class="prj-load__figure">{copy.figure}</span>
			</p>
			<ProgressBar
				class="prj-load__bar"
				value={copy.percent}
				severity={SEVERITY[copy.level]}
				aria-label={copy.label}
			/>
			<p class="prj-load__note">{copy.note}</p>
		</section>
	);
}
