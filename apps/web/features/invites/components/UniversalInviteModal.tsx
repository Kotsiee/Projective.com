import type { ComponentChildren, JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/invite-modal.css";
import { Dialog } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { InviteRecipient, ParsedRecipient } from "@projective/types/invites";
import {
	type InviteRoleOption,
	type InviteSeats,
	type InviteSendOutcome,
	type QueuedRecipient,
	seatCaption,
} from "../core/invite-queue.ts";
import type { AccessPerson } from "../core/access-people.ts";
import { InviteBar } from "./InviteBar.tsx";
import { type InviteLinkControl, InviteLinkRow } from "./InviteLinkRow.tsx";
import { InviteAccessList } from "./InviteAccessList.tsx";

/**
 * UniversalInviteModal — the one invite surface for a project, a team and a business (Decisions #318,
 * #405), laid out as an access list:
 *
 *   1. **Header** — "Invite to {name}" and, on a plan with a cap, "3 of 4 seats available" as meta.
 *   2. **Invite bar** ({@link InviteBar}) — the address field, the role and Invite: the region's one
 *      fill.
 *   3. **Link access** ({@link InviteLinkRow}) — the ask-to-join link's sentence and its switch.
 *   4. **People with access** ({@link InviteAccessList}) — the roster, each row's role, and remove
 *      where the surface allows it.
 *   5. **Footer** — Copy link (tier 4) while the link is on, and Done (tier 5).
 *
 * It never navigates: opening, inviting and closing all leave the viewer where they were. The surface
 * owns the transport (`onSend`), the link (`link`), who has access (`people`) and its own rules.
 */

// #region Props
export type InviteTargetType = "project" | "team" | "business";

export interface UniversalInviteModalProps {
	/** Open state — `Dialog` requires a Signal. */
	open: Signal<boolean>;
	targetType: InviteTargetType;
	targetId: string;
	/** The name in the header: "Invite to {targetName}". */
	targetName: string;
	/** Every role the viewer may offer, custom roles included — rendered as plain labels. */
	availableRoles: readonly InviteRoleOption[];
	/** The role the bar starts at; the first offered role when `null` or not on offer. */
	defaultRoleId: string | null;
	/** Called after the modal closes (Done, Escape or the mask). */
	onClose: () => void;
	/** Send one batch; answer which addresses were refused. */
	onSend: (recipients: InviteRecipient[]) => Promise<InviteSendOutcome>;
	/** Seats against the plan, or `null` when the surface has none. */
	seats?: InviteSeats | null;
	/** A surface refusal for one address ("Already a member"). */
	refuse?: (r: ParsedRecipient) => string | null;
	/** A refusal of the batch as typed (e.g. the manager cap for the role chosen), or `null`. */
	queueProblem?: (queue: readonly QueuedRecipient[]) => string | null;
	/** A reason nothing can be sent at all (no grantable role, a full plan), or `null`. */
	blocked?: string | null;
	/** Controls that scope the invitation, shown under the header (a project's stage picker). */
	scope?: ComponentChildren;
	/** The ask-to-join link, or `null` where the viewer cannot manage one. */
	link?: InviteLinkControl | null;
	/** Suggest people the viewer works with as they type. */
	suggest?: boolean;
	/** Handles never suggested (the roster, the entity's own). */
	excludeHandles?: ReadonlySet<string>;
	/** Who already has access. */
	people?: readonly AccessPerson[];
	/** Save a person's role; answers the refusal, or `null` once saved. */
	onRoleChange?: (key: string, roleId: string) => Promise<string | null>;
	/** Hand a removal to the surface, which confirms it in place of this modal. */
	onRemove?: (key: string) => void;
}
// #endregion

/** How long Copy link reads "Copied" before it returns. */
const COPIED_MS = 2000;

const TARGET_NOUN: Readonly<Record<InviteTargetType, string>> = {
	project: "project",
	team: "team",
	business: "business",
};

export function UniversalInviteModal(props: UniversalInviteModalProps): JSX.Element {
	// The body mounts on the first open and then stays, so the close transition keeps its content.
	const opened = useRef(false);
	if (props.open.value) opened.current = true;
	const bodyRef = useRef<HTMLDivElement>(null);
	const caption = seatCaption(props.seats);
	const url = props.link?.url ?? null;

	const copied = useSignal(false);
	const copyStatus = useSignal("");
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => () => {
		if (timer.current !== null) clearTimeout(timer.current);
	}, []);

	async function copy(): Promise<void> {
		if (!url) return;
		try {
			await navigator.clipboard.writeText(url);
			copied.value = true;
			copyStatus.value = "Link copied";
			if (timer.current !== null) clearTimeout(timer.current);
			timer.current = setTimeout(() => {
				copied.value = false;
				copyStatus.value = "";
				timer.current = null;
			}, COPIED_MS);
		} catch {
			copyStatus.value = `Couldn't copy — ${url}`;
		}
	}

	return (
		<Dialog
			visible={props.open}
			header={
				<span class="inv-modal__header">
					<span class="inv-modal__title">Invite to {props.targetName}</span>
					{caption && <span class="inv-modal__seats">{caption}</span>}
				</span>
			}
			modal
			width="var(--overlay-w-md)"
			class="inv-modal"
			initialFocusRef={bodyRef}
			onVisibleChange={(visible) => {
				if (!visible) props.onClose();
			}}
			footer={
				<div class="inv-modal__foot">
					{url && (
						<Button
							severity="neutral"
							variant="outlined"
							size="sm"
							label={copied.value ? "Copied" : "Copy link"}
							icon={<Icon name={copied.value ? "check" : "link"} size="sm" />}
							disabled={props.link?.busy}
							onClick={() => void copy()}
						/>
					)}
					<p class="inv-modal__copy-status" role="status" aria-live="polite">
						{copyStatus.value}
					</p>
					<Button
						variant="text"
						severity="secondary"
						size="sm"
						label="Done"
						onClick={() => (props.open.value = false)}
					/>
				</div>
			}
		>
			{opened.current && (
				<div class="inv-modal__body" ref={bodyRef}>
					{props.scope && <div class="inv-modal__scope">{props.scope}</div>}
					<InviteBar
						open={props.open}
						targetId={props.targetId}
						noun={TARGET_NOUN[props.targetType]}
						availableRoles={props.availableRoles}
						defaultRoleId={props.defaultRoleId}
						onSend={props.onSend}
						seats={props.seats}
						refuse={props.refuse}
						queueProblem={props.queueProblem}
						blocked={props.blocked}
						suggest={props.suggest}
						excludeHandles={props.excludeHandles}
					/>
					{props.link && <InviteLinkRow {...props.link} />}
					{props.people && (
						<InviteAccessList
							people={props.people}
							onRoleChange={props.onRoleChange}
							onRemove={props.onRemove}
						/>
					)}
				</div>
			)}
		</Dialog>
	);
}
