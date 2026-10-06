import { z } from "zod";
import type { ProjectStatus } from "./summary.ts";

/**
 * projects.access — how the acting viewer stands toward ONE engagement, and what the engagement's
 * root address does for them (Decision #144).
 *
 * `/projects/[slug]` is the engagement's **Overview**: the command center for the people working on
 * it. Who reaches it, and what everybody else gets instead, is decided by two facts and nothing else —
 * the viewer's {@link ProjectAccess} and the project's {@link ProjectStatus} — so the decision is a
 * pure function here rather than a branch repeated in each route, band resolver and middleware that
 * needs it. Every caller asks {@link landingFor}; none re-derives it.
 *
 * Access is a SERVER fact, derived beside `viewerIsClient` and never accepted from a client (root
 * CLAUDE.md §6). `viewerRole` cannot answer it: on the live path a stranger reading a public
 * engagement falls back to `member`, the same value a hire carries, so the role alone would hand a
 * prospect the workspace.
 */

// #region Access
/**
 * The viewer's standing toward one engagement.
 *
 * - `owner` — the client side: the creator, or a participant seated on the client side
 *   (`viewerIsClient`). Owns the configuration at `/projects/[slug]/details`.
 * - `participant` — anyone else the engagement admits (`projects.has_project_access`: a participant
 *   row, the owning business, a live freelancer or team stage assignment).
 * - `prospect` — somebody who can see the project but is not on it. Their place is the public
 *   listing, where the engagement is evaluated and applied to.
 *
 * There is deliberately no `invitee`. An invitation is not access until it is accepted, so an invitee
 * resolves exactly as a prospect does; a member nothing could ever produce would be dead code.
 */
export const ProjectAccess = z.enum(["owner", "participant", "prospect"]);
export type ProjectAccess = z.infer<typeof ProjectAccess>;

/** The two viewers the Overview is drawn for. A prospect never reaches it. */
export const WorkspaceViewer = z.enum(["owner", "participant"]);
export type WorkspaceViewer = z.infer<typeof WorkspaceViewer>;

/**
 * The access a viewer holds, from the two server facts that decide it.
 *
 * `viewerIsClient` outranks `hasAccess` because every owner also passes the access predicate — the
 * question is which SIDE of the engagement they are on, and the client side owns the configuration.
 */
export function accessOf(viewerIsClient: boolean, hasAccess: boolean): ProjectAccess {
	if (viewerIsClient) return "owner";
	return hasAccess ? "participant" : "prospect";
}
// #endregion

// #region Landing
/**
 * What `GET /projects/[slug]` does for a viewer.
 *
 * - `overview` — render the Overview, drawn for `viewer`.
 * - `details` — the owner's draft: nothing is staffed or running yet, so there is nothing to command
 *   and the configuration is the only meaningful page. Sent there, so the form has one address.
 * - `listing` — a prospect on a published engagement belongs on its public listing.
 * - `missing` — a prospect on a draft. A draft is not public, so its existence is not theirs to
 *   learn; they get the same "does not exist" a wrong address gets.
 *
 * The URL each kind maps to is the web layer's business; this module decides only WHAT happens.
 */
export type ProjectLanding =
	| { kind: "overview"; viewer: WorkspaceViewer }
	| { kind: "details" }
	| { kind: "listing" }
	| { kind: "missing" };

/** The dispatch matrix of Decision #144 as one total function. */
export function landingFor(access: ProjectAccess, status: ProjectStatus): ProjectLanding {
	if (access === "prospect") return status === "draft" ? { kind: "missing" } : { kind: "listing" };
	if (access === "owner" && status === "draft") return { kind: "details" };
	return { kind: "overview", viewer: access };
}

/**
 * Where a viewer is sent from any workspace path BELOW the root (`/board`, `/files`, a room, …), or
 * `null` when they may stay.
 *
 * Only a prospect is moved. An owner's draft keeps every view — the root alone forwards a draft owner
 * to the configuration, because the root is the page that would otherwise be empty.
 */
export function workspaceExitFor(
	access: ProjectAccess,
	status: ProjectStatus,
): "listing" | "missing" | null {
	if (access !== "prospect") return null;
	return status === "draft" ? "missing" : "listing";
}

/**
 * Whether the owner may open `/projects/[slug]/preview`.
 *
 * A draft must finish its required setup steps first — the listing it previews does not exist yet,
 * and a half-configured brief previews as a broken page. A PUBLISHED engagement always previews: the
 * public can already read its listing, so locking the owner out of it (because a stage added later has
 * no price yet) would be the strictest gate exactly where the risk is lowest.
 */
export function previewAllowed(status: ProjectStatus, previewReady: boolean): boolean {
	return status === "draft" ? previewReady : true;
}

/** Whether an engagement has stopped running — its Overview reads as a record, not a queue. */
export function isClosedStatus(status: ProjectStatus): boolean {
	return status === "completed" || status === "cancelled";
}
// #endregion
