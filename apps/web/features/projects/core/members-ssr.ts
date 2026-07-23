import { ProjectBackendService } from "@server/services/projects/ProjectBackendService.ts";
import type { MemberRosterPage } from "../types/projects-types.ts";

/**
 * members-ssr — the server-only bootstrap for the Members roster's first paint. Calls the fat
 * {@link ProjectBackendService.members} directly (no HTTP hop) so the roster ships its participants +
 * pending invitations + viewer capabilities in the initial byte; the island then re-simulates via the
 * thin {@link MembersService} when the DEV Context Switcher changes. Mirrors {@link resolveFilePage}.
 * Never imported by an island.
 */
export interface MemberRosterBootstrap {
	page: MemberRosterPage | null;
}

/** Resolve the initial roster page. `channelId` unset → project scope (all participants). */
export function resolveMemberRoster(
	projectId: string,
	channelId?: string | null,
): MemberRosterBootstrap {
	const res = ProjectBackendService.members({ projectId, channelId: channelId ?? null });
	return { page: res.ok && res.data ? res.data.page : null };
}
