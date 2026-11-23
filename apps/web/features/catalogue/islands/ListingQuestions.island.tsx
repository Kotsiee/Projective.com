import type { JSX } from "preact";
import "../styles/workspace.css";
import "../styles/edit-sections.css";
import "../styles/subpage.css";
import type { ListingDetail, WorkspaceUrlState } from "../types/catalogue-types.ts";
import { ConflictDialog } from "../components/ConflictDialog.tsx";
import { QuestionsBuilder } from "../components/questions/QuestionsBuilder.tsx";
import { liveListing, revision } from "../core/workspace-store.ts";
import { WORKSPACE_PANEL_ID, workspaceTabId } from "../core/workspace-model.ts";
import { useWorkspacePersistence } from "../hooks/useWorkspacePersistence.ts";

/** Props for {@link ListingQuestions}. */
export interface ListingQuestionsProps {
	/** The listing as the server read it for this request. */
	initial: ListingDetail;
	/** The workspace URL state the server resolved (the Edit tab, the team). */
	url: WorkspaceUrlState;
}

/**
 * ListingQuestions — the canvas of `/catalogue/[id]/questions` (Decision #525): the buyer-questions
 * builder as part of the Edit tab, on the same draft, saves and conflict choice as the workspace.
 */
export default function ListingQuestions(props: ListingQuestionsProps): JSX.Element {
	useWorkspacePersistence(props.initial, props.url, { subPage: true });
	const listing = liveListing(props.initial);
	return (
		<div class="cat-ws">
			<div
				id={WORKSPACE_PANEL_ID}
				class="cat-ws__canvas"
				role="tabpanel"
				aria-labelledby={workspaceTabId("edit")}
				data-tab="edit"
			>
				<QuestionsBuilder key={revision.value} listing={listing} team={props.url.team} />
			</div>
			<ConflictDialog />
		</div>
	);
}
