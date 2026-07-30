import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import type { SpendRequest } from "@projective/types/workspace";
import { PolicyAmount } from "./PolicyAmount.tsx";
import { ApproveIcon, CrossIcon } from "./MemberCard.tsx";

/**
 * ApprovalQueue — spend that needs a decision, from both sides of it.
 *
 * **A request is what a refusal becomes.** When somebody tries to spend above their limit the answer is
 * never a plain no: the purchase becomes a request routed to whoever can approve it. That is why this
 * queue exists at all — without it, "you cannot spend that much" is a dead end and the work stops.
 *
 * The same list serves both roles, which is deliberate. An approver sees Approve and Decline; the
 * requester sees who it is waiting on. Two separate screens would mean the requester has to ask someone
 * whether they have been approved yet.
 */

export interface ApprovalQueueProps {
	requests: readonly SpendRequest[];
	/** Whether the viewer may decide these — drives the presence of the action pair. */
	canApprove: boolean;
	/** The request currently being decided, so its buttons can show progress. */
	busyId?: string | null;
	onDecide: (requestId: string, approve: boolean) => void;
	/** Where the full spend-approval surface lives. */
	accessHref?: string;
}

/** Pending and recently-decided spend requests. */
export function ApprovalQueue(props: ApprovalQueueProps): JSX.Element {
	const pending = props.requests.filter((r) => r.state === "pending");
	const decided = props.requests.filter((r) => r.state !== "pending");

	if (props.requests.length === 0) {
		return (
			<p class="wsp-pagehead__meta">
				Nothing is waiting on a decision. Spending above someone's limit will appear here instead of
				being refused.
			</p>
		);
	}

	return (
		<div class="wsp-approvals">
			{pending.map((req) => (
				<div class="wsp-approvals__item" key={req.id} data-state="pending">
					<Avatar
						class="wsp-approvals__avatar"
						image={req.avatar}
						alt=""
						label={req.name}
						shape="circle"
						size="sm"
					/>
					<div class="wsp-approvals__body">
						<span class="wsp-approvals__who">
							<a href={`/@${req.handle}`}>{req.name}</a>
						</span>
						<span class="wsp-approvals__reason">{req.reason}</span>
						<span class="wsp-approvals__meta">
							{req.raisedAt}
							{req.approvers.length > 0 && ` · waiting on ${req.approvers.join(", ")}`}
						</span>
					</div>

					<span class="wsp-approvals__row">
						<PolicyAmount value={req.amount} size="key" srLabel={`Requested by ${req.name}`} />
					</span>

					{props.canApprove
						? (
							<div class="wsp-approvals__actions">
								<Tooltip content="Approve this spend" placement="top">
									<button
										type="button"
										class="wsp-footerrig__action"
										aria-label={`Approve ${req.amount.display} for ${req.name}`}
										disabled={props.busyId === req.id}
										onClick={() => props.onDecide(req.id, true)}
									>
										<span class="wsp-footerrig__glyph" aria-hidden="true">
											<ApproveIcon />
										</span>
										<span class="wsp-footerrig__label">Approve</span>
									</button>
								</Tooltip>
								<Tooltip content="Decline this spend" placement="top">
									<button
										type="button"
										class="wsp-footerrig__action"
										aria-label={`Decline ${req.amount.display} for ${req.name}`}
										disabled={props.busyId === req.id}
										onClick={() => props.onDecide(req.id, false)}
									>
										<span class="wsp-footerrig__glyph" aria-hidden="true">
											<CrossIcon />
										</span>
										<span class="wsp-footerrig__label">Decline</span>
									</button>
								</Tooltip>
							</div>
						)
						: (
							// The requester's view: a live status, so they never have to go and ask.
							<span class="wsp-approvals__decided" role="status">
								Waiting for a decision
							</span>
						)}
				</div>
			))}

			{decided.map((req) => (
				<div class="wsp-approvals__item" key={req.id} data-state={req.state}>
					<Avatar
						class="wsp-approvals__avatar"
						image={req.avatar}
						alt=""
						label={req.name}
						shape="circle"
						size="sm"
					/>
					<div class="wsp-approvals__body">
						<span class="wsp-approvals__who">{req.name}</span>
						<span class="wsp-approvals__reason">{req.reason}</span>
					</div>
					<span class="wsp-approvals__row">
						<PolicyAmount value={req.amount} size="body" muted />
					</span>
					<span class="wsp-approvals__decided">
						{req.state === "approved" ? "Approved" : "Declined"}
						{req.decidedBy ? ` by ${req.decidedBy}` : ""}
						{req.decidedAt ? ` · ${req.decidedAt}` : ""}
					</span>
				</div>
			))}

			{props.accessHref && (
				<p class="wsp-moneyhead">
					<a class="wsp-moneyhead__link" href={props.accessHref}>
						Open spend approvals in the wallet
					</a>
				</p>
			)}
		</div>
	);
}
