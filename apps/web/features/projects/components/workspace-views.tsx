import type { JSX } from "preact";
import FileExplorer from "../islands/FileExplorer.island.tsx";
import MemberRoster from "../islands/MemberRoster.island.tsx";
import type {
	FileListPage,
	FileScope,
	MemberRosterPage,
	MemberScope,
} from "../types/projects-types.ts";

/**
 * Workspace views — the SINGLE source of truth for the **Files** and **Members** tab bodies, imported
 * verbatim by both route hierarchies:
 *
 *   - `/projects/[projectId]/[channelId]/{files,members}` and the project-scope variants
 *   - `/messages/[conversationId]/{files,members}`
 *
 * A route's only job is to resolve its page server-side and hand it here; everything the user sees and
 * touches — the zoom-driven grid⇄list explorer with its window virtualization and universal preview
 * modal, the roster table with its avatar stacks, role tags, and management actions — is the same
 * component tree in both places. Parity cannot drift, because there is only one implementation.
 *
 * The scope prop is what differs: it selects the endpoint the islands' thin services refine through
 * (`/api/projects/*` for an engagement, `/api/messaging/*` for a conversation). Both answer the
 * identical Zod projections (`FileListPage` / `MemberRosterPage`), so nothing else changes.
 */

// #region Files
export interface FilesViewProps {
	scope: FileScope;
	/** The project id — or, in `conversation` scope, the conversation id. */
	id: string;
	/** The channel id in channel scope (the conversation id in conversation scope). */
	channelId?: string;
	/** The SSR-resolved first page; `null` renders the island's own not-found/empty state. */
	initial: FileListPage | null;
}

/** FilesView — the Files tab body for every scope. */
export function FilesView({ scope, id, channelId, initial }: FilesViewProps): JSX.Element {
	return <FileExplorer scope={scope} projectId={id} channelId={channelId} initial={initial} />;
}
// #endregion

// #region Members
export interface MembersViewProps {
	scope: MemberScope;
	/** The project id — or, in `conversation` scope, the conversation id. */
	id: string;
	/** The channel id in channel scope (the conversation id in conversation scope). */
	channelId?: string;
	/** The SSR-resolved roster; `null` renders the island's own not-found/empty state. */
	initial: MemberRosterPage | null;
}

/** MembersView — the Members tab body for every scope. */
export function MembersView({ scope, id, channelId, initial }: MembersViewProps): JSX.Element {
	return <MemberRoster scope={scope} projectId={id} channelId={channelId} initial={initial} />;
}
// #endregion
