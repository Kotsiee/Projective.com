import type { JSX } from "preact";
import { Button, InputText } from "@projective/ui/fields";
import { Tooltip } from "@projective/ui/feedback";
import type { WorkspaceInvite, WorkspaceRoleDef } from "@projective/types/workspace";
import { shortDate } from "../core/workspace-model.ts";
import {
	ApproveIcon,
	CopyIcon,
	CrossIcon,
	InviteInIcon,
	InviteOutIcon,
	LinkIcon,
	memberProfileHref,
	ResendIcon,
} from "./MemberCard.tsx";

/**
 * InviteQueue — invitations we sent, join requests we received, and the entity's shareable link, in one
 * queue with **opposite actions per direction**.
 *
 * `invite` and `request` are deliberately distinct states in the SSOT rather than one "pending", and this
 * is where that pays off: an invitation is ours to resend or revoke, a request is theirs to have approved
 * or declined. Collapsing them into a single list of pending rows would make the queue lie about who owes
 * whom a decision — the single most common way an invitation inbox becomes useless.
 *
 * The direction is carried by a leading glyph with the sentence in its tooltip (§B.6), and the action
 * pair swaps beneath it. A lapsed expiry is amber, never red: a lapsed invitation is resendable, not
 * broken.
 */

// #region Vocabulary
/** What the queue can be asked to do to a row. */
export type InviteAction =
	/** Accept a join request — they become a member at the offered role. */
	| "approve"
	/** Turn a join request down. */
	| "decline"
	/** Withdraw an invitation we sent. */
	| "revoke"
	/** Send a lapsed or unanswered invitation again. */
	| "resend";

/** Which partition of the queue is on screen — mirrors the module's header tabs. */
export type InviteView = "sent" | "requests" | "links";

export interface InviteQueueProps {
	invites: readonly WorkspaceInvite[];
	roles: readonly WorkspaceRoleDef[];
	view: InviteView;
	/** Whether the viewer holds `invite_members`. Gated rows stay visible, disabled, with the reason. */
	canManage: boolean;
	/** The row currently mid-request, so its buttons can show progress rather than appear inert. */
	busyId?: string | null;
	onAction: (action: InviteAction, invite: WorkspaceInvite) => void;
	/** The entity's current shareable invitation URL, and the role/expiry it carries. */
	shareLink?: { url: string; roleName: string; expiresLabel: string } | null;
	/** Server-resolved reference year so an SSR date and its hydration agree across a New Year. */
	referenceYear?: number;
}
// #endregion

// #region Helpers
/** The role a pending person will hold on acceptance — a custom role's name, else the raw id. */
function offeredRole(invite: WorkspaceInvite, roles: readonly WorkspaceRoleDef[]): string {
	return roles.find((r) => r.id === invite.roleId)?.name ?? invite.roleId;
}

/** Whether a share-link invitation's window has closed. A lapsed invite is resendable, not broken. */
function hasLapsed(invite: WorkspaceInvite): boolean {
	if (!invite.expiresAt) return false;
	const at = new Date(invite.expiresAt).getTime();
	return Number.isFinite(at) && at < Date.now();
}
// #endregion

