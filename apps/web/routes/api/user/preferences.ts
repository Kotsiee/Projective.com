import { define } from "@web/utils/state.ts";
import { readCookies, SB_ACCESS_COOKIE } from "@web/utils/auth-cookies.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { UserPreferencesUpdateSchema } from "@projective/types/org";
import { UserBackendService } from "@server/services/user/UserBackendService.ts";
import { SettingsBackendService } from "@server/services/user/SettingsBackendService.ts";
import { readActor } from "@web/utils/api-session.ts";
import { a11ySetCookie, DEFAULT_A11Y } from "@web/utils/a11y-context.ts";
import type { ServiceResult } from "@server/services/ServiceResult.ts";

/**
 * `GET` / `PATCH /api/user/preferences` — the acting user's display preferences (currency · locale ·
 * layout direction) and appearance (theme · contrast · font · colour vision · motion).
 *
 * Thin by contract: resolve the request's chrome context + access token, Zod-validate the patch, and
 * delegate — the read to {@link UserBackendService} + `SettingsBackendService.appearance`, the save to
 * `SettingsBackendService.updatePreferences`, which splits the patch between the two halves. No
 * preference logic, no column mapping, and no capability decision lives here. The one HTTP concern it
 * adds is the `pj.a11y` cookie: a save that touched the appearance answers with `Set-Cookie`, so the
 * next request is server-rendered in the new overlays (Decision #150).
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
		const display = await UserBackendService.preferences(actor(ctx.req, ctx.state));
		if (!display.ok || !display.data) return respond(display);
		const look = await SettingsBackendService.appearance({ actor: readActor(ctx), device: ctx.state.a11y });
		return respond({
			...display,
			data: { ...display.data, appearance: look.data?.appearance ?? null, appearanceLive: look.data?.live ?? false },
		});
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
		const result = await SettingsBackendService.updatePreferences({
			context: actor(ctx.req, ctx.state).context,
			actor: readActor(ctx),
			patch: parsed.data,
			device: ctx.state.a11y,
		});
		const response = respond(result);
		// The per-device mirror the server paints the next first byte from — set whether or not the
		// account write landed, because the overlays (and the direction) are already in force on this
		// device either way. Fields the save did not touch keep the device's current values.
		const appearance = result.ok ? result.data?.appearance ?? null : null;
		const dir = result.ok ? parsed.data.layoutDirection : undefined;
		if (appearance || dir) {
			const device = ctx.state.a11y ?? DEFAULT_A11Y;
			response.headers.append(
				"set-cookie",
				a11ySetCookie({
					contrast: appearance?.contrast ?? device.contrast,
					font: appearance?.font ?? device.font,
					cvd: appearance?.cvd ?? device.cvd,
					motion: appearance?.motion ?? device.motion,
					dir: dir ?? device.dir,
				}),
			);
		}
		return response;
	},
});
