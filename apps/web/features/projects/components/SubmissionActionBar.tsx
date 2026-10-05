import type { JSX } from "preact";
import type { SubmissionStatus } from "../types/projects-types.ts";
import type { WorkflowActions } from "../core/submission-access.ts";
import { statusTone } from "../core/submission-model.ts";
import {
	AcceptedGlyph,
	PlusGlyph,
	ReviewGlyph,
	SendGlyph,
	SubmissionStatusIcon,
	TrashGlyph,
	UploadGlyph,
} from "./submission-glyphs.tsx";

/**
 * SubmissionActionBar — the primary/secondary workflow controls pinned to the right of the breadcrumbs
 * bar (`subm-crumbbar`), driven by the resolved {@link WorkflowActions} state machine (root task §3):
 *
 * - **Reviewer** viewing a submitted item → **Review Submission**; once the unit is accepted, also
 *   **Approve Stage** (releases the stage's held escrow, behind a confirmation).
 * - **Freelancer** at the root → **Create New Submission**.
 * - **Freelancer** inside an unsubmitted draft → **Upload Files** · **Delete Submission** ·
 *   **Submit for Review**.
 * - **Freelancer** inside a submitted unit → a read-only **status badge** (In Review / Approved /
 *   Revision Requested).
 *
 * Pure/presentational — the owning `SubmissionExplorer` island resolves the state + owns the modals this
 * fires; exactly one group renders at a time.
 */
export interface SubmissionActionBarProps {
	actions: WorkflowActions;
	onReview: () => void;
	onCreate: () => void;
	onUpload: () => void;
	onDelete: () => void;
	onSubmit: () => void;
	/** Open the stage-approval confirmation (reviewer, accepted unit). */
	onApproveStage: () => void;
	/** A stage approval is in flight — the control is disabled and says so. */
	approveBusy?: boolean;
}

/** The freelancer's post-submission badge label (root task §3.3 wording). */
function badgeLabel(status: SubmissionStatus): string {
	switch (status) {
		case "pending_review":
			return "In Review";
		case "accepted":
			return "Approved";
		case "revision_requested":
			return "Revision Requested";
		default:
			return "Draft";
	}
}

/** The freelancer's read-only status badge for a submitted unit. */
function StatusBadge({ status }: { status: SubmissionStatus }): JSX.Element {
	return (
		<span class="subm-actions__badge" data-tone={statusTone(status)} role="status">
			<span class="subm-actions__badgeicon" aria-hidden="true">
				<SubmissionStatusIcon status={status} size={15} />
			</span>
			{badgeLabel(status)}
		</span>
	);
}

export function SubmissionActionBar(props: SubmissionActionBarProps): JSX.Element | null {
	const { actions, onReview, onCreate, onUpload, onDelete, onSubmit, onApproveStage } = props;
	const approveBusy = props.approveBusy === true;

	if (actions.review || actions.approveStage) {
		return (
			<div class="subm-actions">
				{actions.review
					? (
						<button
							type="button"
							class={`subm-actions__btn ${
								actions.approveStage ? "subm-actions__btn--soft" : "subm-actions__btn--primary"
							}`}
							onClick={onReview}
						>
							<span class="subm-actions__icon" aria-hidden="true">
								<ReviewGlyph size={16} />
							</span>
							Review Submission
						</button>
					)
					: null}
				{actions.approveStage
					? (
						<button
							type="button"
							class="subm-actions__btn subm-actions__btn--primary"
							disabled={approveBusy}
							aria-busy={approveBusy}
							onClick={onApproveStage}
						>
							<span class="subm-actions__icon" aria-hidden="true">
								<AcceptedGlyph size={16} />
							</span>
							{approveBusy ? "Approving…" : "Approve Stage"}
						</button>
					)
					: null}
			</div>
		);
	}

	if (actions.create) {
		return (
			<div class="subm-actions">
				<button
					type="button"
					class="subm-actions__btn subm-actions__btn--primary"
					onClick={onCreate}
				>
					<span class="subm-actions__icon" aria-hidden="true">
						<PlusGlyph size={16} />
					</span>
					Create New Submission
				</button>
			</div>
		);
	}

	if (actions.draftEdit) {
		return (
			<div class="subm-actions">
				<button type="button" class="subm-actions__btn subm-actions__btn--soft" onClick={onUpload}>
					<span class="subm-actions__icon" aria-hidden="true">
						<UploadGlyph size={16} />
					</span>
					Upload Files
				</button>
				<button
					type="button"
					class="subm-actions__btn subm-actions__btn--danger"
					onClick={onDelete}
				>
					<span class="subm-actions__icon" aria-hidden="true">
						<TrashGlyph size={16} />
					</span>
					<span class="subm-actions__btnlabel">Delete Submission</span>
				</button>
				<button
					type="button"
					class="subm-actions__btn subm-actions__btn--primary"
					onClick={onSubmit}
				>
					<span class="subm-actions__icon" aria-hidden="true">
						<SendGlyph size={16} />
					</span>
					Submit for Review
				</button>
			</div>
		);
	}

	if (actions.statusBadge) {
		return (
			<div class="subm-actions">
				<StatusBadge status={actions.statusBadge} />
			</div>
		);
	}

	return null;
}
