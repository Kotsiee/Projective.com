import { signal } from "@preact/signals";
import {
	hasStages,
	ROLE_SECTION_LABEL,
	STAGE_SECTION_LABEL,
} from "../types/projects-types.ts";
import type { IconName } from "@projective/ui/icons";
import type { ProjectSetup } from "../types/projects-types.ts";

/**
 * setup-sections — the ONE registry of the owner setup surface's sections, and the anchor identity
 * shared by the form that renders them and the side nav that jumps to them.
 *
 * It exists because two hydration roots have to agree on a string. The form renders
 * `<section id={anchorId(key)}>` as SERVER components; the nav renders `<a href={"#" + anchorId(key)}>`
 * from its own island. If each minted its own id the nav would still look right, still be keyboard
 * reachable and still do nothing — the §3 gate-11 defect, invisible to the type-checker and to a
 * source-reading review because both halves are individually correct.
 *
 * Kept deliberately free of JSX and of any `@server/*` import so it is safe on both sides of the
 * island boundary, and pure so the ordering rule can be unit-tested without a DOM.
 */

// #region Section vocabulary
/**
 * Which section of the setup form a row addresses, in render order.
 *
 * `stages` and `roles` are mutually exclusive — an engagement is staffed one way or the other — and
 * {@link setupSections} picks between them, so a nav built from this list never offers a jump to a
 * section that is not on the page.
 */
export type SetupSectionKey =
	| "basics"
	| "description"
	| "budget"
	| "stages"
	| "roles"
	| "attachments"
	| "rules";

/**
 * The DOM id a section anchors on.
 *
 * Prefixed so it cannot collide with an id minted by any other surface sharing the page — the shell,
 * a portalled overlay, or a channel body — since a duplicate id makes `#basics` resolve to whichever
 * element happens to come first in document order.
 */
export function anchorId(key: SetupSectionKey): string {
	return `psu-${key}`;
}

/** One row of the side nav, and one section of the form. */
export interface SetupSectionMeta {
	key: SetupSectionKey;
	/** The heading the section renders and the label the nav shows — one string, so they cannot drift. */
	label: string;
	/** The nav's leading glyph, from the `@projective/ui/icons` registry (§B.7). */
	icon: IconName;
}

/**
 * The sections this engagement's shape calls for, in order.
 *
 * Three rules, each keyed on a field the SSOT already owns rather than on a second flag:
 *
 *  - a role-staffed engagement (`structure === "single_task"`) takes `roles` where every other takes
 *    `stages`, which is the same discrimination `setupSteps` makes when it emits its staffing row;
 *  - a stage-LESS engagement (the Has-stages toggle off) still renders the `stages` section, because
 *    that section is where the toggle itself lives — removing it would take away the only control
 *    that can turn stages back on;
 *  - `attachments` is unconditional. A project with no reference files is the common case, and a
 *    section that appears only once it has content is a section nobody can add the first item to.
 */
export function setupSections(setup: ProjectSetup): SetupSectionMeta[] {
	const roleStaffed = setup.structure === "single_task";
	const staffing: SetupSectionMeta = roleStaffed
		? { key: "roles", label: ROLE_SECTION_LABEL, icon: "members" }
		: {
			key: "stages",
			label: STAGE_SECTION_LABEL[setup.format],
			icon: "stages",
		};

	return [
		{ key: "basics", label: "Basics", icon: "info" },
		{ key: "description", label: "Description", icon: "document" },
		{ key: "budget", label: budgetSectionLabel(setup), icon: "wallet" },
		staffing,
		{ key: "attachments", label: "Attachments & NDA", icon: "attachment" },
		{ key: "rules", label: "Terms & visibility", icon: "shield" },
	];
}

/** The heading a format gives its budget section. */
export function budgetSectionLabel(setup: ProjectSetup): string {
	if (setup.format === "session") return "Session pricing";
	if (setup.format === "pipeline") return "Budget & pricing";
	return "Budget";
}

/** The heading a format gives its staffing section. */
export function staffingSectionLabel(setup: ProjectSetup): string {
	return setup.structure === "single_task"
		? ROLE_SECTION_LABEL
		: STAGE_SECTION_LABEL[setup.format];
}

/** Whether the stage list itself renders, as opposed to just the toggle that turns it back on. */
export function stageListVisible(setup: ProjectSetup): boolean {
	return hasStages(setup.structure);
}
// #endregion

// #region Cross-island view state
/**
 * Which section the reader is currently looking at — written by the nav's scroll probe, read by the
 * nav's own rows.
 *
 * It lives here rather than in `setup-state.ts` because it is not part of the configuration: it is
 * never saved, never fingerprinted and never sent. Putting it in the draft store would make a scroll
 * event look like an edit to `setupDirty`, which is measured by fingerprinting the draft — and the
 * footer's Save ⁄ Discard pair would then appear because somebody scrolled.
 *
 * `null` until the probe has run once, which is the honest state: before hydration no section is
 * known to be active, and the nav renders no active row rather than guessing at the first one.
 */
export const activeSection = signal<SetupSectionKey | null>(null);

/** Clear the probe's state — the nav island calls this on unmount. */
export function resetActiveSection(): void {
	activeSection.value = null;
}
// #endregion
