import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { type IncomingInvite, kindCopy } from "@projective/types/workspace";
import { initialsOf } from "../core/workspace-model.ts";
import { ApproveGlyph, cloneGlyph, CloseGlyph, DeclineGlyph } from "../core/workspace-glyphs.tsx";

/**
 * InvitationStrip — the invitations addressed to the VIEWER, above the roster.
 *
 * This is the only block on the index that represents somebody waiting on the reader, which is why it is
 * the one place allowed a tonal plate and why it sits above the cards rather than inside them. Three
 * properties matter:
 *
 *   1. **It never blocks.** The roster below stays fully usable, and the strip is dismissible — an
 *      invitation the reader is not ready to answer must not hold their own entities hostage.
 *   2. **Both answers are one click, in place.** An invitation resolved through a detour is an invitation
 *      that sits unanswered, so Accept and Decline are inline. Dismissing hides the strip; declining
 *      answers it. Those are different acts and are not conflated.
 *   3. **Accept is affirmative, Decline is quiet.** Decline is not destructive-red: refusing to join a
 *      team is an ordinary, correct answer, and colouring it as damage would pressure the reader.
 *
 * Dumb: it renders what it is given and dispatches the answer upward. The island owns the optimistic
 * removal and the reconciliation from the server's refreshed roster.
 */

// #region Props
export interface InvitationStripProps {
	/** The invitations still awaiting an answer. */
	invitations: readonly IncomingInvite[];
	/** Ids currently in flight — their row shows progress and its buttons are inert. */
	pending: ReadonlySet<string>;
	/** Answer one invitation. */
	onRespond: (invite: IncomingInvite, accept: boolean) => void;
	/** Hide the strip for this visit without answering anything. */
	onDismiss: () => void;
}
// #endregion

export function InvitationStrip(props: InvitationStripProps): JSX.Element | null {
	const { invitations, pending, onRespond, onDismiss } = props;
	if (invitations.length === 0) return null;

	return (
		<section class="wsp-invitestrip" aria-labelledby="wsp-invites-title">
			<div class="wsp-invitestrip__head">
				<h2 class="wsp-invitestrip__title" id="wsp-invites-title">
					{invitations.length === 1
						? "1 invitation waiting"
						: `${invitations.length} invitations waiting`}
				</h2>
				<Tooltip content="Hide until next time — this does not decline them" placement="top">
					<button
						type="button"
						class="wsp-invitestrip__dismiss"
						aria-label="Hide invitations"
						onClick={onDismiss}
					>
						{cloneGlyph(CloseGlyph)}
					</button>
				</Tooltip>
			</div>

			<ul class="wsp-invitestrip__list">
				{invitations.map((invite) => (
					<InviteRow
						key={invite.id}
						invite={invite}
						busy={pending.has(invite.id)}
						onRespond={onRespond}
					/>
				))}
			</ul>
		</section>
	);
}

// #region One invitation
function InviteRow(
	{ invite, busy, onRespond }: {
		invite: IncomingInvite;
		busy: boolean;
		onRespond: (invite: IncomingInvite, accept: boolean) => void;
	},
): JSX.Element {
	const copy = kindCopy(invite.kind);

	return (
		<li class="wsp-invitestrip__item" data-kind={invite.kind} aria-busy={busy ? "true" : undefined}>
			<span class="wsp-mark" aria-hidden="true">
				{invite.workspaceAvatar
					? <img class="wsp-mark__img" src={invite.workspaceAvatar} alt="" loading="lazy" />
					: (
						<span class="wsp-mark__initial">
							{initialsOf(invite.workspaceName, invite.workspaceHandle)}
						</span>
					)}
			</span>

			<div class="wsp-invitestrip__body">
				<p class="wsp-invitestrip__text">
					<span class="wsp-invitestrip__name">{invite.workspaceName}</span>
					{` invited you to join as ${invite.roleLabel.toLowerCase()}`}
				</p>
				{
					/*
					 * Who asked, and what kind of entity it is — the two facts that decide the answer. The
					 * sender's handle is a link to their profile so the reader can check before committing.
					 */
				}
				<span class="wsp-invitestrip__meta">
					<span class="wsp-chip wsp-chip--kind">{copy.Noun}</span>
					<a class="wsp-trunc" href={`/@${invite.fromHandle}`}>{invite.fromName}</a>
					<span aria-hidden="true">·</span>
					<span class="wsp-trunc">{invite.sentAt}</span>
				</span>
			</div>

			<div class="wsp-invitestrip__actions">
				<button
					type="button"
					class="wsp-invitestrip__accept"
					disabled={busy}
					onClick={() =>
						onRespond(invite, true)}
				>
					<span aria-hidden="true">{cloneGlyph(ApproveGlyph)}</span>
					{busy ? "Joining…" : "Accept"}
				</button>
				<button
					type="button"
					class="wsp-invitestrip__decline"
					disabled={busy}
					onClick={() =>
						onRespond(invite, false)}
				>
					<span aria-hidden="true">{cloneGlyph(DeclineGlyph)}</span>
					Decline
				</button>
			</div>
		</li>
	);
}
// #endregion
