import type { JSX } from "preact";
import type { SpendRequest } from "@projective/types/workspace";
import { Button } from "@projective/ui/fields";
import { MetaLine } from "@projective/ui/display";
import {
	decidedLine,
	pendingLine,
	type QueueAct,
	type QueueBusy,
	queueControlId,
	REQUEST_EMPTY,
	type RequestRow,
	type RequestTab,
} from "../core/spend-model.ts";
import { PolicyAmount } from "./PolicyAmount.tsx";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * ApprovalQueue — spend that needs a decision, from both sides of it (BU2, Decision #246).
 *
 * **A request is what a refusal becomes.** When somebody tries to spend above their limit the answer is
 * never a plain no: the purchase becomes a request routed to whoever can approve it. That is why this
 * queue exists at all — without it, "you cannot spend that much" is a dead end and the work stops.
 *
 * One list serves both roles. An approver sees Approve and Decline; the requester sees that it waits,
 * and can take it back (Withdraw). Each row says what the money is FOR — the stage, ticket, basket or
 * invoice it was filed against — linked where the viewer can open it.
 *
 * ### One filled control per region
 * Only the FIRST decidable row's Approve is filled (tier 3, a workflow commit — #225 (A)); every other
 * row's Approve is outlined (tier 4), Decline and Withdraw are text (tier 5). A column of equally loud
 * pairs would make every request read as the one to act on (DESIGN_SYSTEM §B.8, BUSINESSES_AUDIT BD8).
 *
 * Rows sit on hairlines, never in tinted boxes: they are records, not cards. Both tabs always render,
 * each with its own empty state.
 */

// #region Props
/** Props for {@link ApprovalQueue}. */
export interface ApprovalQueueProps {
	/** Which tab this is. */
	view: RequestTab;
	/** The pending rows and their controls (`requestRows`) — the Pending tab. */
	rows?: readonly RequestRow[];
	/** The decided history — the Decided tab. */
	decided?: readonly SpendRequest[];
	/**
	 * The decision or withdrawal in flight: which request, and which control was pressed — only that
	 * control shows it is working. While one is, every control is disabled: one write at a time, so two
	 * re-reads can never land out of order.
	 */
	busy?: QueueBusy | null;
	/** Another write of the module (a policy save) is in flight: every control waits for it. */
	locked?: boolean;
	onDecide?: (requestId: string, approve: boolean) => void;
	onWithdraw?: (requestId: string) => void;
	/** Whether a row was made up by the Dev Context Switcher — it then offers no control. */
	isSimulated?: (requestId: string) => boolean;
}
// #endregion

// #region Pieces
/** Who asked, what for, and the facts under it. */
function RequestBody(props: { request: SpendRequest; facts: ReturnType<typeof pendingLine> }) {
	const { request } = props;
	const ref = request.ref;
	return (
		<div class="wsp-approvals__body">
			<span class="wsp-approvals__who">
				{request.handle ? <a href={`/@${request.handle}`}>{request.name}</a> : request.name}
			</span>
			<span class="wsp-approvals__reason">{request.reason}</span>
			{ref && (
				<span class="wsp-approvals__ref">
					{ref.href
						? <a class="wsp-approvals__ref-link" href={ref.href}>{ref.label}</a>
						: ref.label}
					{ref.detail && <span class="wsp-approvals__ref-detail">{ref.detail}</span>}
				</span>
			)}
			<MetaLine as="span" size="xs" class="wsp-approvals__meta" items={props.facts} />
		</div>
	);
}

function Avatar(props: { request: SpendRequest }) {
	return (
		<UserAvatar
			class="wsp-approvals__avatar"
			image={props.request.avatar || undefined}
			alt=""
			label={props.request.name}
			shape="circle"
			size="sm"
		/>
	);
}
// #endregion

// #region Component
/** One tab of the spend-request queue. */
export function ApprovalQueue(props: ApprovalQueueProps): JSX.Element {
	if (props.view === "decided") {
		const decided = props.decided ?? [];
		if (decided.length === 0) return <p class="wsp-approvals__empty">{REQUEST_EMPTY.decided}</p>;
		return (
			<ul class="wsp-approvals">
				{decided.map((request) => (
					<li class="wsp-approvals__item" key={request.id} data-state={request.state}>
						<Avatar request={request} />
						<RequestBody request={request} facts={decidedLine(request)} />
						<span class="wsp-approvals__amount">
							<PolicyAmount value={request.amount} size="body" muted />
						</span>
						<span class="wsp-approvals__actions" />
					</li>
				))}
			</ul>
		);
	}

	const rows = props.rows ?? [];
	if (rows.length === 0) return <p class="wsp-approvals__empty">{REQUEST_EMPTY.pending}</p>;
	const held = props.busy != null || props.locked === true;
	return (
		<ul class="wsp-approvals">
			{rows.map((row) => {
				const { request } = row;
				/** The pressed control shows its spinner; every control is disabled meanwhile. */
				const working = (act: QueueAct) => props.busy?.id === request.id && props.busy.act === act;
				const simulated = props.isSimulated?.(request.id) === true;
				return (
					<li class="wsp-approvals__item" key={request.id} data-state="pending">
						<Avatar request={request} />
						<RequestBody request={request} facts={pendingLine(request)} />
						<span class="wsp-approvals__amount">
							<PolicyAmount
								value={request.amount}
								size="body"
								srLabel={`${request.amount.display}, requested by ${request.name}`}
							/>
						</span>
						<div class="wsp-approvals__actions">
							{simulated
								? <MetaLine as="span" size="xs" items={["Simulated"]} />
								: row.action === "decide"
								? (
									<>
										{row.approveTier === "primary"
											? (
												<Button
													id={queueControlId(request.id, "approve")}
													severity="primary"
													variant="filled"
													label="Approve"
													loading={working("approve")}
													disabled={held}
													aria-label={`Approve ${request.amount.display} for ${request.name}`}
													onClick={() => props.onDecide?.(request.id, true)}
												/>
											)
											: (
												<Button
													id={queueControlId(request.id, "approve")}
													severity="neutral"
													variant="outlined"
													label="Approve"
													loading={working("approve")}
													disabled={held}
													aria-label={`Approve ${request.amount.display} for ${request.name}`}
													onClick={() => props.onDecide?.(request.id, true)}
												/>
											)}
										<Button
											id={queueControlId(request.id, "decline")}
											severity="secondary"
											variant="text"
											label="Decline"
											loading={working("decline")}
											disabled={held}
											aria-label={`Decline ${request.amount.display} for ${request.name}`}
											onClick={() => props.onDecide?.(request.id, false)}
										/>
									</>
								)
								: row.action === "withdraw"
								? (
									<>
										<MetaLine as="span" size="xs" items={["Waiting for a decision"]} />
										<Button
											id={queueControlId(request.id, "withdraw")}
											severity="secondary"
											variant="text"
											label="Withdraw"
											loading={working("withdraw")}
											disabled={held}
											aria-label={`Withdraw your request for ${request.amount.display}`}
											onClick={() => props.onWithdraw?.(request.id)}
										/>
									</>
								)
								: null}
						</div>
					</li>
				);
			})}
		</ul>
	);
}
// #endregion
