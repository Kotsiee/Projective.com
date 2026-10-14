import type { JSX } from "preact";
import { InlineNotice } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import { SIMULATION_BANNER, simulationOutcome } from "../core/simulation.ts";

/**
 * SimulationNotices — the two statements the owner's buyer simulation makes (Decision #217 (j)): the
 * banner the frame leads with, and the outcome a commit resolved to.
 */

/** The banner a simulated listing page leads with, in the frame's first row (where Back sits). */
export function SimulationBanner(): JSX.Element {
	return (
		<div class="evp-simbanner" data-simulation-banner>
			<InlineNotice
				text={SIMULATION_BANNER}
				icon={<Icon name="info" size="sm" />}
				align="start"
			/>
		</div>
	);
}

/**
 * The would-be outcome of the last simulated commit, shown beside the control that committed (the
 * CTA rig, or a modal's body). Renders nothing until something has been pressed. It is not a live
 * region of its own: `commitOrSimulate` already announces the same sentence on the page's shared
 * status line, and two regions would read it twice.
 */
export function SimulationOutcome(): JSX.Element | null {
	const outcome = simulationOutcome.value;
	if (!outcome) return null;
	return (
		<p class="evp-simoutcome" data-simulation-outcome>
			<Icon name="check" size="sm" class="evp-simoutcome__icon" aria-hidden />
			<span class="evp-simoutcome__text">{outcome}</span>
		</p>
	);
}
