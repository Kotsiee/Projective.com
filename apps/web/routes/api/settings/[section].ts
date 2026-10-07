import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { isSettingsSectionKey } from "@projective/types/settings";
import { resolveSettingsSection } from "@features/settings/core/settings-ssr.ts";

/**
 * `GET /api/settings/:section` — one Settings section's payload, for the contextual modal (Decision
 * #150). The console page server-renders the SAME read (`resolveSettingsSection`), so the modal and
 * the page can never disagree about a section's data.
 *
 * Thin: validate the key, require a signed-in caller, delegate. An unknown key is a 404 (the modal
 * only ever asks for registry keys, so anything else is not a request this app made). The answer is
 * `{ ok, data, error }` — `error` is a reason PART of the section could not be read, never a failure
 * of the request; a section renders what it has.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const key = ctx.params.section;
		if (!isSettingsSectionKey(key)) {
			return Response.json({ ok: false, message: "There's no such settings section." }, {
				status: 404,
			});
		}
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to see your settings." }, {
				status: 401,
			});
		}
		const envelope = await resolveSettingsSection(key, {
			context: asAuthenticatedContext(ctx.state.userContext),
			actor,
			a11y: ctx.state.a11y,
		});
		return Response.json({ ok: true, ...envelope }, { headers: { "cache-control": "no-store" } });
	},
});
