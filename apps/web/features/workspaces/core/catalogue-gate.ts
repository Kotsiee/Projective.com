import type { WorkspaceCapability, WorkspaceDetail } from "@projective/types/workspace";

/**
 * catalogue-gate — who may open a team's Catalogue (Decisions #308, #312), apart from the module
 * registry so a route that serves the catalogue can ask without loading the registry's glyphs (and
 * their stylesheet). The registry's `catalogue` entry reads its gate from here, so the two can never
 * disagree.
 */

/** The capability that opens a team's Catalogue: the owner, admin and lead presets hold it. */
export const CATALOGUE_CAPABILITY: WorkspaceCapability = "publish_listings";

/**
 * Whether this viewer may open — and so read and write as — this entity's catalogue: it is a team
 * (a business keeps no catalogue) and the viewer's server-resolved capabilities hold the gate.
 */
export function mayManageTeamCatalogue(
	workspace: Pick<WorkspaceDetail, "kind" | "viewerCapabilities">,
): boolean {
	return workspace.kind === "team" && workspace.viewerCapabilities.includes(CATALOGUE_CAPABILITY);
}
