import type { JSX } from "preact";
import type { SubmissionStatus } from "../types/projects-types.ts";
import type { WorkflowActions } from "../core/submission-access.ts";
import { statusTone } from "../core/submission-model.ts";
import {
	AcceptedGlyph,
	ExitGlyph,
	PlusGlyph,
	ReviewGlyph,
	SendGlyph,
	SubmissionStatusIcon,
	UploadGlyph,
} from "./submission-glyphs.tsx";

/**
 * SubmissionActionBar — the primary/secondary workflow controls pinned to the right of the breadcrumbs
 * bar (`subm-crumbbar`), driven by the resolved {@link WorkflowActions} state machine (root task §3):
 *
 * - **Reviewer** viewing a submitted item → **Review Submission**; once the unit is accepted, also
 *   **Approve Stage** (releases any escrow still held on the stage and closes it, behind a confirmation).
 * - **Reviewer** anywhere inside a stage → **End Stage (Fair Exit)**, which opens the tier preview
 *   (Decision #198).
 * - **Freelancer** at the root → **Create New Submission**.
 * - **Freelancer** inside an unsubmitted draft → **Add Files** (the shared file picker: upload from
 *   this device or choose from the library) · **Submit for Review**. There is no Delete: a draft has no
 *   discard door yet, and removing one is the hard-delete question Decision #338 (d) leaves open.
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
	onSubmit: () => void;
	/** Open the stage-approval confirmation (reviewer, accepted unit). */
	onApproveStage: () => void;
	/** A stage approval is in flight — the control is disabled and says so. */
	approveBusy?: boolean;
	/** Open the Fair Exit confirmation (reviewer, a stage in scope). */
	onEndStage: () => void;
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
	const { actions, onReview, onCreate, onUpload, onSubmit, onApproveStage, onEndStage } = props;
	const approveBusy = props.approveBusy === true;

	if (actions.review || actions.approveStage || actions.endStage) {
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
				{actions.endStage
					? (
						<button
							type="button"
							class="subm-actions__btn subm-actions__btn--danger"
							aria-label="End stage (Fair Exit)"
							aria-haspopup="dialog"
							onClick={onEndStage}
						>
							<span class="subm-actions__icon" aria-hidden="true">
								<ExitGlyph size={16} />
							</span>
							<span class="subm-actions__btnlabel">End Stage (Fair Exit)</span>
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
					Add Files
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
