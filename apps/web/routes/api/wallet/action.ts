import { define } from "@web/utils/state.ts";
import { asAuthenticatedContext } from "@projective/types/auth";
import { WalletActionRequestSchema } from "@projective/types/finance";
import { readActor } from "@web/utils/api-session.ts";
import { refuseIfRestricted } from "@web/utils/age-gate.ts";
import { invalidFields } from "@web/utils/service-response.ts";
import { toWalletResponse } from "@features/wallet/core/respond.ts";
import { walletQueryFrom } from "@features/wallet/core/wallet-model.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";

/**
 * `POST /api/wallet/action` — the single thin route for every money action, discriminated by the
 * `action` field. It Zod-validates the body against {@link WalletActionRequestSchema} (mapping issues to
 * field errors) and hands it to {@link WalletBackendService.perform}, which performs the action AS
 * the signed-in caller: the movements run through definer functions that authorise the caller
 * themselves, the settings through `finance.*` RLS. This route only parses, validates and forwards —
 * it holds no money logic and no capability guard of its own.
 */
const AGE_GATED_ACTIONS: ReadonlySet<string> = new Set(["top_up", "withdraw", "fund_escrow"]);

export const handler = define.handlers({
	async POST(ctx) {
		const body = await ctx.req.json().catch(() => null) as Record<string, unknown> | null;
		if (!body || typeof body.action !== "string") {
			return Response.json({ ok: false, message: "Missing action." }, { status: 400 });
		}
		const actor = readActor(ctx);
		if (!actor.userId) {
			return Response.json({ ok: false, message: "Sign in to use your wallet." }, { status: 401 });
		}

		const parsed = WalletActionRequestSchema.safeParse(body);
		if (!parsed.success) {
			const unknown = parsed.error.issues.some((issue) =>
				issue.code === "invalid_union" && issue.path[0] === "action"
			);
			if (unknown) return Response.json({ ok: false, message: "Unknown action." }, { status: 400 });
			return invalidFields(parsed.error.issues);
		}
		if (AGE_GATED_ACTIONS.has(parsed.data.action)) {
			const restricted = refuseIfRestricted(ctx.req, ctx.state.userContext);
			if (restricted) return restricted;
		}

		// The refreshed Overview each action answers with is drawn in the currency the caller is viewing.
		const base = walletQueryFrom(ctx.url.searchParams, asAuthenticatedContext(ctx.state.userContext));
		const query = { ...base, display: parsed.data.display ?? base.display };
		return toWalletResponse(await WalletBackendService.perform(parsed.data, query, actor));
	},
});
