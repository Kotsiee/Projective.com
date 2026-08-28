import type { JSX } from "preact";

/**
 * RailHeading — the two-tone Home section heading: a bold-italic category over a regular muted
 * qualifier, optionally wrapping the whole thing in a link to that category's full results.
 *
 * Extracted because the Home has two kinds of section — the scrolling {@link HomeRail} and the static
 * {@link HomeGrid} — and only the RAIL needs an island. Duplicating the heading in the server
 * component would let the two drift on exactly the thing that has to stay identical: a reader scanning
 * down the page reads these as one repeated object, and one of them quietly using a different weight
 * or a different link target would be the first thing to break that.
 *
 * A server component, so the island that imports it pays only for the markup, not for a second
 * hydration root.
 */
export function RailHeading(
	{ id, lead, tail, href }: {
		/** Stable section id — the heading carries `ex-{id}-title` for its section's `aria-labelledby`. */
		id: string;
		/** The bold-italic half — the category. */
		lead: string;
		/** The regular muted half — what the reader gets from it. */
		tail: string;
		/** Where the heading links, i.e. "see all of this category". Omit for an unlinked heading. */
		href?: string;
	},
): JSX.Element {
	const text = (
		<>
			<span class="ex-rail__lead">{lead}</span> <span class="ex-rail__tail">{tail}</span>
		</>
	);
	return (
		<h2 class="ex-rail__title" id={`ex-${id}-title`}>
			{href ? <a class="ex-rail__titlelink" href={href}>{text}</a> : text}
		</h2>
	);
}