// #region Rows
/** One pending person, with the action pair their direction calls for. */
function InviteRow(props: {
	invite: WorkspaceInvite;
	roles: readonly WorkspaceRoleDef[];
	canManage: boolean;
	busy: boolean;
	onAction: (action: InviteAction, invite: WorkspaceInvite) => void;
	referenceYear?: number;
}): JSX.Element {
	const { invite, roles, canManage, busy, onAction, referenceYear } = props;
	const inbound = invite.direction === "request";
	const lapsed = hasLapsed(invite);
	const gate = canManage ? null : "You need permission to invite members to answer this.";

	return (
		<li class="wsp-invites__item" data-direction={invite.direction}>
			<Tooltip
				content={inbound
					? `${invite.name} asked to join — you owe them a decision.`
					: `You invited ${invite.name} — they owe you an answer.`}
			>
				<span class="wsp-invites__dir">
					{inbound ? <InviteInIcon /> : <InviteOutIcon />}
				</span>
			</Tooltip>

			<div class="wsp-invites__body">
				<span class="wsp-invites__name">
					{invite.name || invite.email || `@${invite.handle}`}
				</span>
				<span class="wsp-invites__meta">
					{invite.handle && (
						<a class="wsp-invites__meta" href={memberProfileHref(invite.handle)}>
							{`@${invite.handle}`}
						</a>
					)}
					{invite.email && <span>{invite.email}</span>}
					<span>{offeredRole(invite, roles)}</span>
					<span>{invite.sentAt}</span>
					{invite.viaLink && (
						<Tooltip content="Arrived through a shareable invitation link.">
							<span class="wsp-invites__dir">
								<LinkIcon />
							</span>
						</Tooltip>
					)}
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
				{inbound
					? (
						<>
							<Tooltip content={gate ?? `Approve ${invite.name}'s request to join.`}>
								<Button
									variant="text"
									severity="success"
									size="sm"
									iconOnly
									icon={<ApproveIcon />}
									loading={busy}
									disabled={!canManage}
									aria-label={`Approve ${invite.name}`}
									onClick={() => onAction("approve", invite)}
								/>
							</Tooltip>
							<Tooltip content={gate ?? `Decline ${invite.name}'s request.`}>
								<Button
									variant="text"
									severity="secondary"
									size="sm"
									iconOnly
									icon={<CrossIcon />}
									disabled={!canManage || busy}
									aria-label={`Decline ${invite.name}`}
									onClick={() => onAction("decline", invite)}
								/>
							</Tooltip>
						</>
					)
					: (
						<>
							<Tooltip content={gate ?? "Send this invitation again with a fresh window."}>
								<Button
									variant="text"
									severity="secondary"
									size="sm"
									iconOnly
									icon={<ResendIcon />}
									loading={busy}
									disabled={!canManage}
									aria-label={`Resend the invitation to ${invite.name}`}
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
									aria-label={`Withdraw the invitation to ${invite.name}`}
									onClick={() => onAction("revoke", invite)}
								/>
							</Tooltip>
						</>
					)}
			</div>
		</li>
	);
}

/**
 * The shareable link.
 *
 * A copy CONTROL plus its terms, never a bare URL the reader has to select by hand. The link states the
 * role it grants and when it stops working, because a link that silently carries admin authority is the
 * one invitation mechanism nobody audits.
 */
function ShareLinkRow(
	props: { link: { url: string; roleName: string; expiresLabel: string } },
): JSX.Element {
	const { link } = props;
	return (
		<div class="wsp-invites__linkrow">
			<span class="wsp-invites__dir">
				<LinkIcon />
			</span>
			<div class="wsp-invites__linkfield">
				<InputText
					value={link.url}
					readOnly
					block
					aria-label="Shareable invitation link"
				/>
			</div>
			<div class="wsp-invites__copy">
				<Button
					variant="outlined"
					size="sm"
					icon={<CopyIcon />}
					label="Copy"
					onClick={() => {
						navigator.clipboard?.writeText(link.url);
					}}
				/>
			</div>
			<p class="wsp-invites__linknote">
				{`Anyone with this link joins as ${link.roleName}. ${link.expiresLabel}`}
			</p>
		</div>
	);
}
// #endregion

// #region Queue
/** The invitation queue for one partition. */
export function InviteQueue(props: InviteQueueProps): JSX.Element {
	const {
		invites,
		roles,
		view,
		canManage,
		busyId,
		onAction,
		shareLink,
		referenceYear,
	} = props;

	const rows = invites.filter((invite) => {
		if (view === "requests") return invite.direction === "request";
		if (view === "links") return invite.viaLink;
		return invite.direction === "invite" && !invite.viaLink;
	});

	const empty = view === "requests"
		? "Nobody has asked to join yet. Requests arrive here when somebody applies from your public page."
		: view === "links"
		? "No arrivals through a link yet."
		: "No invitations are waiting for an answer.";

	return (
		<div class="wsp-invites">
			{view === "links" && shareLink && <ShareLinkRow link={shareLink} />}

			{rows.length === 0 ? <p class="wsp-prose">{empty}</p> : (
				<ul class="wsp-invites__list">
					{rows.map((invite) => (
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
			)}
		</div>
	);
}
// #endregion
