import type { JSX } from "preact";
import { SubPageLink } from "../edit/SubPageLink.tsx";

/** Props for {@link SubPageHead}. */
export interface SubPageHeadProps {
	title: string;
	/** One sentence saying what the page decides. */
	intro: string;
	/** The Edit section this page belongs to, which the way back returns to. */
	backHref: string;
	headingId: string;
}

/**
 * SubPageHead — the top of a listing's Edit sub-page (Decision #525): the way back to the section
 * it belongs to, the page's name in the section-header register, and what it decides in the meta
 * register. The listing's own title and tabs stay in the header band above.
 */
export function SubPageHead(props: SubPageHeadProps): JSX.Element {
	return (
		<header class="cat-sub__head">
			<div class="cat-sub__back">
				<SubPageLink href={props.backHref} label="Back to the listing" icon="arrow-left" />
			</div>
			<h2 class="cat-sec__title" id={props.headingId} tabIndex={-1}>{props.title}</h2>
			<p class="cat-sec__lede">{props.intro}</p>
		</header>
	);
}
