import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import "../styles/pin-picker.css";
import { Dialog, Message } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import type { PinCandidate } from "../types/projects-types.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * AssignTicketDialog — the client's "Assign to…" picker on a manual stage's ticket (PROJECTS ST3,
 * Decision #547). It lists the stage's live-seat holders, the only people a pin can name, each with
 * the $W_i$ they already hold on the stage; one whose load plus this ticket's would pass the stage
 * cap reads why and cannot be picked (the global cap is the door's to answer). A pick pins the ticket
 * and holds nothing: the freelancer is told and accepts it by claiming, or declines. A refusal stays
 * in the dialog beside the rows.
 */
export interface AssignTicketDialogProps {
	/** Visibility, owned by the board (the overlay contract is signal-first). */
	visible: Signal<boolean>;
	/** The ticket's title, or `null` while closed. */
	title: string | null;
	/** The stage's live-seat holders (`BoardStageRef.pinnable`). */
	candidates: readonly PinCandidate[];
	/** The stage's per-freelancer cap on summed $W_i$, or `null` for none. */
	cap: number | null;
	/** This ticket's $W_i$. */
	workload: number;
	/** Who the ticket is pinned to now, by name, or `null`. */
	pinnedName: string | null;
	/** The candidate a pin is being written for, while it is in flight. */
	busyId: string | null;
	/** The server's refusal of the last pick, or `null`. */
	error: string | null;
	onPick: (userId: string) => void;
}

/** "W 2", "W 1.5": a load figure as the inspector writes it. */
function w(n: number): string {
	return `W ${Number(n.toFixed(2))}`;
}

export function AssignTicketDialog(props: AssignTicketDialogProps): JSX.Element {
	const { candidates, cap, workload, busyId } = props;
	return (
		<Dialog
			visible={props.visible}
			header="Assign to…"
			class="pin-pick"
			width="28rem"
			footer={
				<Button
					label="Cancel"
					severity="secondary"
					variant="text"
					onClick={() => (props.visible.value = false)}
				/>
			}
		>
			<div class="pin-pick__body">
				<p class="pin-pick__lede">
					{props.title ? <strong>{props.title}</strong> : "This ticket"}{" "}
					goes to the person you pick once they accept it. Nothing is held until then.
					{props.pinnedName ? ` It is assigned to ${props.pinnedName} now.` : ""}
				</p>
				{candidates.length === 0
					? (
						<p class="pin-pick__meta">
							Nobody holds a seat on this stage yet. Invite a freelancer to it first.
						</p>
					)
					: (
						<ul class="pin-pick__list">
							{candidates.map((c) => {
								const over = cap !== null && c.load + workload > cap;
								return (
									<li key={c.userId}>
										<button
											type="button"
											class="pin-pick__row"
											disabled={over || busyId !== null}
											aria-busy={busyId === c.userId || undefined}
											onClick={() => props.onPick(c.userId)}
										>
											<UserAvatar
												image={c.party.avatar ?? undefined}
												label={c.party.name}
												size={32}
											/>
											<span class="pin-pick__who">
												<span class="pin-pick__name">{c.party.name}</span>
												<span class="pin-pick__load">
													{cap === null
														? `Holds ${w(c.load)} here`
														: `Holds ${w(c.load)} of ${w(cap)} here`}
													{over ? " · this ticket would pass the stage cap" : ""}
												</span>
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					)}
				{props.error
					? <Message severity="danger" variant="subtle" size="sm">{props.error}</Message>
					: null}
			</div>
		</Dialog>
	);
}
