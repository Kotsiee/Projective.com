import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { defineReadRoute } from "@web/utils/read-endpoint.ts";
import { toMessagingBody } from "@features/messaging/core/respond.ts";
import { MessagingBackendService } from "@server/services/messaging/MessagingBackendService.ts";
import {
	type ContactSuggestionParams,
	ContactSuggestionParamsSchema,
	type RankedContactList,
} from "@projective/types/messaging";

/**
 * `GET | HEAD | OPTIONS /api/messaging/suggestions?q=…&exclude=…&exclude=…&limit=…` — thin route: the
 * RANKED people picker behind New message · New group · Add members · Share with…
 *
 * No `q` → the viewer's relationship-ranked suggestions (shared workspace → mutual follow → follow →
 * collaboration → conversation, each by recency). A `q` → the same candidates narrowed by name or
 * `@handle`, followed by directory hits. `exclude` (repeated) leaves out people already in the
 * conversation being extended. Delegated to the fat {@link MessagingBackendService.suggestions};
 * the ranking rule itself lives in the Zod SSOT and is never restated here.
 *
 * The three read verbs come from {@link defineReadRoute}, so `HEAD` cannot drift from `GET` and the
 * `ETag`/`If-None-Match` revalidation is identical on both.
 */
function parseParams(url: URL): ContactSuggestionParams {
	const p = url.searchParams;
	const limitRaw = p.get("limit");
	const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
	const exclude = p.getAll("exclude").filter((v) => v.length > 0);
	const parsed = ContactSuggestionParamsSchema.safeParse({
		q: p.get("q") ?? undefined,
		exclude: exclude.length > 0 ? exclude : undefined,
		limit: Number.isFinite(limit) ? limit : undefined,
	});
	// A malformed query is answered with the unfiltered suggestions rather than a 400: the picker
	// is a helper on a modal, and a refused read there renders as "nobody to pick".
	return parsed.success ? parsed.data : {};
}

export const handler = define.handlers(
	defineReadRoute<{ contacts: RankedContactList }>({
		resolve: (ctx) => MessagingBackendService.suggestions(parseParams(ctx.url), readActor(ctx)),
		toBody: toMessagingBody,
	}),
);
