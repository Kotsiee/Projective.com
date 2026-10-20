import type { ComponentChildren, JSX } from "preact";
import { HintPopover } from "@projective/ui/feedback";
import type { EditSection } from "../../types/catalogue-types.ts";
import { SECTION_LABELS, sectionHeadingId } from "../../core/workspace-model.ts";

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

/** Scroll a section to the top and move focus to its heading, so the reader lands on its name. */
export function revealSection(section: EditSection): void {
	document.getElementById(sectionDomId(section))?.scrollIntoView({ block: "start" });
	document.getElementById(sectionHeadingId(section))?.focus({ preventScroll: true });
}

/**
 * EditSectionFrame — one Edit section: a `<section>` named by its heading, in the section-header
 * register, separated from its neighbours by spacing alone (no box, §3.6). What the section decides
 * sits behind a "?" beside the heading and describes the section (Decision #305). The heading takes focus
 * (`tabindex="-1"`) when `?section=` or the lane outline brings the section into view.
 */
export function EditSectionFrame(props: EditSectionFrameProps): JSX.Element {
	const headingId = sectionHeadingId(props.section);
	const introId = props.intro ? `${sectionDomId(props.section)}-intro` : undefined;
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
