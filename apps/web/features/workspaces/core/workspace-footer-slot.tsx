import type { ComponentChildren } from "preact";
import type { ReadActor } from "@server/services/read-actor.ts";
import WorkspaceFooterRig from "../islands/WorkspaceFooterRig.island.tsx";
import { resolveRoster, resolveWorkspaceConsole } from "./workspace-ssr.ts";
import { activeModuleOf, kindFromPath, workspaceHandleOf } from "./workspace-model.ts";
import { resolveSubView } from "./sub-views.ts";
import { isFirstRun } from "./roster-model.ts";

/**
 * workspace-footer-slot — the SSR-idiomatic resolver for the middle-nav FOOTER band across the
 * workspace surface (mirrors `catalogueFooterFor` / `walletFooterFor`).
 *
 * The band is resolved on BOTH the index (density + New) and inside a console (view switching +
 * Invite / Settings / Discard + Save), because in each case the controls belong to the chrome rather
 * than the body. `/teams/create` is the index — its create modal opens over the roster — so it gets the index rig.
 *
 * The capability flags are resolved HERE, server-side, and passed in: the rig decides an action's
 * PRESENCE from them, and a capability check that ran on the client would flash controls the viewer
 * cannot use. Returns `null` off the surface so no empty bar renders. Reads share the request memo.
 *
 * Server-only (reaches `@server/services` via `workspace-ssr`); never imported by an island.
 */
export async function workspaceFooterFor(url: URL, actor: ReadActor): Promise<ComponentChildren> {
	const kind = kindFromPath(url.pathname);
	if (!kind) return null;

	const handle = workspaceHandleOf(url.pathname);

	if (!handle) {
		const read = await resolveRoster(kind, actor, url);
		// A failed roster read still offers New: creation is re-validated server-side on submit, and
		// withholding the only forward action because a READ failed would strand the viewer. A failed
		// read is never first run, for the same reason; a successful one with nothing in it is, and the
		// canvas's empty state then carries the page's one create.
		const firstRun = read.ok && isFirstRun({
			loaded: true,
			entityCount: read.roster.items.length,
			invitationCount: read.roster.invitations.length,
		});
		return (
			<WorkspaceFooterRig
				kind={kind}
				canCreate={read.ok ? read.roster.canCreate : true}
				firstRun={firstRun}
			/>
		);
	}

	const requested = activeModuleOf(url.pathname) ?? "overview";
	const bootstrap = await resolveWorkspaceConsole(kind, handle, requested, actor, url);
	if (!bootstrap) return null;

	const capabilities = bootstrap.workspace.viewerCapabilities;
	const held = new Set(capabilities);
	return (
		<WorkspaceFooterRig
			kind={kind}
			workspaceHandle={bootstrap.workspace.handle}
			module={bootstrap.activeModule}
			view={resolveSubView(
				bootstrap.activeModule,
				kind,
				capabilities,
				url.searchParams.get("view"),
			)}
			capabilities={capabilities}
			canInvite={held.has("invite_members")}
			canManageMoney={held.has("manage_finances")}
			canManageSettings={held.has("manage_settings")}
		/>
	);
}
