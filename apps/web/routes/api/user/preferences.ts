import { define } from "@web/utils/state.ts";
import { readCookies, SB_ACCESS_COOKIE } from "@web/utils/auth-cookies.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { UserPreferencesUpdateSchema } from "@projective/types/org";
import { UserBackendService } from "@server/services/user/UserBackendService.ts";
import type { ServiceResult } from "@server/services/ServiceResult.ts";

/**
 * `GET` / `PATCH /api/user/preferences` — the acting user's display preferences (currency · locale ·
 * layout direction).
 *
 * Thin by contract: resolve the request's chrome context + access token, Zod-validate the patch, and
 * delegate to the fat {@link UserBackendService}. No preference logic, no column mapping, and no
 * capability decision lives here.
 *
 * **`PATCH`, not `POST`** — the body is a genuine partial (see `UserPreferencesUpdateSchema`), and a
 * caller changing only their currency must not have to resend a locale it never intended to touch.
 *
 * Deliberately NOT behind the `(dashboard)` guard: the currency switcher lives in the header, which
 * renders on authed public routes too. It self-authorises instead — the service rejects a genuine
 * guest with a 401, which the client's `apiFetch` interceptor routes through a silent refresh + retry.
 */

/** Map a {@link ServiceResult} to the flat JSON envelope every thin route in this app returns. */
function respond<T>(result: ServiceResult<T>): Response {
	return Response.json(
		{ ok: result.ok, message: result.message, errors: result.errors, ...(result.data ?? {}) },
		{ status: result.status },
	);
}

/** Resolve `{ context, accessToken }` for a request — the same pair `/api/user/me` resolves. */
function actor(req: Request, state: { userContext?: unknown; accessToken?: string }) {
	return {
		context: (state.userContext as ReturnType<typeof resolveRequestContext> | undefined) ??
			resolveRequestContext(req),
		accessToken: state.accessToken ?? readCookies(req)[SB_ACCESS_COOKIE],
	};
}

export const handler = define.handlers({
	async GET(ctx) {
		return respond(await UserBackendService.preferences(actor(ctx.req, ctx.state)));
	},

	async PATCH(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = UserPreferencesUpdateSchema.safeParse(raw);
		if (!parsed.success) {
			const first = parsed.error.issues[0];
			return Response.json(
				{
					ok: false,
					message: "Those preferences could not be applied.",
					errors: {
						[first?.path.join(".") || "preferences"]: first?.message ?? "Invalid value.",
					},
				},
				{ status: 422 },
			);
		}
		return respond(
			await UserBackendService.updatePreferences({
				...actor(ctx.req, ctx.state),
				patch: parsed.data,
			}),
		);
	},
});
