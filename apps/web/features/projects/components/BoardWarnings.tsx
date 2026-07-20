import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { ConfirmDialog } from "@projective/ui/feedback";
import { WarningIcon } from "./board-glyphs.tsx";

/**
 * BoardWarnings — the confirmation/warning modal for a consequential board action, built on the shared
 * `@projective/ui/feedback` {@link ConfirmDialog}. It surfaces the three pre-move confirmations the
 * business rules require (PRODUCT_SPEC §Stage Management / §Escrow Lifecycle / §Deliverable-Based
 * Workflow), each an irreversible side-effect the client is confirming BEFORE the board commits:
 *  - **reorder** — reordering a stage column changes the workflow sequence.
 *  - **claimed** — moving a claimed ticket incurs the full stage charge / releases escrow.
 *  - **revision** — moving a ticket into a completed stage converts it to an active revision ticket.
 */
export type BoardWarningKind = "reorder" | "claimed" | "revision";

export interface BoardWarning {
	kind: BoardWarningKind;
	/** A short subject for the message (the stage or ticket name). */
	label: string;
}

export interface BoardWarningsProps {
	/** Controlled visibility (a raw boolean would leave `ConfirmDialog` uncontrolled — ignored after mount). */
	visible: Signal<boolean>;
	warning: BoardWarning | null;
	/** Confirm — the parent applies the pending move. */
	onAccept: () => void;
	/** Cancel — the parent discards the pending move (the board is controlled, so the card snaps back). */
	onCancel: () => void;
}

interface Copy {
	header: string;
	message: (label: string) => string;
	accept: string;
	severity: "warning" | "danger";
}

const COPY: Record<BoardWarningKind, Copy> = {
	reorder: {
		header: "Reorder this stage?",
		message: (label) =>
			`Moving “${label}” changes the workflow execution sequence for this project. The tickets inside each stage keep their order, but the stage order — and its start dependencies — will change.`,
		accept: "Reorder stage",
		severity: "warning",
	},
	claimed: {
		header: "Move a claimed ticket?",
		message: (label) =>
			`A freelancer has already claimed “${label}”, so its escrow is held. Moving it will incur the full stage charge and release the stage's escrow payout. This can't be undone.`,
		accept: "Move & settle escrow",
		severity: "danger",
	},
	revision: {
		header: "Create a revision ticket?",
		message: (label) =>
			`“${label}” is moving back into a stage that was already completed. This re-opens the stage and converts the ticket into an active revision ticket that a freelancer can claim.`,
		accept: "Request revision",
		severity: "warning",
	},
};

export function BoardWarnings(
	{ visible, warning, onAccept, onCancel }: BoardWarningsProps,
): JSX.Element {
	const copy = warning ? COPY[warning.kind] : null;
	return (
		<ConfirmDialog
			visible={visible}
			header={copy?.header ?? ""}
			message={copy && warning ? copy.message(warning.label) : ""}
			icon={<WarningIcon size={22} />}
			acceptLabel={copy?.accept ?? "Continue"}
			rejectLabel="Cancel"
			acceptSeverity={copy?.severity ?? "warning"}
			onAccept={onAccept}
			onReject={onCancel}
		/>
	);
}
