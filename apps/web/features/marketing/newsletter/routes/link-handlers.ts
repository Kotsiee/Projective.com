import { page } from "fresh";
import type { Context } from "fresh";
import { NewsletterBackendService } from "@server/services/newsletter/NewsletterBackendService.ts";
import { define, type State } from "@web/utils/state.ts";
import {
	NEWSLETTER_LINK_HEADERS,
	NEWSLETTER_THROTTLED_NOTICE,
	type NewsletterLinkMode,
} from "../core/newsletter-link.ts";
import type { NewsletterLinkPageData } from "../core/link-copy.ts";

/**
 * The handlers of `/newsletter/confirm` and `/newsletter/unsubscribe` (PRD-E11), kept apart from the
 * pages so they load under `deno test`. A GET only reads the link's standing through the fat
 * {@link NewsletterBackendService} and renders it: it never confirms, never unsubscribes, and never
 * shows the address, so a mail scanner that opens the link changes nothing (Decisions #445, #478).
 * An unknown token renders the calm not-found state with a real 404. Every answer is `noindex`,
 * `no-store` and `no-referrer`, because the token is in the URL.
 */

const TITLES: Readonly<Record<NewsletterLinkMode, string>> = {
	confirm: "Confirm your subscription · Projective",
	unsubscribe: "Unsubscribe · Projective",
};

/** Render `mode`'s page for the request's `?token=`. */
async function show(ctx: Context<State>, mode: NewsletterLinkMode) {
	const token = ctx.url.searchParams.get("token");
	const result = await NewsletterBackendService.linkView(token);
	ctx.state.title = TITLES[mode];
	ctx.state.description = "Manage your Projective newsletter subscription.";
	const data: NewsletterLinkPageData = {
		mode,
		token: result.ok ? token : null,
		view: result.ok ? result.data ?? null : null,
		failure: result.ok ? null : result.status === 404 ? "not_found" : "unavailable",
		throttled: mode === "confirm" &&
			ctx.url.searchParams.get("notice") === NEWSLETTER_THROTTLED_NOTICE,
	};
	const status = result.ok ? 200 : result.status === 404 ? 404 : 503;
	return page(data, { status, headers: NEWSLETTER_LINK_HEADERS });
}

/** `/newsletter/confirm?token=` — the Confirm button, or the address's standing. */
export const confirmPageHandler = define.handlers({
	GET(ctx) {
		return show(ctx, "confirm");
	},
});

/** `/newsletter/unsubscribe?token=` — the Unsubscribe button, or the address's standing. */
export const unsubscribePageHandler = define.handlers({
	GET(ctx) {
		return show(ctx, "unsubscribe");
	},
});
