import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { Icon } from "@projective/ui/icons";
import { chromeOffset, scrollToElement } from "@features/view/core/scroll-to.ts";
import {
	activeSection,
	anchorId,
	resetActiveSection,
	setupSections,
} from "../core/setup-sections.ts";
import "../styles/setup-nav.css";
import type { SetupSectionKey } from "../core/setup-sections.ts";
import type { ProjectSetup } from "../types/projects-types.ts";

/**
 * SetupSectionNav — the sticky side rail on the owner's `/projects/[projectId]` workspace: one row
 * per section of the configuration flow, with the section currently in view marked active.
 *
 * The flow is ONE continuous scroll, not a stepper, so this rail is an accelerator rather than a
 * gate — every section is reachable by scrolling whether the rail works or not. It is therefore built
 * to degrade cleanly at each layer: real anchors before hydration, an offset-aware jump after it, and
 * an active mark that is correct the instant the island mounts rather than only once the reader
 * happens to scroll.
 *
 * Rows come from {@link setupSections}, the same registry the form renders from, so the rail cannot
 * offer a jump to a section this engagement does not have.
 */
export interface SetupSectionNavProps {
	/** The engagement being configured — read only for its shape, never mutated here. */
	setup: ProjectSetup;
}

// #region Scroll probe
/**
 * How far past the chrome line a section may sit and still count as the one being read.
 *
 * A jump lands a section exactly on the line, and subpixel layout can leave it a fraction below —
 * without the slack the row the reader just clicked would fail its own test and the rail would mark
 * the section ABOVE the one now filling the screen.
 */
const CROSSING_SLACK = 4;

/** Within this many pixels of the document's end, treat the page as bottomed out. */
const BOTTOM_SLACK = 2;

/**
 * Which section is currently being read, or `null` when none of them is in the document.
 *
 * The rule is "the last section whose top has crossed the chrome line", with one correction: at the
 * bottom of the document the final section may be too short to ever cross it, and without the
 * correction the last row could never light up at all.
 *
 * Pure over the DOM it is handed, so the ordering rule is the only thing it decides.
 */
function sectionInView(keys: SetupSectionKey[]): SetupSectionKey | null {
	const present = keys.filter((key) => document.getElementById(anchorId(key)) !== null);
	if (present.length === 0) return null;

	const doc = document.documentElement;
	const bottomed = globalThis.innerHeight + globalThis.scrollY >=
		doc.scrollHeight - BOTTOM_SLACK;
	if (bottomed) return present[present.length - 1] ?? null;

	const line = chromeOffset() + CROSSING_SLACK;
	// Default to the first present section: at the top of the page that is the one on screen, which
	// is a fact rather than a guess.
	let current = present[0] ?? null;
	for (const key of present) {
		const el = document.getElementById(anchorId(key));
		if (el && el.getBoundingClientRect().top <= line) current = key;
	}
	return current;
}
// #endregion

// #region Navigation
/**
 * Jump to a section below the pinned chrome and record it in the URL.
 *
 * Returns whether it handled the click. It resolves the target FIRST and refuses the job when there
 * is no element, so the native anchor is left to do whatever it can rather than being cancelled in
 * favour of a handler that reaches nothing (root CLAUDE.md §3 gate 11).
 *
 * `replaceState` rather than assigning `location.hash`: assigning it fires the browser's own jump,
 * which aligns the section to the scrollport top — behind the header band this rail is pinned under —
 * and pushes a history entry, so Back would then step through sections instead of leaving the page.
 * The URL still ends up shareable, which is the part that matters.
 */
function jumpToSection(key: SetupSectionKey): boolean {
	try {
		const id = anchorId(key);
		const target = document.getElementById(id);
		if (!target) return false;

		scrollToElement(target);
		// Set directly as well as scrolled: in an environment that never delivers a scroll event the
		// probe would otherwise never re-run, and the row the reader just pressed would stay inert.
		activeSection.value = key;
		globalThis.history?.replaceState(null, "", `#${id}`);
		return true;
	} catch {
		return false;
	}
}
// #endregion

// #region Component
/**
 * The rail. Renders every section of `setup` as a real anchor and tracks the one in view.
 */
export default function SetupSectionNav({ setup }: SetupSectionNavProps): JSX.Element {
	const sections = setupSections(setup);
	const active = activeSection.value;
	// A stable dependency: `setupSections` returns a fresh array every render, so the array itself
	// would re-subscribe the probe on every keystroke in the form beside it.
	const sectionKeys = sections.map((s) => s.key).join("|");

	useEffect(() => {
		const keys = sectionKeys.split("|") as SetupSectionKey[];

		const probe = () => {
			const next = sectionInView(keys);
			if (next !== activeSection.value) activeSection.value = next;
		};

		// A window scroll listener, never an IntersectionObserver, and run ONCE synchronously before
		// subscribing. Correctness must not depend on an event ever arriving: this repo's preview pane
		// delivers neither IO callbacks nor scroll events while `scrollY` moves normally, and the same
		// silence is the real behaviour of a deep link into `#psu-rules`, a restored scroll position
		// and a throttled background tab. The listeners are the refinement; the first call is the
		// answer.
		probe();
		globalThis.addEventListener("scroll", probe, { passive: true });
		globalThis.addEventListener("resize", probe);
		return () => {
			globalThis.removeEventListener("scroll", probe);
			globalThis.removeEventListener("resize", probe);
			resetActiveSection();
		};
	}, [sectionKeys]);

	return (
		<nav class="psu-nav" aria-label="Project setup sections">
			<p class="psu-nav__title">Sections</p>
			<ul class="psu-nav__list" role="list">
				{sections.map((section) => {
					const isActive = active === section.key;
					return (
						<li class="psu-nav__item" key={section.key}>
							<a
								class="psu-nav__link"
								href={`#${anchorId(section.key)}`}
								data-active={isActive ? "true" : undefined}
								aria-current={isActive ? "location" : undefined}
								onClick={(event) => {
									// A modified click is a request to open the anchor elsewhere; that is the
									// browser's job and cancelling it would break a legitimate action.
									if (
										event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
										event.button !== 0
									) {
										return;
									}
									if (jumpToSection(section.key)) event.preventDefault();
								}}
							>
								<span class="psu-nav__mark" aria-hidden="true" />
								<Icon class="psu-nav__icon" name={section.icon} size="sm" />
								<span class="psu-nav__label">{section.label}</span>
							</a>
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
// #endregion
