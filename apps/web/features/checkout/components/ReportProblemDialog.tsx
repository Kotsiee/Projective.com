import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { Dialog, InlineNotice } from "@projective/ui/feedback";
import { Button, SelectButton, Textarea } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { OrderProblemReason } from "@projective/types/finance";

/**
 * ReportProblemDialog — a buyer's report on a downloaded digital product whose files didn't arrive whole
 * or are faulty, while its sale still clears (FBP DB21; Decision #337, ruling M8; DESIGN_SYSTEM §C.1).
 *
 * The order history's quiet "Report a problem" opens it where the server says a report is open
 * (`line.problem.canReport`). It asks what went wrong (a `SelectButton`, two answers) and what happened
 * (a `Textarea`), and says what sending does before it happens: the seller's earnings are held while
 * Projective reviews it, and an upheld report pays back the wallet that paid. "Send report" is the one
 * filled control: it opens a case and moves no money of the buyer's, so it is the primary fill, not the
 * amber of a money commit. A refusal is said inside the dialog. One dialog at a time.
 */

// #region Props
/** Props for {@link ReportProblemDialog}. */
export interface ReportProblemDialogProps {
	open: Signal<boolean>;
	/** The purchase's title, as the history names it. */
	title: string;
	/** Send the report. Resolves `null` once it is filed (the dialog closes), or the reader's sentence. */
	onSend: (reason: OrderProblemReason, statement: string) => Promise<string | null>;
}
// #endregion

const REASONS: ReadonlyArray<{ label: string; value: OrderProblemReason }> = [
	{ label: "The files didn't arrive", value: "not_delivered" },
	{ label: "The files are faulty", value: "defective" },
];

/** Report a downloaded product's problem. */
export function ReportProblemDialog(props: ReportProblemDialogProps): JSX.Element {
	const { open } = props;
	const reason = useSignal<string>("");
	const statement = useSignal("");
	const busy = useSignal(false);
	const error = useSignal<string | null>(null);
	const chosen = REASONS.find((r) => r.value === reason.value)?.value ?? null;
	const ready = chosen !== null && statement.value.trim().length > 0;

	const send = async () => {
		if (!chosen || !ready || busy.value) return;
		busy.value = true;
		error.value = null;
		const refusal = await props.onSend(chosen, statement.value.trim());
		busy.value = false;
		if (refusal) {
			error.value = refusal;
			return;
		}
		open.value = false;
	};

	const footer = (
		<div class="cko-problem__foot">
			<Button
				variant="text"
				label="Not now"
				disabled={busy.value}
				onClick={() => {
					open.value = false;
				}}
			/>
			<Button
				label={busy.value ? "Sending…" : "Send report"}
				loading={busy.value}
				disabled={!ready}
				onClick={() => void send()}
			/>
		</div>
	);

	return (
		<Dialog
			visible={open}
			modal
			header="Report a problem"
			footer={footer}
			width="var(--overlay-w-sm)"
			closable={!busy.value}
			closeOnEscape={!busy.value}
			dismissableMask={!busy.value}
		>
			<div class="cko-problem__body">
				<p class="cko-problem__lead">{props.title}</p>
				<SelectButton
					aria-label="What went wrong"
					options={REASONS.map((r) => ({ label: r.label, value: r.value }))}
					value={reason}
					disabled={busy.value}
				/>
				<Textarea
					value={statement}
					rows={3}
					autoResize
					maxRows={8}
					maxLength={4000}
					fluid
					disabled={busy.value}
					aria-label="What happened"
					placeholder="What you downloaded, and what's wrong with it."
				/>
				<p class="cko-problem__meta">
					The seller's earnings from this sale are held while Projective reviews your report. If
					it's upheld, what you paid comes back to the wallet that paid. A report can't be sent
					twice.
				</p>
				{error.value && (
					<InlineNotice
						align="start"
						icon={<Icon name="warning" />}
						text={error.value}
						assertive
					/>
				)}
			</div>
		</Dialog>
	);
}
