import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import type { WorkspaceInvite, WorkspaceRoleDef } from "@projective/types/workspace";
import { shortDate } from "../core/workspace-model.ts";
import { CrossIcon, InviteOutIcon, memberProfileHref, ResendIcon } from "./MemberCard.tsx";

/**
 * InviteQueue — the invitations this entity has sent that nobody has answered yet.
 *
 * Every row names one person or one address, and every row carries the inviting side's two actions:
 * **resend** (a fresh 14-day window, a new notification) and **withdraw**. Accepting and declining are
 * the invitee's, not ours, so they never appear here — an admin control that answered on somebody
 * else's behalf is exactly the kind of button that works in a demo and lies in production.
 *
 * A lapsed expiry is amber, never red: a lapsed invitation is resendable, not broken.
 */

// #region Vocabulary
/** What the queue can be asked to do to a row. */
export type InviteAction =
	/** Withdraw an invitation we sent. */
	| "revoke"
	/** Send an unanswered or lapsed invitation again, with a fresh window. */
	| "resend";

export interface InviteQueueProps {
	invites: readonly WorkspaceInvite[];
	roles: readonly WorkspaceRoleDef[];
	/** Whether the viewer holds `invite_members`. Gated rows stay visible, disabled, with the reason. */
	canManage: boolean;
	/** The row currently mid-request, so its buttons can show progress rather than appear inert. */
	busyId?: string | null;
	onAction: (action: InviteAction, invite: WorkspaceInvite) => void;
	/** Server-resolved reference year so an SSR date and its hydration agree across a New Year. */
	referenceYear?: number;
}
// #endregion

// #region Helpers
/** The role a pending person will hold on acceptance, by name. */
function offeredRole(invite: WorkspaceInvite, roles: readonly WorkspaceRoleDef[]): string {
	return roles.find((r) => r.id === invite.roleId)?.name ?? "A role that has since been archived";
}

/** Whether an invitation's window has closed. A lapsed invite is resendable, not broken. */
function hasLapsed(invite: WorkspaceInvite): boolean {
	if (!invite.expiresAt) return false;
	const at = new Date(invite.expiresAt).getTime();
	return Number.isFinite(at) && at < Date.now();
}

/** Who the row is addressed to, as a reader would say it. */
function addresseeOf(invite: WorkspaceInvite): string {
	return invite.name || invite.email || `@${invite.handle}`;
}
// #endregion

// #region Rows
/** One pending invitation, with the inviting side's two actions. */
function InviteRow(props: {
	invite: WorkspaceInvite;
	roles: readonly WorkspaceRoleDef[];
	canManage: boolean;
	busy: boolean;
	onAction: (action: InviteAction, invite: WorkspaceInvite) => void;
	referenceYear?: number;
}): JSX.Element {
	const { invite, roles, canManage, busy, onAction, referenceYear } = props;
	const who = addresseeOf(invite);
	const lapsed = hasLapsed(invite);
	const gate = canManage ? null : "You need permission to invite members to change this.";

	return (
		<li class="wsp-invites__item" data-direction="invite">
			<Tooltip content={`You invited ${who} — they owe you an answer.`}>
				<span class="wsp-invites__dir">
					<InviteOutIcon />
				</span>
			</Tooltip>

			<div class="wsp-invites__body">
				<span class="wsp-invites__name">{who}</span>
				<span class="wsp-invites__meta">
					{invite.handle && (
						<a class="wsp-invites__meta" href={memberProfileHref(invite.handle)}>
							{`@${invite.handle}`}
						</a>
					)}
					{invite.email && invite.email !== who && <span>{invite.email}</span>}
					<span>{offeredRole(invite, roles)}</span>
					<span>{invite.sentAt}</span>
				</span>
				{invite.note && <p class="wsp-invites__note">{invite.note}</p>}
			</div>

			{invite.expiresAt
				? (
					<Tooltip
						content={lapsed
							? "This invitation has expired. Sending it again issues a fresh window."
							: "The invitation stops working after this date."}
					>
						<span class="wsp-invites__expiry wsp-num" data-lapsed={lapsed ? "true" : undefined}>
							{shortDate(invite.expiresAt, referenceYear)}
						</span>
					</Tooltip>
				)
				: <span class="wsp-invites__expiry" />}

			<div class="wsp-invites__actions">
				<Tooltip content={gate ?? "Send this invitation again with a fresh window."}>
					<Button
						variant="text"
						severity="secondary"
						size="sm"
						iconOnly
						icon={<ResendIcon />}
						loading={busy}
						disabled={!canManage}
						aria-label={`Resend the invitation to ${who}`}
						onClick={() => onAction("resend", invite)}
					/>
				</Tooltip>
				<Tooltip content={gate ?? "Withdraw this invitation."}>
					<Button
						variant="text"
						severity="secondary"
						size="sm"
						iconOnly
						icon={<CrossIcon />}
						disabled={!canManage || busy}
						aria-label={`Withdraw the invitation to ${who}`}
						onClick={() => onAction("revoke", invite)}
					/>
				</Tooltip>
			</div>
		</li>
	);
}
// #endregion

// #region Queue
/** The outgoing invitation queue. */
export function InviteQueue(props: InviteQueueProps): JSX.Element {
	const { invites, roles, canManage, busyId, onAction, referenceYear } = props;

	if (invites.length === 0) {
		return <p class="wsp-prose">No invitations are waiting for an answer.</p>;
	}

	return (
		<div class="wsp-invites">
			<ul class="wsp-invites__list">
				{invites.map((invite) => (
					<InviteRow
						key={invite.id}
						invite={invite}
						roles={roles}
						canManage={canManage}
						busy={busyId === invite.id}
						onAction={onAction}
						referenceYear={referenceYear}
					/>
				))}
			</ul>
		</div>
	);
}
// #endregion
