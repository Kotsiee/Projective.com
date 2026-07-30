import type { ComponentChildren } from "preact";
import type { UserContext } from "@projective/types/auth";
import WorkspaceFooterRig from "../islands/WorkspaceFooterRig.island.tsx";
import { resolveRoster, resolveWorkspaceConsole } from "./workspace-ssr.ts";
import { simFromParams } from "./workspace-seam.ts";
import { activeModuleOf, kindFromPath, workspaceIdOf } from "./workspace-model.ts";

/**
 * workspace-footer-slot — the SSR-idiomatic resolver for the middle-nav FOOTER band across the
 * workspace surface (mirrors `catalogueFooterFor` / `walletFooterFor`).
 *
 * The band is resolved on BOTH the index (grid⇄table + New) and inside a console (view switching +
 * Invite / Save / Settings), because in each case the controls belong to the chrome rather than the
 * body — see the rig's own header for why that division is strict.
 *
 * The capability flags are resolved HERE, server-side, and passed in: the rig decides an action's
 * PRESENCE from them, and a capability check that ran on the client would flash controls the viewer
 * cannot use. Returns `null` off the surface so no empty bar renders.
 *
 * Server-only (reaches `@server/services` via `workspace-ssr`); never imported by an island.
 */
export function workspaceFooterFor(url: URL, context: UserContext): ComponentChildren {
	const kind = kindFromPath(url.pathname);
	if (!kind) return null;

	const id = workspaceIdOf(url.pathname);

	if (!id) {
		const roster = resolveRoster(kind, context, simFromParams(url.searchParams));
		return (
			<WorkspaceFooterRig
				kind={kind}
				canCreate={roster.canCreate}
			/>
		);
	}

	const requested = activeModuleOf(url.pathname) ?? "overview";
	const bootstrap = resolveWorkspaceConsole(
		kind,
		id,
		requested,
		context,
		simFromParams(url.searchParams),
	);
	if (!bootstrap) return null;

	const held = new Set(bootstrap.workspace.viewerCapabilities);
	return (
		<WorkspaceFooterRig
			kind={kind}
			workspaceId={bootstrap.workspace.id}
			module={bootstrap.activeModule}
			canInvite={held.has("invite_members")}
			canManageMoney={held.has("manage_finances")}
		/>
	);
}
