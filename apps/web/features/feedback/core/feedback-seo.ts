import {
	FEEDBACK_PUBLIC_STATES,
	FEEDBACK_STATE_LABEL,
	type FeedbackBoard,
	type FeedbackIdeaDetail,
} from "@projective/types/community";
import {
	absoluteUrl,
	breadcrumbListJsonLd,
	collectionPageJsonLd,
	type JsonLdGraph,
	jsonLdGraph,
	type JsonLdNode,
	organizationJsonLd,
	type PageMetaInput,
	webSiteJsonLd,
} from "@features/marketing/core/seo.ts";
import { FEEDBACK_PATH } from "./feedback-url.ts";

/**
 * feedback-seo — `/feedback`'s head and structured data (Decision #272), pure so the page controller
 * stays a parse-and-delegate route.
 *
 * The board is one indexable page; an idea is a section of it (`/feedback?idea=…`), so every view
 * names `/feedback` as its canonical and the JSON-LD lists the public ideas — never one under review
 * — as the page's `ItemList`, each at its own `?idea=` address. The drawer adds nothing to any head.
 */

/** The board's title and description. */
export const FEEDBACK_TITLE = "Feedback & roadmap";
export const FEEDBACK_DESCRIPTION =
	"Suggest what Projective should build next, vote for the ideas you want most, and follow them from Planned to Shipped.";

/** The absolute address of one idea's section of the board. */
export function feedbackIdeaUrl(origin: string, slug: string): string {
	return `${absoluteUrl(origin, FEEDBACK_PATH)}?idea=${encodeURIComponent(slug)}`;
}

/** What else the head needs to know about the request. */
export interface FeedbackPageMetaOptions {
	/** The URL named an idea the reader may not open: the answer is a notice, never indexed. */
	ideaMissing?: boolean;
}

/** `pageMeta` input for the board, or for one idea's section of it. */
export function feedbackPageMeta(
	origin: string,
	detail: FeedbackIdeaDetail | null,
	options: FeedbackPageMetaOptions = {},
): PageMetaInput {
	if (!detail) {
		return {
			title: FEEDBACK_TITLE,
			description: FEEDBACK_DESCRIPTION,
			path: FEEDBACK_PATH,
			origin,
			...(options.ideaMissing ? { noindex: true } : {}),
		};
	}
	const { idea } = detail;
	return {
		title: `${idea.title} · ${FEEDBACK_TITLE}`,
		description: `${FEEDBACK_STATE_LABEL[idea.status]} — ${idea.impact}`.slice(0, 300),
		path: FEEDBACK_PATH,
		origin,
		// An idea under review is its author's alone: never let a crawler that follows them in index it.
		noindex: !FEEDBACK_PUBLIC_STATES.includes(idea.status),
	};
}

/**
 * The board's graph: the organisation and site, a `CollectionPage` whose `mainEntity` is an
 * `ItemList` of the public ideas shown (in board order), and the breadcrumb Home › Feedback & roadmap.
 */
export function feedbackJsonLd(origin: string, board: FeedbackBoard | null): JsonLdGraph {
	const page = collectionPageJsonLd({
		origin,
		path: FEEDBACK_PATH,
		name: FEEDBACK_TITLE,
		description: FEEDBACK_DESCRIPTION,
		breadcrumb: true,
	});
	const ideas = (board?.ideas ?? []).filter((idea) => FEEDBACK_PUBLIC_STATES.includes(idea.status));
	const withList: JsonLdNode = ideas.length === 0 ? page : {
		...page,
		mainEntity: {
			"@type": "ItemList",
			numberOfItems: ideas.length,
			itemListElement: ideas.map((idea, i) => ({
				"@type": "ListItem",
				position: i + 1,
				name: idea.title,
				url: feedbackIdeaUrl(origin, idea.slug),
			})),
		},
	};
	return jsonLdGraph(
		organizationJsonLd(origin),
		webSiteJsonLd(origin),
		withList,
		breadcrumbListJsonLd(origin, [
			{ name: "Home", path: "/" },
			{ name: FEEDBACK_TITLE, path: FEEDBACK_PATH },
		]),
	);
}
