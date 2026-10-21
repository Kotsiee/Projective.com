import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { MetaLine } from "@projective/ui/display";
import { Button, Select } from "@projective/ui/fields";
import type { WorkspaceJoinRequest, WorkspaceRoleDef } from "@projective/types/workspace";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import "../styles/workspace-requests.css";

/**
 * JoinRequestQueue — the people who asked to join through the entity's invite link (Decision #318),
 * oldest first, each with the inviting side's two answers: **Approve** (seats them at the role shown,
 * which an approver may change to any role they may grant) and **Decline**.
 *
 * A request is not a member and holds no seat; approving runs every guard an accepted invitation
 * runs (the plan's seats, a business's manager cap, a team's freelancer-only rule), so an approval
 * can still be refused — with the server's sentence, under the row.
 */

// #region Props
export interface JoinRequestQueueProps {
	requests: readonly WorkspaceJoinRequest[];
	/** The roles the viewer may grant (`grantableRoles`) — what an approval may seat them at. */
	roles: readonly WorkspaceRoleDef[];
	/** The row currently mid-request. */
	busyId?: string | null;
	/** The last refusal, keyed by request id. */
	errors?: Readonly<Record<string, string>>;
	onRespond: (request: WorkspaceJoinRequest, accept: boolean, roleId: string) => void;
}
// #endregion

/** One request, with its role and the two answers. */
function RequestRow(props: {
	request: WorkspaceJoinRequest;
	roles: readonly WorkspaceRoleDef[];
	busy: boolean;
	error: string | null;
	onRespond: JoinRequestQueueProps["onRespond"];
}): JSX.Element {
	const { request, roles, busy } = props;
	const fallback = roles.some((r) => r.id === request.roleId) ? request.roleId : roles[0]?.id ?? "";
	const roleId = useSignal(fallback);
	const who = request.name || `@${request.handle}`;

	return (
		<li class="wsp-requests__item">
			<UserAvatar image={request.avatar || null} label={who} size="sm" />
			<div class="wsp-requests__body">
				<a class="wsp-requests__name" href={`/@${request.handle}`}>{who}</a>
				<MetaLine
					size="xs"
					items={[
						request.name && `@${request.handle}`,
						request.viaLink && "via invite link",
						request.sentAt && { text: request.sentAt, tabular: true },
					]}
				/>
				{request.message && <p class="wsp-requests__note">{request.message}</p>}
				{props.error && <p class="wsp-requests__error" role="alert">{props.error}</p>}
			</div>
			<div class="wsp-requests__actions">
				<Select
					size="sm"
					options={roles.map((r) => ({ label: r.name, value: r.id }))}
					value={roleId.value}
					onValueChange={(next) => {
						if (next) roleId.value = next;
					}}
					panelWidth="auto"
					disabled={busy || roles.length === 0}
					aria-label={`Role ${who} joins as`}
				/>
				<Button
					variant="outlined"
					size="sm"
					label="Approve"
					loading={busy}
					disabled={roles.length === 0}
					onClick={() => props.onRespond(request, true, roleId.peek())}
				/>
				<Button
					variant="text"
					severity="secondary"
					size="sm"
					label="Decline"
					disabled={busy}
					onClick={() => props.onRespond(request, false, roleId.peek())}
				/>
			</div>
		</li>
	);
}

/** The pending join requests. */
export function JoinRequestQueue(props: JoinRequestQueueProps): JSX.Element {
	if (props.requests.length === 0) {
		return (
			<p class="wsp-prose">
				No requests to join. Share the invite link from Invite to let people ask.
			</p>
		);
	}
	return (
		<ul class="wsp-requests" aria-label="Requests to join">
			{props.requests.map((request) => (
				<RequestRow
					key={request.id}
					request={request}
					roles={props.roles}
					busy={props.busyId === request.id}
					error={props.errors?.[request.id] ?? null}
					onRespond={props.onRespond}
				/>
			))}
		</ul>
	);
}
