import type { ComponentChildren, JSX } from "preact";
import { type Signal, signal } from "@preact/signals";
import { Accordion, AccordionTab, motionReduced } from "@projective/ui/display";
import { HintPopover } from "@projective/ui/feedback";
import { COLLAPSED_SECTIONS, type EditSection } from "@projective/types/catalogue";
import { SECTION_LABELS, sectionHeadingId } from "../../core/workspace-model.ts";
import { setWorkspaceUrl, workspaceUrl } from "../../core/workspace-store.ts";

const FOLDS = new Map<EditSection, Signal<number>>();

function foldOf(section: EditSection): Signal<number> {
	let fold = FOLDS.get(section);
	if (!fold) {
		fold = signal(-1);
		FOLDS.set(section, fold);
	}
	return fold;
}

function unfold(section: EditSection): void {
	if (COLLAPSED_SECTIONS.includes(section)) foldOf(section).value = 0;
}

/** Props for {@link EditSectionFrame}. */
export interface EditSectionFrameProps {
	section: EditSection;
	/** One sentence saying what the section decides, behind a "?" beside the heading. */
	intro?: string;
	children: ComponentChildren;
}

/** The DOM id of a section, which the scroll-spy observes and `#cat-sec-<section>` scrolls to. */
export function sectionDomId(section: EditSection): string {
	return `cat-sec-${section}`;
}

/**
 * Scroll a section to the top and move focus to its heading, so the reader lands on its name. A
 * folded section opens first.
 */
export function revealSection(section: EditSection): void {
	unfold(section);
	document.getElementById(sectionDomId(section))?.scrollIntoView({ block: "start" });
	document.getElementById(sectionHeadingId(section))?.focus({ preventScroll: true });
}

function glideToSection(section: EditSection): void {
	unfold(section);
	document.getElementById(sectionDomId(section))?.scrollIntoView({
		block: "start",
		behavior: motionReduced() ? "auto" : "smooth",
	});
	document.getElementById(sectionHeadingId(section))?.focus({ preventScroll: true });
}

/**
 * Take the seller to an Edit section from outside the canvas (the footer's locked Publish, the
 * header's progress ring): in place on the Edit tab, else by switching to it first.
 */
export function goToSection(section: EditSection): void {
	if (workspaceUrl.peek().tab === "edit") {
		setWorkspaceUrl({ section }, "replace");
		glideToSection(section);
		return;
	}
	setWorkspaceUrl({ tab: "edit", section }, "push");
	setTimeout(() => requestAnimationFrame(() => glideToSection(section)), 0);
}

/**
 * EditSectionFrame — one Edit section: a `<section>` named by its heading, in the section-header
 * register, separated from its neighbours by spacing alone (no box, §3.6). What the section decides
 * sits behind a "?" beside the heading and describes the section (Decision #305). The heading takes focus
 * (`tabindex="-1"`) when `?section=` or the section rail brings the section into view.
 *
 * A section in `COLLAPSED_SECTIONS` (SEO & reach, Decision #525) is a flush `Accordion` whose `h2`
 * header button is the heading. A "?" cannot sit inside that button, so its intro opens the panel
 * instead, in the meta register.
 */
export function EditSectionFrame(props: EditSectionFrameProps): JSX.Element {
	const headingId = sectionHeadingId(props.section);
	const introId = props.intro ? `${sectionDomId(props.section)}-intro` : undefined;
	if (COLLAPSED_SECTIONS.includes(props.section)) {
		return (
			<section
				class="cat-sec"
				id={sectionDomId(props.section)}
				data-section={props.section}
				aria-labelledby={headingId}
			>
				<Accordion
					class="cat-sec__fold"
					variant="flush"
					headingLevel={2}
					activeIndex={foldOf(props.section)}
				>
					<AccordionTab header={SECTION_LABELS[props.section]} headerId={headingId}>
						<div class="cat-sec__body">
							{props.intro && <p class="cat-sec__lede">{props.intro}</p>}
							{props.children}
						</div>
					</AccordionTab>
				</Accordion>
			</section>
		);
	}
	return (
		<section
			class="cat-sec"
			id={sectionDomId(props.section)}
			data-section={props.section}
			aria-labelledby={headingId}
			aria-describedby={introId}
		>
			<header class="cat-sec__head">
				<h2 class="cat-sec__title" id={headingId} tabIndex={-1}>
					{SECTION_LABELS[props.section]}
				</h2>
				{props.intro && (
					<HintPopover label={`About ${SECTION_LABELS[props.section].toLowerCase()}`}>
						{props.intro}
					</HintPopover>
				)}
				{props.intro && <span id={introId} class="ui-visually-hidden">{props.intro}</span>}
			</header>
			<div class="cat-sec__body">{props.children}</div>
		</section>
	);
}
