import { chromeOffset } from "@features/view/core/scroll-to.ts";
import { anchorId, setupSections } from "./setup-sections.ts";
import type { SetupSectionKey } from "./setup-sections.ts";
import type { ProjectSetup, ProjectSetupStep } from "../types/projects-types.ts";

/**
 * setup-progress — what the header's progress ring points at, and the jump that takes the owner there.
 *
 * The ring lives in the header island and the fields live in the form island: two hydration roots
 * that never exchange props. So the jump is resolved against the DOM the form rendered, through the
 * same `anchorId` registry the side rail uses, rather than through a ref one island would have to hand
 * the other. When the target is not on this page at all (the `/preview` sibling), the owner is sent to
 * the Details surface at the matching anchor instead of being given a control that does nothing
 * (root CLAUDE.md §3 gate 11).
 */

// #region Step selection
/** Every ladder row that is not done yet, in ladder order — what stands between the owner and 100%. */
export function remainingSteps(steps: readonly ProjectSetupStep[]): ProjectSetupStep[] {
	return steps.filter((step) => !step.done);
}

/**
 * The row the ring jumps to: the first outstanding REQUIRED row, else the first unfinished one.
 *
 * Required rows go first because they are what Preview and Publish are waiting on; an optional row
 * that happens to sit earlier in the ladder would otherwise send the owner past the thing actually
 * blocking them. `null` once the ladder is complete.
 */
export function nextSetupStep(steps: readonly ProjectSetupStep[]): ProjectSetupStep | null {
	return steps.find((step) => step.required && !step.done) ?? steps.find((step) => !step.done) ??
		null;
}
// #endregion

// #region Target resolution
/**
 * The form section a ladder row is answered in, or `null` for a row with no section (Publish lives in
 * the footer rig).
 *
 * Pricing is answered in whichever of Budget · Details · Stages this engagement's shape renders, so it
 * reads the same {@link setupSections} registry the form does rather than restating its rules.
 */
export function sectionForStep(
	step: ProjectSetupStep,
	setup: ProjectSetup,
): SetupSectionKey | null {
	const present = new Set(setupSections(setup).map((s) => s.key));
	const first = (...keys: SetupSectionKey[]) => keys.find((k) => present.has(k)) ?? null;

	switch (step.key) {
		case "title":
		case "format":
			return "basics";
		case "description":
			return "description";
		case "pricing":
			return first("budget", "details", "stages");
		case "stages":
			return first("stages", "details");
		case "roles":
			return "roles";
		case "rules":
			return "rules";
		case "publish":
			return null;
	}
}

/**
 * Candidate focus targets for a row, most specific first. Each is tried in turn and the first one that
 * is present, rendered and enabled wins; the section itself is the last resort.
 */
function fieldSelectors(step: ProjectSetupStep, section: SetupSectionKey | null): string[] {
	const scope = section ? `#${anchorId(section)}` : "";
	switch (step.key) {
		case "title":
			return ["#psu-title"];
		case "description":
			return [`${scope} [contenteditable="true"]`];
		case "pricing":
			return [
				"#psu-budget-amount",
				"#psu-details-price",
				// A staged run prices each row; the first row still flagging an outstanding term is the one.
				`${scope} .psu-stage:has(.psu-stage__outstanding) .psu-stage__main`,
				// …and a run with no rows yet has nothing to price until one is added.
				`${scope} .psu-add`,
			];
		case "stages":
		case "roles":
			return [`${scope} .psu-add`];
		case "publish":
			return ['.psu-rig__actions .psu-rig__action[aria-label="Publish"]'];
		default:
			return [];
	}
}

/** Whether `el` can genuinely take focus right now. */
function focusable(el: HTMLElement): boolean {
	if (el.closest("[inert]")) return false;
	if ((el as HTMLButtonElement).disabled) return false;
	return el.getClientRects().length > 0;
}

/** The wrapper a pulse should ring — the whole field rather than the bare control inside it. */
function highlightFor(target: HTMLElement): HTMLElement {
	return target.closest<HTMLElement>(".psu-field, .psu-validated, .psu-stage, .psu-role") ?? target;
}

