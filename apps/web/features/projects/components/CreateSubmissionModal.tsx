import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { BodyPortal } from "@projective/ui/overlay";
import { Select } from "@projective/ui/fields";
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
 * state). Rendered through {@link BodyPortal} so its `position: fixed` never re-bases onto the blurred
 * shell chrome (the glass-blur trap); Escape + backdrop dismiss, focus moves in on open.
 */
export interface CreateSubmissionPayload {
	name: string;
	ticketId: string | null;
	isRevision: boolean;
}

export interface CreateSubmissionModalProps {
	open: boolean;
	projectTitle: string;
	/** The active stage's name (channel scope = the channel; project scope = the navigated stage). */
	stageName: string | null;
	/** The freelancer's open tickets in the stage — empty for a one-off (no dropdown). */
	tickets: SubmissionTicketOption[];
	onClose: () => void;
	onCreate: (payload: CreateSubmissionPayload) => void;
}

export function CreateSubmissionModal(props: CreateSubmissionModalProps): JSX.Element | null {
	const { open, projectTitle, stageName, tickets, onClose, onCreate } = props;
	const nameRef = useRef<HTMLInputElement>(null);

	const hasTickets = tickets.length > 0;
	const defaultName = stageName ?? projectTitle;
	// Auto-select the ticket when there is exactly one assigned (root task §4).
	const ticketId = useSignal<string>(tickets.length === 1 ? tickets[0].id : "");
	const name = useSignal<string>("");

	// Reset on open; seed the name from the auto-selected ticket, else the stage/project name.
	useEffect(() => {
		if (!open) return;
		const initialTicket = tickets.length === 1 ? tickets[0].id : "";
		ticketId.value = initialTicket;
		const seed = initialTicket ? tickets.find((t) => t.id === initialTicket) : null;
		name.value = seed ? seed.title.replace(/^[A-Z]+-\d+\s·\s/, "") : defaultName;
		nameRef.current?.focus();
		function onKey(e: KeyboardEvent): void {
			if (e.key === "Escape") onClose();
		}
		globalThis.addEventListener?.("keydown", onKey);
		return () => globalThis.removeEventListener?.("keydown", onKey);
	}, [open]);

	if (!open) return null;

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
		<BodyPortal>
			<div class="subm-modal" role="presentation" onClick={onClose}>
				<div
					class="subm-modal__panel"
					role="dialog"
					aria-modal="true"
					aria-labelledby="create-subm-title"
					onClick={(e) => e.stopPropagation()}
				>
					<h2 id="create-subm-title" class="subm-modal__title">New submission</h2>
					<p class="subm-modal__note">
						Start a new submission for{" "}
						<strong>{stageName ?? projectTitle}</strong>. You can add files and submit it for the
						client's review once it's ready.
					</p>

					<form class="subm-modal__form" onSubmit={submit}>
						{hasTickets
							? (
								<label class="subm-modal__field">
									<span class="subm-modal__label">Ticket</span>
									<Select
										options={ticketOptions}
										value={ticketId}
										onValueChange={onTicketChange}
										placeholder="Select a ticket…"
										aria-label="Ticket"
									/>
									{selectedTicket?.kind === "revision"
										? (
											<span class="subm-modal__revtag" data-tone="danger">
												Revision — re-submitting against a returned ticket
											</span>
										)
										: null}
								</label>
							)
							: null}

						<label class="subm-modal__field">
							<span class="subm-modal__label">Submission name</span>
							<input
								ref={nameRef}
								type="text"
								class="subm-modal__input"
								placeholder={defaultName}
								maxLength={200}
								value={name.value}
								onInput={(e) => (name.value = (e.target as HTMLInputElement).value)}
							/>
						</label>

						<div class="subm-modal__actions">
							<button
								type="button"
								class="subm-actions__btn subm-actions__btn--soft"
								onClick={onClose}
							>
								Cancel
							</button>
							<button type="submit" class="subm-actions__btn subm-actions__btn--primary">
								<span class="subm-actions__icon" aria-hidden="true">
									<PlusGlyph size={16} />
								</span>
								Create submission
							</button>
						</div>
					</form>
				</div>
			</div>
		</BodyPortal>
	);
}
