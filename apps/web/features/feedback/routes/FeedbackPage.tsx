import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { FeedbackBackendService } from "@server/services/community/FeedbackBackendService.ts";
import { applyPageMeta, pageMeta } from "@features/marketing/core/seo.ts";
import { siteOrigin } from "@features/marketing/core/site-origin.ts";
import { JsonLd } from "@features/marketing/components/JsonLd.tsx";
import { readFeedbackLocation } from "../core/feedback-url.ts";
import { feedbackJsonLd, feedbackPageMeta } from "../core/feedback-seo.ts";
import { feedbackIdeaUnavailable } from "../core/feedback-view.ts";
import FeedbackPageIsland from "../islands/FeedbackPage.island.tsx";

/**
 * `/feedback` — the feedback board's own page (Decision #272), re-exported by
 * `routes/(public)/feedback.tsx`. Thin controller: parse the URL's location, read the board (and the
 * idea it names) AS the reader through `FeedbackBackendService`, set the head and hand both to the
 * island, which owns everything after that. A read that fails still renders the page — the island
 * shows the refusal and a retry — so every state ships the board's stylesheet.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const location = readFeedbackLocation(ctx.url.searchParams);
		const actor = readActor(ctx);
		const [board, detail] = await Promise.all([
			FeedbackBackendService.board(
				{
					status: location.status ?? undefined,
					sort: location.sort,
					limit: location.status === null ? 100 : 60,
				},
				actor,
			),
			location.view === "idea" && location.idea
				? FeedbackBackendService.idea(location.idea, actor)
				: Promise.resolve(null),
		]);
		const origin = siteOrigin(ctx.url);
		const idea = detail?.ok && detail.data ? detail.data : null;
		const detailError = detail && !idea
			? feedbackIdeaUnavailable(detail.status, detail.message)
			: null;
		applyPageMeta(
			ctx.state,
			pageMeta(feedbackPageMeta(origin, idea, { ideaMissing: detailError !== null })),
		);
		return page({
			board: board.ok && board.data ? board.data : null,
			detail: idea,
			detailError,
			location,
			href: ctx.url.pathname + ctx.url.search,
			signedIn: actor.userId.length > 0,
			origin,
		});
	},
});

export default define.page<typeof handler>(function FeedbackPage({ data }) {
	return (
		<>
			<JsonLd graph={feedbackJsonLd(data.origin, data.board)} />
			<FeedbackPageIsland
				initialBoard={data.board}
				initialDetail={data.detail}
				initialDetailError={data.detailError}
				initialLocation={data.location}
				initialHref={data.href}
				signedIn={data.signedIn}
			/>
		</>
	);
});
