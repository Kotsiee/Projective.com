import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { Badge, MetaLine } from "@projective/ui/display";
import { Button } from "@projective/ui/fields";
import { InlineNotice, Tooltip } from "@projective/ui/feedback";
import type { IncomingInvite } from "@projective/types/workspace";
import { openSettings } from "@features/settings/core/settings-bridge.ts";
import {
	focusAfterResolving,
	type InviteAcceptTier,
	inviteMeta,
	type InviteRefusal,
	type InviteRowActions,
} from "../core/invitation-strip-model.ts";
import { cloneGlyph, CloseGlyph } from "../core/workspace-glyphs.tsx";
import { EntityMark } from "./EntityMark.tsx";

/**
 * InvitationStrip — the invitations addressed to the VIEWER, above the `/teams` · `/businesses` roster.
 *
 * A SECTION, not a plate: the section-header register names it and a count badge counts it; its rows
 * are separated by one hairline each, with no fill and no per-row box (§B.4, §B.9). Each row is the
 * entity's mark and name, its facts as one meta line — kind, role offered, sender, days left; the kind
 * is a word, never a chip (§B.11) — and the sender's note as body text when there is one.
 *
 *   1. **It never blocks.** The roster below stays usable and the strip is dismissible: an invitation
 *      the reader is not ready to answer must not hold their own entities hostage. Dismissing hides it;
 *      declining answers it. Different acts, not conflated. On the Invitations tab the strip IS the list,
 *      so it cannot be hidden there and draws no dismiss control (§3.11).
 *   2. **One filled button in the whole strip** (§B.8.1). The first row's Accept is the tier-3 commit,
 *      every other Accept the tier-4 neutral outline, Decline the tier-5 text on every row. The plan is
 *      computed by the caller ({@link InviteRowActions}), so answering the first row hands the fill on.
 *   3. **Focus follows the answer.** The answered row leaves at once, so focus moves BEFORE it does —
 *      to the next row's Accept, else the previous row's, else this strip's heading.
 *   4. **A refusal stays with its row.** A refused answer brings the row back with an InlineNotice under
 *      it, and the fix beside it when the reader can make it — never a toast that evaporates.
 *
 * Dumb: the caller owns the answers (`useInvitationAnswers`) and the dismissal.
 */

// #region Props
export interface InvitationStripProps {
	/** The invitations still awaiting an answer, in the server's order. */
	invitations: readonly IncomingInvite[];
	/** Each row's controls, from `planInviteActions` — exactly one tier-3 Accept. */
	actions: readonly InviteRowActions[];
	/** The refusal standing against a row since its last answer failed. */
	refusals: ReadonlyMap<string, InviteRefusal>;
	/** The last answer that landed, for the strip's polite status line. */
	outcome: string | null;
	/** Answer one invitation. */
	onRespond: (invite: IncomingInvite, accept: boolean) => void;
	/**
	 * Whether dismissing can hide the strip here (`invitationStripDismissible`). When `false` — the
	 * Invitations tab, where the strip IS the list — no dismiss control renders at all.
	 */
	dismissible: boolean;
	/** Hide the strip for this visit without answering anything. */
	onDismiss: () => void;
	/** The clock the day count reads (default: now). */
	nowMs?: number;
}
// #endregion

// #region Ids
const HEADING_ID = "wsp-invites-title";

/** The DOM id of a row's Accept — where focus lands when the row before it is answered. */
function acceptId(inviteId: string): string {
	return `wsp-invite-${inviteId}-accept`;
}
// #endregion

