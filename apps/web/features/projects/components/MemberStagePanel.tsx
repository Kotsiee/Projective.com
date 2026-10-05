import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Button, Checkbox } from "@projective/ui/fields";
import type {
	MemberInvite,
	MemberStagePicture,
	MemberStageRef,
	ProjectMemberRow,
} from "../types/projects-types.ts";
import { InviteStatusTag } from "./MemberBadges.tsx";

/**
 * MemberStagePanel — the member preview's Stages section for a managing viewer: the stages the member
 * holds (each removable behind the removal confirmation), their open stage invitations (each
 * cancellable), and a picker that invites them onto the stages they are not yet on. A seat is never
 * granted here — the freelancer accepts or declines each invitation (Decision #139).
 */
export interface MemberStagePanelProps {
	member: ProjectMemberRow;
	picture: MemberStagePicture;
	canInvite: boolean;
	canRemove: boolean;
	/** Invitation ids with a write in flight. */
	busy: ReadonlySet<string>;
	/** A stage invitation for this member is being sent. */
	sending: boolean;
	onInvite: (member: ProjectMemberRow, stageIds: string[]) => void;
	onCancel: (invite: MemberInvite) => void;
	onRemove: (member: ProjectMemberRow, stage: MemberStageRef) => void;
}

export function MemberStagePanel(props: MemberStagePanelProps): JSX.Element {
	const { member, picture } = props;
	const chosen = useSignal<ReadonlySet<string>>(new Set());

	useEffect(() => {
		chosen.value = new Set();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [member.id, picture.available.length]);

	function toggle(stageId: string, on: boolean): void {
		const next = new Set(chosen.value);
		if (on) next.add(stageId);
		else next.delete(stageId);
		chosen.value = next;
	}

	function send(): void {
		const ids = picture.available.map((s) => s.id).filter((id) => chosen.value.has(id));
		if (ids.length > 0) props.onInvite(member, ids);
	}

	const empty = picture.held.length === 0 && picture.pending.length === 0;
	const count = chosen.value.size;

	return (
		<section class="mem-preview__section mem-stagepanel" aria-label="Stages">
			<h3 class="mem-preview__label">Stages</h3>
			{empty
				? <p class="mem-stagepanel__empty">Not on any stage yet.</p>
				: (
					<ul class="mem-stagepanel__list">
						{picture.held.map((stage) => (
							<li class="mem-stagepanel__row" key={`held-${stage.id}`}>
								<span class="mem-stagepanel__name">{stage.name}</span>
								<span class="mem-stagepanel__state">Assigned</span>
								{props.canRemove && (
									<Button
										variant="text"
										severity="danger"
										size="sm"
										label="Remove"
										aria-label={`Remove ${member.party.name} from ${stage.name}`}
										onClick={() => props.onRemove(member, stage)}
									/>
								)}
							</li>
						))}
						{picture.pending.map(({ stage, invite }) => (
							<li class="mem-stagepanel__row" key={`inv-${invite.id}`}>
								<span class="mem-stagepanel__name">{stage.name}</span>
								<InviteStatusTag status="pending" />
								{props.canInvite && (
									<Button
										variant="text"
										severity="secondary"
										size="sm"
										label="Cancel invitation"
										aria-label={`Cancel the invitation to ${stage.name}`}
										disabled={props.busy.has(invite.id)}
										onClick={() => props.onCancel(invite)}
									/>
								)}
							</li>
						))}
					</ul>
				)}

			{props.canInvite && picture.available.length > 0 && (
				<fieldset class="mem-stagepanel__invite">
					<legend class="mem-stagepanel__legend">Invite to more stages</legend>
					<div class="mem-stagepanel__choices">
						{picture.available.map((stage) => (
							<Checkbox
								key={stage.id}
								label={stage.name}
								value={chosen.value.has(stage.id)}
								onValueChange={(on) => toggle(stage.id, on)}
							/>
						))}
					</div>
					<p class="mem-stagepanel__hint">
						{member.party.name} accepts or declines each stage at the price it is configured at.
					</p>
					<div class="mem-stagepanel__send">
						<Button
							variant="filled"
							size="sm"
							label={count > 1 ? `Send ${count} invitations` : "Send invitation"}
							disabled={count === 0}
							loading={props.sending}
							onClick={send}
						/>
					</div>
				</fieldset>
			)}
		</section>
	);
}
