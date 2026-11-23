import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import "../styles/session-disputes.css";
import { CommitReview } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { MoneyView } from "@projective/ui/display";
import type { SessionForfeit, SessionWorkspace } from "@projective/types/projects";
import { SessionService } from "../core/SessionService.ts";

/**
 * SessionForfeits — a session engagement's forfeits, in the host's sidebar under the no-show section
 * (FBP DB21; Decision #337, ruling M8; DESIGN_SYSTEM §C.1).
 *
 * A seat or sitting an attendee cancelled inside the notice paid its host in full. The host may give it
 * back: each forfeit is one row, its title and amount, and a quiet "Refund this forfeit" (tier 5) that
 * opens the package {@link CommitReview} (§B.8): the amount, where it goes and where it comes from, then
 * "Refund in full", its one tier-1 commit; a refusal is said inside the review. The server lists only what `finance.refund_session_forfeit` would accept, and after a refund the section
 * re-reads the workspace, so the list follows the act (§3 gate 11). Renders nothing for anyone but the
 * host, and when there is no forfeit.
 */
export interface SessionForfeitsProps {
	/** The viewer's workspace, after any dev preview. */
	workspace: SessionWorkspace;
	/** Surface the server's notice (the sidebar's toast). */
	onNotice: (message: string, severity: "success" | "error") => void;
}

export function SessionForfeits(props: SessionForfeitsProps): JSX.Element | null {
	const { onNotice } = props;
	// The server's list until a refund here re-reads it; a new workspace prop (a navigation) resets it.
	const local = useSignal<{ for: SessionWorkspace; forfeits: SessionForfeit[] } | null>(null);
	const target = useSignal<SessionForfeit | null>(null);
	const open = useSignal(false);

	const ws = props.workspace;
	const forfeits = local.value?.for === ws ? local.value.forfeits : ws.forfeits;
	if (ws.role !== "host" || forfeits.length === 0) return null;

	const confirm = async (): Promise<string | null> => {
		const forfeit = target.value;
		if (!forfeit) return null;
		const res = await SessionService.refundForfeit(forfeit.escrowId);
		if (!res.ok) return res.message ?? "That forfeit couldn't be refunded just now.";
		onNotice("Refunded in full. The attendee has been told.", "success");
		const again = await SessionService.workspace(ws.slug);
		local.value = {
			for: ws,
			forfeits: again.ok && again.data?.workspace
				? again.data.workspace.forfeits
				: forfeits.filter((f) => f.escrowId !== forfeit.escrowId),
		};
		return null;
	};

	return (
		<section class="sess-dispute" aria-labelledby="sess-forfeits-head">
			<h3 class="sess-dispute__label" id="sess-forfeits-head">Forfeited sessions</h3>
			<p class="sess-dispute__meta">
				These were cancelled inside the notice, so their payment came to you. You may give one back
				in full.
			</p>
			<ul class="sess-dispute__list">
				{forfeits.map((f) => (
					<li key={f.escrowId} class="sess-dispute__item">
						<span class="sess-dispute__line">{f.title}</span>
						<MoneyView value={f.amount} />
						<Button
							variant="text"
							label="Refund this forfeit"
							aria-label={`Refund this forfeit — ${f.title}`}
							onClick={() => {
								target.value = f;
								open.value = true;
							}}
						/>
					</li>
				))}
			</ul>

			{target.value
				? (
					<CommitReview
						visible={open}
						title="Refund this forfeit?"
						total={target.value.amount.display}
						rows={[
							{ label: "Session", value: target.value.title },
							{ label: "Goes to", value: "The attendee, fee included" },
							{ label: "Comes from", value: "Your money still clearing, then your wallet" },
						]}
						consequence="The attendee gets the whole price back and is told."
						commitLabel="Refund in full"
						cancelLabel="Keep it"
						onCommit={confirm}
					/>
				)
				: null}
		</section>
	);
}
