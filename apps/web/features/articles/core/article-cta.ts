import type { DocSection } from "@projective/types/content";
import { inlineText, nodesText, wordCount } from "@projective/types/content/text";
import type { EditorialArticleTopic } from "@projective/types/editorial";

/**
 * article-cta.ts — the one call to action an article carries (P6): which one, by the article's
 * primary topic, and where it sits, after roughly 60% of the body has been read. Pure.
 *
 * A guest is invited to join; a signed-in reader, who already has an account, is sent to the place
 * in the product the article was about — a link to `/join` would only bounce them home.
 */

// #region The calls to action
/** One call to action: a line, a sentence, and the action's words and address. */
export interface ArticleCta {
	title: string;
	body: string;
	label: string;
	href: string;
}

/** Per topic: the copy, and the action for a guest and for a signed-in reader. */
const CTAS: Readonly<
	Record<
		EditorialArticleTopic,
		{ title: string; body: string; guest: [string, string]; member: [string, string] }
	>
> = {
	"async-collaboration": {
		title: "Give your next project one home",
		body:
			"Stages, rooms, boards and files in one place, so the work keeps moving without another meeting.",
		guest: ["Create a free account", "/join"],
		member: ["Create a project", "/projects?create=1"],
	},
	"agile-delivery": {
		title: "Run your next project in stages",
		body:
			"Break the work into stages, hold the money for each as it starts, and approve as you go.",
		guest: ["Create a free account", "/join"],
		member: ["Create a project", "/projects?create=1"],
	},
	"team-structure": {
		title: "Work as a team without forming a company",
		body: "Find teams that take on work under one name and split every payment automatically.",
		guest: ["Create a free account", "/join"],
		member: ["Browse teams", "/explore?category=teams"],
	},
	"value-pricing": {
		title: "Buy work at a price agreed up front",
		body: "Every service shows its stages, its revision rounds and its price before you commit.",
		guest: ["Create a free account", "/join"],
		member: ["Browse services", "/explore?category=services"],
	},
	"escrow-and-trust": {
		title: "Start work with the money already held",
		body: "Fund each stage as it starts and release the money only when you approve the work.",
		guest: ["Create a free account", "/join"],
		member: ["Create a project", "/projects?create=1"],
	},
};

/** The call to action for an article whose primary topic is `topic`. */
export function articleCtaFor(topic: EditorialArticleTopic, signedIn: boolean): ArticleCta {
	const cta = CTAS[topic];
	const [label, href] = signedIn ? cta.member : cta.guest;
	return { title: cta.title, body: cta.body, label, href };
}
// #endregion

// #region Placement
/** The share of the body read before the call to action appears. */
export const CTA_READ_SHARE = 0.6;

/** Words in one section: its heading, summary line and body. */
function sectionWords(section: DocSection): number {
	return wordCount(
		[section.heading, section.tldr ? inlineText(section.tldr) : "", nodesText(section.body)].join(
			"\n\n",
		),
	);
}

/**
 * The index of the section the call to action follows: the first section by the end of which at
 * least {@link CTA_READ_SHARE} of the body's words have been read. Never the last section of a
 * longer article, so the call to action stays inside the reading rather than beside the footer;
 * a one-section article gets it after that section.
 */
export function ctaSectionIndex(sections: readonly DocSection[], share = CTA_READ_SHARE): number {
	if (sections.length <= 1) return 0;
	const counts = sections.map(sectionWords);
	const total = counts.reduce((sum, words) => sum + words, 0);
	if (total === 0) return Math.max(0, sections.length - 2);
	let read = 0;
	for (let i = 0; i < counts.length; i++) {
		read += counts[i];
		if (read / total >= share) return Math.min(i, sections.length - 2);
	}
	return sections.length - 2;
}
// #endregion
