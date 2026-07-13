import type { ComponentChildren, JSX } from "preact";

/**
 * SectionHeading — the shared multi-weight section header (Patreon × Apple typographic rhythm). A
 * thin, spacious eyebrow over a large mixed-weight title where a single emphasis word steps up in
 * weight. Optional trailing slot carries a section-level action (e.g. "View all"). Zero client JS.
 */
export interface SectionHeadingProps {
	eyebrow: string;
	/** Lead (thin) portion of the title. */
	title: string;
	/** Single stepped-up emphasis word/phrase, rendered inline after {@link title}. */
	emphasis?: string;
	/** Supporting sub-copy under the title. */
	lede?: string;
	/** Trailing action (link/button). */
	action?: ComponentChildren;
	id?: string;
}

export function SectionHeading(
	{ eyebrow, title, emphasis, lede, action, id }: SectionHeadingProps,
): JSX.Element {
	return (
		<header class="lp-section__head">
			<div class="lp-section__headmain">
				<span class="lp-eyebrow">{eyebrow}</span>
				<h2 class="lp-section__title" id={id}>
					<span class="lp-section__title-thin">{title}</span>
					{emphasis ? <span class="lp-section__title-strong">{emphasis}</span> : null}
				</h2>
				{lede ? <p class="lp-section__lede">{lede}</p> : null}
			</div>
			{action ? <div class="lp-section__action">{action}</div> : null}
		</header>
	);
}
