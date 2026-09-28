import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { ArchiveRoleInputSchema } from "@projective/types/workspace";
import {
	guestRefusal,
	invalidPayload,
	toWorkspaceResponse,
} from "@features/workspaces/core/respond.ts";
import { canReadLive } from "@server/services/read-actor.ts";
import { WorkspaceBackendService } from "@server/services/workspace/WorkspaceBackendService.ts";

/**
 * `POST /api/workspace/role-archive` — thin route: refuse a guest, Zod-validate `{ kind, workspaceId,
 * roleId }`, then delegate to the fat {@link WorkspaceBackendService.archiveRole}.
 *
 * A role is ARCHIVED, never deleted (root CLAUDE.md §5). Archiving one that anybody still holds, or that
 * a pending invitation still offers, is refused rather than reassigning them — nobody is silently
 * demoted, and the matrix says what is in the way. A preset cannot be archived at all.
 */
export const handler = define.handlers({
	async POST(ctx) {
		const actor = readActor(ctx);
		if (!canReadLive(actor)) return guestRefusal();
		const parsed = ArchiveRoleInputSchema.safeParse(await ctx.req.json().catch(() => null));
		if (!parsed.success) return invalidPayload(parsed.error, "Invalid role reference.");
		return toWorkspaceResponse(await WorkspaceBackendService.archiveRole(parsed.data, actor));
	},
});
