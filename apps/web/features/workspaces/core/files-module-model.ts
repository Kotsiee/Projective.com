import { kindCopy, type WorkspaceKind, type WorkspaceStatus } from "@projective/types/workspace";
import { filesHref } from "@features/files/core/asset-model.ts";

/**
 * files-module-model — the pure decisions behind a console's Files module: where the drive lives,
 * whether this viewer is offered Upload, and the sentences each state reads.
 *
 * Every active member may read and add to the entity's drive (`files.fn_can_read` and
 * `files.fn_owns_library` both ask for an active seat, nothing more), and only a file's uploader may
 * rename, move or delete it. An archived entity's drive stays readable and takes nothing new.
 */

// #region Model
/** What the Files module shows one viewer. */
export interface EntityDriveView {
	/** The console route the drive's folder addresses hang off; the path rides in `?path=`. */
	base: string;
	/** Whether the Upload action renders. */
	canUpload: boolean;
	/** The module's lead sentence. */
	note: string;
	/** The empty drive's sentence. */
	emptyNote: string;
	/** Why nothing can be added, when nothing can. */
	readOnlyNote: string | null;
}

/** The facts the view is derived from — the console detail's own. */
export interface EntityDriveFacts {
	kind: WorkspaceKind;
	handle: string;
	name: string;
	status: WorkspaceStatus;
}

/** The Files module's view for one viewer of one entity. */
export function entityDriveView(facts: EntityDriveFacts): EntityDriveView {
	const noun = kindCopy(facts.kind).noun;
	const archived = facts.status === "archived";
	return {
		base: filesHref("workspace", { subjectId: facts.handle, kind: facts.kind }),
		canUpload: !archived,
		note: `The shared drive ${facts.name} owns — briefs, assets and deliverables every member can open.`,
		emptyNote: archived
			? `${facts.name}'s drive is empty.`
			: `Files any member of the ${noun} uploads appear here for everyone in it.`,
		readOnlyNote: archived
			? `${facts.name} is archived. Its files stay readable; restore the ${noun} to add more.`
			: null,
	};
}
// #endregion
