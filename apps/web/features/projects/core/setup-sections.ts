import { signal } from "@preact/signals";
import {
	hasStages,
	pricedAtProjectLevel,
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
	| "details"
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
 *  - a stage-LESS engagement (the Use-stages toggle off) takes `details` INSTEAD of `stages` — the
 *    same terms, asked flat. The toggle used to live inside the stage section, which is why that
 *    section had to survive being turned off; it now lives in Basics, so the section it governs can
 *    genuinely leave and be replaced rather than collapsing to the one control that undoes it;
 *  - `budget` renders ONLY where the engagement has no stage to carry its price
 *    ({@link pricedAtProjectLevel}). A staged run prices each stage and a flat one prices its root
 *    stage inside `details`, so on either of those a project-level amount would be a SECOND answer to
 *    "what does this cost" sitting beside the first — and the one the money path reads is the stage's,
 *    since `finance.fn_hold_ticket_escrow` looks at `unit_price_cents` and nowhere else;
 *  - `attachments` is unconditional. A project with no reference files is the common case, and a
 *    section that appears only once it has content is a section nobody can add the first item to.
 *
 * `details` is placed directly after `description`, where the spec puts it, because on a flat project
 * the description IS the scope and these are its terms — the two read as one statement of the work.
 * The staged branch keeps its list in the same slot, where a run of priced stages belongs.
 */
export function setupSections(setup: ProjectSetup): SetupSectionMeta[] {
	const roleStaffed = setup.structure === "single_task";
	const flat = !roleStaffed && !hasStages(setup.structure);

	const sections: SetupSectionMeta[] = [
		{ key: "basics", label: "Basics", icon: "info" },
		{ key: "description", label: "Description", icon: "document" },
	];

	if (flat) sections.push({ key: "details", label: "Details", icon: "stages" });

	if (pricedAtProjectLevel(setup.structure)) {
		sections.push({ key: "budget", label: budgetSectionLabel(setup), icon: "wallet" });
	}

	if (roleStaffed) {
		sections.push({ key: "roles", label: ROLE_SECTION_LABEL, icon: "members" });
	} else if (!flat) {
		sections.push({
			key: "stages",
			label: STAGE_SECTION_LABEL[setup.format],
			icon: "stages",
		});
	}

	sections.push(
		{ key: "attachments", label: "Attachments & NDA", icon: "attachment" },
		{ key: "rules", label: "Terms & visibility", icon: "shield" },
	);
	return sections;
}

/**
 * The heading a format gives its budget section.
 *
 * Kept total over every format although only the last branch is reachable today: the section renders
 * on {@link pricedAtProjectLevel}, which is true for `single_task` alone, and a Direct Deliverable is
 * always a `one_off`. The other two arms exist for a legacy or hand-written row whose `format` and
 * `structure` disagree, and so that widening the visibility rule does not also need a label written
 * for it.
 */
export function budgetSectionLabel(setup: ProjectSetup): string {
	if (setup.format === "session") return "Session pricing";
	if (setup.format === "pipeline") return "Budget & pricing";
	return "Budget";
}

/** The heading a format gives its staffing section. */
export function staffingSectionLabel(setup: ProjectSetup): string {
	return setup.structure === "single_task" ? ROLE_SECTION_LABEL : STAGE_SECTION_LABEL[setup.format];
}

/**
 * Whether this engagement renders the stage LIST rather than the flat Details section.
 *
 * False for a role-staffed engagement too, which takes neither: it has its own `roles` section.
 */
export function stageListVisible(setup: ProjectSetup): boolean {
	return setup.structure !== "single_task" && hasStages(setup.structure);
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
