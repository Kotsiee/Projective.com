import { define } from "@web/utils/state.ts";
import { UpdateSpendInputSchema } from "@projective/types/workspace";
import { toFieldErrors, toWorkspaceResponse } from "@features/workspaces/core/respond.ts";
import { resolveRequestContext } from "@web/utils/user-context.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/spend` — thin route: Zod-validate a BUSINESS's pooled-wallet governance (approval
 * threshold · approvers · contributors · per-member spend envelopes), then delegate to the fat
 * {@link WorkspaceBackendService.updateSpend}.
 *
 * Every amount is an integer in MINOR units, straight from the SSOT schema — no float ever reaches a money
 * field, and the route performs no arithmetic on one (root CLAUDE.md §12).
 *
 * Sending this for a team is refused `422`: a team governs how earnings are SPLIT, not how a pool is spent.
 * A threshold of `0` and a threshold of `null` are deliberately different (`0` = every spend needs an
 * approval; `null` = none does), which is why the schema keeps it nullable rather than coercing.
 *
 * **No server-side capability guard** — `manage_finances` authority is the fat service's decision, and the
 * Dev Context Switcher must reach the money module as a simulated vault role. Deferred `finance.*` RLS is
 * the real gate.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const raw = await ctx.req.json().catch(() => null);
		const parsed = UpdateSpendInputSchema.safeParse(raw);
		if (!parsed.success) {
			return Response.json(
				{
					ok: false,
					message: "Check the highlighted fields.",
					errors: toFieldErrors(parsed.error),
				},
				{ status: 422 },
			);
		}

		const viewer = ctx.state.userContext ?? resolveRequestContext(ctx.req);
		return toWorkspaceResponse(WorkspaceBackendService.updateSpend(parsed.data, viewer));
	},
});