/** The strip: heading + count, one row per waiting invitation, and the polite outcome line. */
export function InvitationStrip(props: InvitationStripProps): JSX.Element {
	const { invitations, actions, refusals, outcome, onRespond, dismissible, onDismiss } = props;
	const headingRef = useRef<HTMLHeadingElement>(null);
	const now = props.nowMs ?? Date.now();
	const count = invitations.length;
	const tiers = new Map(actions.map((row) => [row.id, row.accept]));

	/** Move focus off the row about to leave, then answer it. */
	function answer(invite: IncomingInvite, accept: boolean): void {
		const next = focusAfterResolving(invitations.map((row) => row.id), invite.id);
		const target = next ? globalThis.document?.getElementById(acceptId(next)) : headingRef.current;
		target?.focus();
		onRespond(invite, accept);
	}

	return (
		<section class="wsp-invitestrip" aria-labelledby={HEADING_ID}>
			<div class="wsp-invitestrip__head">
				<h2 ref={headingRef} class="wsp-label wsp-invitestrip__title" id={HEADING_ID} tabIndex={-1}>
					Invitations
					{count > 0 && (
						<>
							<Badge class="wsp-invitestrip__count" value={count} severity="secondary" size="sm" />
							<span class="ui-visually-hidden">{`, ${count} waiting`}</span>
						</>
					)}
				</h2>
				{dismissible && (
					<Tooltip content="Hide until next time — this does not decline them" placement="top">
						<Button
							iconOnly
							variant="text"
							severity="secondary"
							size="sm"
							icon={cloneGlyph(CloseGlyph)}
							aria-label="Hide invitations"
							onClick={onDismiss}
						/>
					</Tooltip>
				)}
			</div>

			{count > 0
				? (
					<ul class="wsp-invitestrip__list">
						{invitations.map((invite) => (
							<InviteRow
								key={invite.id}
								invite={invite}
								tier={tiers.get(invite.id) ?? 4}
								refusal={refusals.get(invite.id) ?? null}
								nowMs={now}
								onAnswer={answer}
							/>
						))}
					</ul>
				)
				: <p class="wsp-invitestrip__empty">Nothing else is waiting on you.</p>}

			<p class="wsp-invitestrip__outcome" role="status" aria-live="polite">{outcome ?? ""}</p>
		</section>
	);
}

// #region One invitation
function InviteRow(
	{ invite, tier, refusal, nowMs, onAnswer }: {
		invite: IncomingInvite;
		tier: InviteAcceptTier;
		refusal: InviteRefusal | null;
		nowMs: number;
		onAnswer: (invite: IncomingInvite, accept: boolean) => void;
	},
): JSX.Element {
	const name = invite.workspaceName;

	return (
		<li class="wsp-invitestrip__item">
			<EntityMark
				name={name}
				handle={invite.workspaceHandle}
				kind={invite.kind}
				image={invite.workspaceAvatar}
			/>

			<div class="wsp-invitestrip__body">
				<h3 class="wsp-invitestrip__name">{name}</h3>
				<MetaLine items={inviteMeta(invite, nowMs)} />
				{invite.note && <p class="wsp-invitestrip__note">{invite.note}</p>}
				{refusal && <RefusalNotice refusal={refusal} />}
			</div>

			<div class="wsp-invitestrip__actions">
				{tier === 3
					? (
						<Button
							id={acceptId(invite.id)}
							size="sm"
							label="Accept"
							aria-label={`Accept the invitation to join ${name}`}
							onClick={() => onAnswer(invite, true)}
						/>
					)
					: (
						<Button
							id={acceptId(invite.id)}
							size="sm"
							severity="neutral"
							variant="outlined"
							label="Accept"
							aria-label={`Accept the invitation to join ${name}`}
							onClick={() => onAnswer(invite, true)}
						/>
					)}
				<Button
					size="sm"
					variant="text"
					severity="secondary"
					label="Decline"
					aria-label={`Decline the invitation to join ${name}`}
					onClick={() => onAnswer(invite, false)}
				/>
			</div>
		</li>
	);
}
// #endregion

// #region A refused answer
/**
 * The refusal under its row: one assertive InlineNotice sentence and, for the earning gate, the tier-4
 * link to Settings → Verification (Decision #196) — opened in the contextual Settings modal on a plain
 * click, a real link otherwise.
 */
function RefusalNotice({ refusal }: { refusal: InviteRefusal }): JSX.Element {
	return (
		<div class="wsp-invitestrip__refusal">
			<InlineNotice
				class="wsp-invitestrip__notice"
				align="start"
				assertive
				text={refusal.text}
			/>
			{refusal.fix && (
				<a
					class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm wsp-invitestrip__fix"
					href={refusal.fix.href}
					onClick={(event) => {
						if (
							refusal.code !== "payout" || event.metaKey || event.ctrlKey || event.shiftKey ||
							event.altKey || event.button !== 0
						) return;
						event.preventDefault();
						openSettings("verification");
					}}
				>
					<span class="ui-button__label">{refusal.fix.label}</span>
				</a>
			)}
		</div>
	);
}
// #endregion