/** A resolved jump: what receives focus and what is ringed. */
export interface SetupJumpTarget {
	focus: HTMLElement;
	highlight: HTMLElement;
}

/** Resolve a row to elements on this page, or `null` when the page does not render them. */
export function resolveStepTarget(
	step: ProjectSetupStep,
	setup: ProjectSetup,
): SetupJumpTarget | null {
	try {
		const section = sectionForStep(step, setup);
		for (const selector of fieldSelectors(step, section)) {
			const el = document.querySelector<HTMLElement>(selector);
			if (el && focusable(el)) return { focus: el, highlight: highlightFor(el) };
		}
		const host = section ? document.getElementById(anchorId(section)) : null;
		if (!host) return null;
		// A section is not focusable by default; `-1` makes it programmatically focusable without adding
		// it to the tab order, so a screen reader still lands on the region it was sent to.
		if (!host.hasAttribute("tabindex")) host.setAttribute("tabindex", "-1");
		return { focus: host, highlight: host };
	} catch {
		return null;
	}
}
// #endregion

// #region Jump
/** How long the pulse attribute stays on — the CSS animation runs a little inside it. */
const PULSE_MS = 1800;

/** How long a smooth scroll gets to start before the watchdog lands it instantly. */
const SCROLL_WATCHDOG_MS = 320;

const pulseTimers = new WeakMap<HTMLElement, number>();

/**
 * Ring `el` for {@link PULSE_MS}. Re-pulsing an element that is already ringed restarts it: the
 * attribute is dropped and a reflow forced so the animation is a new one rather than a no-op.
 *
 * The attribute is removed by a TIMER, never by `animationend`: a backgrounded or non-compositing tab
 * never delivers that event, and the ring would then stay on for good.
 */
function pulse(el: HTMLElement): void {
	const prior = pulseTimers.get(el);
	if (prior !== undefined) clearTimeout(prior);
	el.removeAttribute("data-psu-pulse");
	void el.offsetWidth;
	el.setAttribute("data-psu-pulse", "");
	pulseTimers.set(
		el,
		setTimeout(() => {
			el.removeAttribute("data-psu-pulse");
			pulseTimers.delete(el);
		}, PULSE_MS) as unknown as number,
	);
}

/**
 * Centre `el` in the viewport — smooth, with the repo's arrival watchdog.
 *
 * A smooth scroll is animation-driven and does not run at all where frames are not being composited,
 * so a timer checks whether anything moved and, if the target is still outside the readable band below
 * the pinned chrome, lands it instantly. Arrival is the function; smoothness is decoration (§B.5).
 */
function centre(el: HTMLElement): void {
	const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ||
		document.documentElement.dataset.motion === "reduced";
	const before = globalThis.scrollY;
	el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
	if (reduced) return;
	setTimeout(() => {
		if (globalThis.scrollY !== before) return;
		const r = el.getBoundingClientRect();
		if (r.top < chromeOffset() || r.bottom > globalThis.innerHeight) {
			el.scrollIntoView({ behavior: "auto", block: "center" });
		}
	}, SCROLL_WATCHDOG_MS);
}

/**
 * Take the owner to `step`: scroll it to the centre, ring it, and move focus onto it.
 *
 * Returns `false` when this page does not render the step's field, so the caller can navigate to the
 * surface that does. Focus is moved with `preventScroll` so it does not cut the smooth scroll short
 * with an instant jump of its own.
 */
export function jumpToStep(step: ProjectSetupStep, setup: ProjectSetup): boolean {
	const target = resolveStepTarget(step, setup);
	if (!target) return false;
	try {
		centre(target.highlight);
		pulse(target.highlight);
		target.focus.focus({ preventScroll: true });
		return true;
	} catch {
		return false;
	}
}

/** The Details URL that answers `step`, for when the current page cannot — anchored where possible. */
export function stepHref(base: string, step: ProjectSetupStep, setup: ProjectSetup): string {
	const section = sectionForStep(step, setup);
	return section ? `${base}#${anchorId(section)}` : base;
}
// #endregion
