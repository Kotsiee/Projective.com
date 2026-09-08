import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Button, InputText, Select } from "@projective/ui/fields";
import { Dialog } from "@projective/ui/feedback";
import type { SubmissionTicketOption } from "../core/submission-model.ts";
import { PlusGlyph } from "./submission-glyphs.tsx";

/**
 * CreateSubmissionModal — the freelancer's "Create New Submission" surface (root task §4). Its shape
 * adapts to the engagement's delivery format:
 *
 * - **Pipeline / Session** (ticket-fulfilling): a **ticket dropdown** of the freelancer's open tickets in
 *   the stage (auto-selected when there is exactly one), pre-filling the submission name with the ticket
 *   title (still editable); revision tickets are tagged so a re-submission is tracked against them.
 * - **One-off** (no tickets): no dropdown — the name defaults to the stage / project name.
 *
 * STUB — shaping is real but persistence is deferred (the parent transitions to the in-progress draft
 * state).
 *
 * Built on the shared {@link Dialog}, which supplies the whole overlay contract — the unified
 * `Backdrop`, the modal z-band, the focus trap, Escape, and backdrop dismissal. That last one matters
 * more here than the others: the hand-rolled surface this replaced dismissed by catching a bubbled
 * click on its own root, so a pointer-drag that STARTED inside the name field and released over the
 * scrim still fired the root's handler and discarded the draft. `useDismiss` resolves containment
 * through the overlay registry instead, which also keeps a click on the portalled `Select` panel —
 * a DOM sibling of the dialog, not a descendant — from reading as an outside click.
 */
export interface CreateSubmissionPayload {
	name: string;
	ticketId: string | null;
	isRevision: boolean;
}

export interface CreateSubmissionModalProps {
	/** Visibility, owned by the caller (the shared overlay contract is signal-first). */
	open: Signal<boolean>;
	projectTitle: string;
	/** The active stage's name (channel scope = the channel; project scope = the navigated stage). */
	stageName: string | null;
	/** The freelancer's open tickets in the stage — empty for a one-off (no dropdown). */
	tickets: SubmissionTicketOption[];
	onClose: () => void;
	onCreate: (payload: CreateSubmissionPayload) => void;
}

const FORM_ID = "create-submission-form";
const TICKET_ID = "create-submission-ticket";
const NAME_ID = "create-submission-name";

export function CreateSubmissionModal(props: CreateSubmissionModalProps): JSX.Element {
	const { open, projectTitle, stageName, tickets, onClose, onCreate } = props;
	const nameRef = useRef<HTMLDivElement>(null);

	const hasTickets = tickets.length > 0;
	const defaultName = stageName ?? projectTitle;
	// Auto-select the ticket when there is exactly one assigned (root task §4).
	const ticketId = useSignal<string>(tickets.length === 1 ? tickets[0].id : "");
	const name = useSignal<string>("");

	// Reset on open; seed the name from the auto-selected ticket, else the stage/project name. Focus is
	// the Dialog's job (`initialFocusRef`), so this effect no longer moves it.
	useEffect(() => {
		if (!open.value) return;
		const initialTicket = tickets.length === 1 ? tickets[0].id : "";
		ticketId.value = initialTicket;
		const seed = initialTicket ? tickets.find((t) => t.id === initialTicket) : null;
		name.value = seed ? seed.title.replace(/^[A-Z]+-\d+\s·\s/, "") : defaultName;
	}, [open.value]);

	const selectedTicket = tickets.find((t) => t.id === ticketId.value) ?? null;

	function onTicketChange(id: string): void {
		ticketId.value = id;
		const t = tickets.find((x) => x.id === id);
		// Pre-fill the name with the ticket title (stripped of the code prefix), still editable.
		if (t) name.value = t.title.replace(/^[A-Z]+-\d+\s·\s/, "");
	}

	function submit(e: Event): void {
		e.preventDefault();
		const n = name.value.trim() || defaultName;
		onCreate({
			name: n,
			ticketId: ticketId.value || null,
			isRevision: selectedTicket?.kind === "revision",
		});
	}

	const ticketOptions = tickets.map((t) => ({ value: t.id, label: t.title }));

	return (
		<Dialog
			visible={open}
			class="subm-modal"
			header="New submission"
			width="min(28rem, 100%)"
			initialFocusRef={nameRef}
			onVisibleChange={(v) => !v && onClose()}
			footer={
				<div class="subm-modal__actions">
					<Button label="Cancel" variant="text" severity="secondary" onClick={onClose} />
					<Button
						type="submit"
						form={FORM_ID}
						label="Create submission"
						icon={<PlusGlyph size={16} />}
					/>
				</div>
			}
		>
			<p class="subm-modal__note">
				Start a new submission for{" "}
				<strong>{stageName ?? projectTitle}</strong>. You can add files and submit it for the
				client's review once it's ready.
			</p>

			<form id={FORM_ID} class="subm-modal__form" onSubmit={submit}>
				{hasTickets
					? (
						<div class="subm-modal__field">
							<label class="subm-modal__label" for={TICKET_ID}>Ticket</label>
							<Select
								id={TICKET_ID}
								options={ticketOptions}
								value={ticketId}
								onValueChange={onTicketChange}
								placeholder="Select a ticket…"
								fluid
							/>
							{selectedTicket?.kind === "revision"
								? (
									<span class="subm-modal__revtag" data-tone="danger">
										Revision — re-submitting against a returned ticket
									</span>
								)
								: null}
						</div>
					)
					: null}

				<div ref={nameRef} class="subm-modal__field">
					<label class="subm-modal__label" for={NAME_ID}>Submission name</label>
					<InputText
						id={NAME_ID}
						value={name}
						fluid
						placeholder={defaultName}
						maxLength={200}
					/>
				</div>
			</form>
		</Dialog>
	);
}
