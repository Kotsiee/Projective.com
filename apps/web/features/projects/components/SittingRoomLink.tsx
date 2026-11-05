import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/session-disputes.css";
import { Button, InputText } from "@projective/ui/fields";
import type { SessionSitting, SessionWorkspace } from "@projective/types/projects";
import { checkJoinLink } from "@features/calendar/core/meeting-link.ts";
import { SessionService } from "../core/SessionService.ts";
import { disputeTimeLabel } from "../core/dispute-view.ts";

/**
 * SittingRoomLink — a host's way out when a paid sitting has no room (Decision #383, rulings R2 and
 * R7): connect an account, or add a link. The warning comes before the choice, because a link they add
 * keeps nobody out (Decision #392) and cannot report attendance, and the payout then waits for the
 * attendee to say the session happened.
 */
export interface SittingRoomLinkProps {
	workspace: SessionWorkspace;
	onNotice: (message: string, severity: "success" | "error") => void;
}

export function SittingRoomLink({ workspace, onNotice }: SittingRoomLinkProps): JSX.Element | null {
	const link = useSignal("");
	const busy = useSignal(false);
	/** The sitting this form has dealt with, so a refreshed workspace is not needed to clear it. */
	const added = useSignal<string | null>(null);

	const sitting: SessionSitting | null = workspace.roomWanted;
	if (!sitting || added.value === sitting.id) return null;
	const check = link.value.trim() ? checkJoinLink(link.value) : null;
	const refused = check && !check.ok ? check.message : null;

	async function save(id: string): Promise<void> {
		if (busy.value || !check?.ok) return;
		busy.value = true;
		const res = await SessionService.setRoomLink(id, link.value.trim());
		busy.value = false;
		onNotice(res.message ?? (res.ok ? "Link added." : "That link couldn't be saved."), res.ok ? "success" : "error");
		if (res.ok) added.value = id;
	}

	return (
		<section class="sess-dispute" aria-label="Meeting room">
			<span class="sess-dispute__label">Meeting room</span>
			<div class="sess-dispute__report">
				<p class="sess-dispute__line">{sitting.title} has no room yet</p>
				<p class="sess-dispute__meta">
					{disputeTimeLabel(sitting.startsAt)}. <a href="/settings/integrations">Connect an account</a>{" "}
					to have one created, or add your own link.
				</p>
				<p class="sess-dispute__meta">
					Anyone holding a link you add can join, paid or not. It also can't record attendance, so
					this session's payout is held until your attendee confirms it happened.
				</p>
				<InputText
					size="sm"
					value={link.value}
					maxLength={600}
					placeholder="https://…"
					aria-label="Meeting link"
					status={refused ? "invalid" : "default"}
					onValueChange={(value: string) => (link.value = value)}
				/>
				{refused ? <p class="sess-dispute__meta" role="alert">{refused}</p> : null}
				<Button
					label="Add link"
					severity="secondary"
					variant="outlined"
					size="sm"
					disabled={busy.value || !check?.ok}
					onClick={() => void save(sitting.id)}
				/>
			</div>
		</section>
	);
}
