import { page } from "fresh";
import { define } from "@web/utils/state.ts";
import { ConfirmLinkSchema } from "../core/schema.ts";
import {
	CONFIRM_FAILED_PATH,
	CONFIRM_LINK_HEADERS,
	CONFIRM_THROTTLED_NOTICE,
	confirmRedirect,
} from "../core/confirm-link.ts";

/** What `/verify/confirm` hands its form: the link's token, carried through unspent. */
export interface ConfirmPageData {
	tokenHash: string;
	type: "email";
	throttled: boolean;
}

/**
 * `/verify/confirm`'s handler (Decision #445), kept apart from the page so it loads under `deno test`.
 * A GET only shape-checks the link and renders the Confirm button; it never spends the token, never
 * reads an account, and so says nothing about whose link it is (Decision #185). A malformed link
 * goes straight to `/login`'s failure notice. Every answer is `noindex`, `no-store` and
 * `no-referrer`, because the token is in the URL.
 */
export const handler = define.handlers({
	GET(ctx) {
		const parsed = ConfirmLinkSchema.safeParse({
			token_hash: ctx.url.searchParams.get("token_hash"),
			type: ctx.url.searchParams.get("type"),
		});
		if (!parsed.success) return confirmRedirect(CONFIRM_FAILED_PATH);

		ctx.state.title = "Confirm your email · Projective";
		ctx.state.description = "Confirm your email to finish setting up Projective.";
		const data: ConfirmPageData = {
			tokenHash: parsed.data.token_hash,
			type: parsed.data.type,
			throttled: ctx.url.searchParams.get("notice") === CONFIRM_THROTTLED_NOTICE,
		};
		return page(data, { headers: CONFIRM_LINK_HEADERS });
	},
});
