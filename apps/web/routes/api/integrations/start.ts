import { define } from "@web/utils/state.ts";
import { StartConnectionSchema } from "@projective/types/integrations";
import { asAuthenticatedContext } from "@projective/types/auth";
import { toFieldErrors, toFilesResponse } from "@features/files/core/respond.ts";
import { IntegrationsBackendService } from "@server/services/integrations/IntegrationsBackendService.ts";

/**
 * `POST /api/integrations/start` — begin an OAuth consent, answering with the provider authorize URL
 * and the opaque `state` binding the round trip.
 *
 * Zod-validates the payload ({@link StartConnectionSchema}) and delegates to the fat
 * {@link IntegrationsBackendService.startConnection}.
 *
 * **Authentication ≠ authorization.** The Google OAuth in `features/auth/` is SIGN-IN — GoTrue owns it
 * and retains no third-party API token. This is a separate, additional consent: a long-lived API grant
 * the platform stores to read a drive. A user who signed in with Google has granted it nothing.
 *
 * `state` is the CSRF binding for the whole round trip, minted by the service and bound to the session
 * user resolved here — the callback arrives as an unauthenticated redirect from the provider, so a
 * callback carrying a state we never issued must be refusable. `returnTo` is validated as a
 * same-origin PATH by the service and never echoed back raw: an attacker-chosen return URL turns a
 * consent screen into an open redirect that borrows this domain's credibility.
 *
 * No server-side capability guard (Decision #53(b)) — see `../files/list.ts`.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = StartConnectionSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "That connection could not be started.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}

		const context = asAuthenticatedContext(ctx.state.userContext);
		return toFilesResponse(
			await IntegrationsBackendService.startConnection(parsed.data, {
				userId: context.userId ?? "",
			}),
		);
	},
});
