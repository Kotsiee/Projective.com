import { z } from "zod";
import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { WalletBackendService } from "@server/services/finance/WalletBackendService.ts";

/**
 * `?team=` reads a team's pool and `?as=self` the person's own, instead of the acting subject's — the
 * apply modal's applicant picker, which in a team context must still be able to read "Yourself".
 */
const AllowanceQuerySchema = z.object({
	team: z.string().uuid().optional(),
	as: z.enum(["self"]).optional(),
});

/**
 * `GET /api/user/allowance[?team=<uuid> | ?as=self]` — the acting subject's proposal allowance: the weekly quota,
 * the anti-burst buffer, when the next token drips back, and whether an application would be accepted
 * now (`ProposalAllowanceStatus`).
 *
 * Thin by contract: parse the optional team, delegate to the fat
 * {@link WalletBackendService.getProposalAllowanceStatus}, map the envelope. The subject is decided
 * server-side — a team is read only if the caller is an active member of it (403 otherwise), and
 * without `?team` the acting team context, else the person. `no-store`: reading also pays out the drip,
 * and a cached meter would show tokens the caller no longer has.
 */
export const handler = define.handlers({
	async GET(ctx) {
		const parsed = AllowanceQuerySchema.safeParse({
			team: ctx.url.searchParams.get("team") ?? undefined,
			as: ctx.url.searchParams.get("as") ?? undefined,
		});
		if (!parsed.success) {
			return Response.json(
				{ ok: false, message: "That team couldn't be read.", errors: { team: "invalid" } },
				{ status: 400 },
			);
		}
		const result = await WalletBackendService.getProposalAllowanceStatus(
			readActor(ctx),
			{ teamId: parsed.data.team ?? null, personal: parsed.data.as === "self" },
		);
		return Response.json(
			{ ok: result.ok, message: result.message, errors: result.errors, data: result.data },
			{ status: result.status, headers: { "Cache-Control": "no-store" } },
		);
	},
});
