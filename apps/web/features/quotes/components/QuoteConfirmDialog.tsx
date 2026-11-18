import type { JSX } from "preact";
import { type Signal, useSignal, useSignalEffect } from "@preact/signals";
import { Dialog } from "@projective/ui/feedback";
import { Button, FormControl, Textarea } from "@projective/ui/fields";
import { QUOTE_LIMITS } from "@projective/types/services";

/** What the dialog confirms. */
export interface QuoteConfirmation {
	title: string;
	body: string;
	confirmLabel: string;
	/** Offer the optional reason the other party reads (the host's decline). */
	withReason: boolean;
}

/** Props for {@link QuoteConfirmDialog}. */
export interface QuoteConfirmDialogProps {
	visible: Signal<boolean>;
	confirmation: QuoteConfirmation | null;
	busy: boolean;
	onConfirm: (reason: string | undefined) => void;
}

/** QuoteConfirmDialog — one confirmation before an act that closes an offer or a request for good. */
export function QuoteConfirmDialog(props: QuoteConfirmDialogProps): JSX.Element {
	const reason = useSignal("");
	useSignalEffect(() => {
		if (props.visible.value) reason.value = "";
	});
	const c = props.confirmation;

	return (
		<Dialog
			visible={props.visible}
			header={c?.title ?? ""}
			role="alertdialog"
			width="min(30rem, 94vw)"
			class="qte-confirm"
			footer={
				<div class="qte-offer__footer">
					<Button
						label="Keep it"
						severity="neutral"
						variant="outlined"
						onClick={() => (props.visible.value = false)}
					/>
					<Button
						label={c?.confirmLabel ?? "Confirm"}
						severity="danger"
						aria-busy={props.busy}
						onClick={() => {
							if (!props.busy) props.onConfirm(reason.value.trim() || undefined);
						}}
					/>
				</div>
			}
		>
			<div class="qte-offer__body">
				<p class="qte-confirm__text">{c?.body}</p>
				{c?.withReason && (
					<FormControl label="Reason (optional)" hint="The buyer reads it with the decline.">
						{({ id, describedBy }) => (
							<Textarea
								id={id}
								aria-describedby={describedBy}
								value={reason}
								rows={3}
								maxLength={QUOTE_LIMITS.declineReasonMax}
								fluid
							/>
						)}
					</FormControl>
				)}
			</div>
		</Dialog>
	);
}
