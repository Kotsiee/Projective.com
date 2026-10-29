import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import "../styles/session-disputes.css";
import { Dialog, Message } from "@projective/ui/feedback";
import { Button, Textarea } from "@projective/ui/fields";
import { Tag } from "@projective/ui/display";
import type { DisputeRole, DisputeSummary } from "@projective/types/finance";
import type { SessionSitting, SessionWorkspace } from "@projective/types/projects";
import { SessionService } from "../core/SessionService.ts";
import {
	disputeSentence,
	disputeStatusLabel,
	disputeStatusSeverity,
	disputeTimeLabel,
	visibleDisputes,
} from "../core/dispute-view.ts";
import { DisputeCaseDialog } from "./DisputeCaseDialog.tsx";

/**
 * SessionDisputes — a session engagement's no-show section in the sidebar (Decision #212; DESIGN_SYSTEM
 * §C.1), under the Normal and Group session panels.
 *
 *   - **Report no-show** — for an attendee, on the sitting the server says is reportable now (started,
 *     its escrow still held, no claim on it yet: `SessionWorkspace.claimable`). PRODUCT_SPEC lets the
 *     CLIENT claim a no-show; the provider's side is the response, so the provider never sees this.
 *   - **Each claim the viewer is party to** — every live one and the latest ruling: the lifecycle pill,
 *     one sentence on what happens next, and "View case", which opens {@link DisputeCaseDialog} (the
 *     status panel, the evidence, the response form).
 *
 * After a claim or a statement the section re-reads the workspace, so the server-rendered list follows
 * the act (§3 gate 11). Renders nothing when there is nothing to report and no claim.
 */
export interface SessionDisputesProps {
	/** The viewer's workspace, after any dev preview. */
	workspace: SessionWorkspace;
	/** Surface the server's notice (the sidebar's toast). */
	onNotice: (message: string, severity: "success" | "error") => void;
}

export function SessionDisputes(props: SessionDisputesProps): JSX.Element | null {
	const { onNotice } = props;
	// The server's list until an act here re-reads it; a new workspace prop (a navigation) resets it.
	const local = useSignal<
		{ for: SessionWorkspace; claimable: SessionSitting | null; disputes: DisputeSummary[] } | null
	>(
		null,
	);
	const ws = props.workspace;
	const current = local.value && local.value.for === ws ? local.value : null;
	const claimable = current ? current.claimable : ws.claimable;
	const disputes = current ? current.disputes : ws.disputes;

	const reportOpen = useSignal(false);
	const reason = useSignal("");
	const busy = useSignal(false);
	const reportError = useSignal<string | null>(null);
	const caseOpen = useSignal(false);
	const selected = useSignal<DisputeSummary | null>(null);
	const reportActions = useRef<HTMLDivElement>(null);

	const viewer: DisputeRole = ws.role === "host" ? "respondent" : "claimant";
	const listed = visibleDisputes(disputes);
	const canReport = ws.role === "attendee" && !!claimable;
	if (!canReport && listed.length === 0) return null;

	async function refresh(): Promise<void> {
		const res = await SessionService.workspace(ws.slug);
		const next = res.ok ? res.data?.workspace : null;
		if (next) local.value = { for: ws, claimable: next.claimable, disputes: next.disputes };
	}

	async function report(): Promise<void> {
		if (!claimable || busy.value) return;
		busy.value = true;
		reportError.value = null;
		const res = await SessionService.claimNoShow(claimable.id, reason.value.trim() || null);
		busy.value = false;
		if (!res.ok || !res.data) {
			reportError.value = res.message ?? "The claim couldn't be filed — please try again.";
			return;
		}
		reportOpen.value = false;
		reason.value = "";
		onNotice(res.message ?? "Claim filed.", "success");
		await refresh();
	}

	return (
		<section class="sess-dispute" aria-label="No-show claims">
			<span class="sess-dispute__label">No-show claims</span>

			{canReport && claimable
				? (
					<div class="sess-dispute__report">
						<p class="sess-dispute__line">Provider didn't show?</p>
						<p class="sess-dispute__meta">
							{claimable.title} · {disputeTimeLabel(claimable.startsAt)}
						</p>
						<Button
							label="Report no-show"
							severity="danger"
							variant="text"
							size="sm"
							onClick={() => {
								reportError.value = null;
								reportOpen.value = true;
							}}
						/>
					</div>
				)
				: null}

			{listed.map((d) => (
				<div key={d.id} class="sess-dispute__item">
					<Tag
						value={disputeStatusLabel(d.status)}
						severity={disputeStatusSeverity(d.status)}
						variant="subtle"
						rounded
					/>
					<p class="sess-dispute__line">{disputeSentence(d, viewer)}</p>
					<Button
						label="View case"
						severity="secondary"
						variant="text"
						size="sm"
						onClick={() => {
							selected.value = d;
							caseOpen.value = true;
						}}
					/>
				</div>
			))}

			<Dialog
				visible={reportOpen}
				header="Report a no-show?"
				role="alertdialog"
				class="dispute-dlg"
				width="32rem"
				initialFocusRef={reportActions}
				footer={
					<div ref={reportActions} class="dispute-dlg__actions">
						<Button
							label="Cancel"
							severity="secondary"
							variant="text"
							onClick={() => (reportOpen.value = false)}
						/>
						<Button
							label="Report no-show"
							severity="danger"
							loading={busy.value}
							onClick={() => void report()}
						/>
					</div>
				}
			>
				<div class="dispute-dlg__body">
					<p class="dispute-dlg__lede">
						Your payment for <strong>{claimable?.title ?? "this session"}</strong>{" "}
						stays held while the claim is checked. When the session ends, the room's attendance logs
						decide it if they can: a provider who never joined means a full refund, and both of you
						in the room for most of it means the claim is dismissed. Otherwise the provider is asked
						to respond, then a Projective auditor rules.
					</p>
					<Textarea
						value={reason}
						rows={3}
						autoResize
						maxRows={6}
						maxLength={480}
						fluid
						aria-label="What happened (optional)"
						placeholder="What happened (optional)"
					/>
					{reportError.value
						? (
							<Message
								severity="danger"
								variant="subtle"
								size="sm"
								closable
								onClose={() => (reportError.value = null)}
							>
								{reportError.value}
							</Message>
						)
						: null}
				</div>
			</Dialog>

			<DisputeCaseDialog
				open={caseOpen}
				summary={selected.value}
				workspace={ws}
				onChanged={(message) => {
					if (message) onNotice(message, "success");
					void refresh();
				}}
			/>
		</section>
	);
}
