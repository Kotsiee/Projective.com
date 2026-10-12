import type { DiscoveryRail } from "../types/explore-types.ts";

/**
 * How a discovery rail is headed — derived from what FILLED it ({@link DiscoveryRail.kind}), never
 * from where it sits, so a heading can only claim what the data behind it supports: "Trending" past
 * the server's activity floor and "New" below it, "Because you viewed" only with a real anchor.
 */

// #region Headings
/** One rail's heading: the section id, the two-tone title, an optional why-line, and its ARIA label. */
export interface DiscoveryHeading {
	/** The section id — the heading anchor and the impression tracker's rail id. */
	id: string;
	lead: string;
	tail?: string;
	/** A Meta-register line saying why these cards, when the title alone does not. */
	subtitle?: string;
	/** The paging controls' accessible name. */
	label: string;
}

/** The heading for a rail the discovery service composed. */
export function discoveryHeading(rail: DiscoveryRail): DiscoveryHeading {
	switch (rail.kind) {
		case "because_viewed": {
			const title = rail.anchor?.title ?? "";
			return {
				id: "because-viewed",
				lead: "Because you viewed",
				tail: title,
				label: `Because you viewed ${title}`.trim(),
			};
		}
		case "for_you":
			return {
				id: "for-you",
				lead: "Picked",
				tail: "for you",
				subtitle: rail.basis === "activity"
					? "Matched to what you have been exploring"
					: "Matched to your skills and interests",
				label: "Picked for you",
			};
		case "saved":
			return { id: "saved", lead: "Saved", tail: "for later", label: "Saved for later" };
		case "trending":
			return {
				id: "trending",
				lead: "Trending",
				tail: "this week",
				subtitle: "What people are opening and saving this week",
				label: "Trending this week",
			};
		case "new":
			return { id: "new", lead: "New", tail: "on Projective", label: "New on Projective" };
	}
}
// #endregion
