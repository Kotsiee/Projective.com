import type { JSX } from "preact";
import { type Signal, useSignal } from "@preact/signals";
import { Dialog, InlineNotice } from "@projective/ui/feedback";
import { Button, FormControl, Textarea } from "@projective/ui/fields";
import { MetaLine } from "@projective/ui/display";
import { Icon } from "@projective/ui/icons";
import { approverList } from "@features/workspaces/core/refusal-copy.ts";
import type { MoneyView } from "../types/checkout-types.ts";

/**
 * RequestApprovalDialog — the checkout's "Request approval" (BP2, Decision #243): say what the order
 * is for, and file a request bound to this basket.
 *
 * The amount shown is the one the server will file — the charge in the listings' own currency, which
 * is the business wallet's — and is never sent from here: the route computes it from the lines. The
 * reason is what the approver reads in their queue and their notification, 1–400 characters as
 * `finance.request_spend_approval` bounds it.
 *
 * "Send request" is a workflow commit that moves no money, so it is tier 3 (`severity="primary"`), as
 * an approver's Approve is (#225 (A)); the checkout's amber stays on Buy Now.
 */

// #region Props
/** Props for {@link RequestApprovalDialog}. */
export interface RequestApprovalDialogProps {
	/** Controlled visibility (the modal contract: a Signal). */
	open: Signal<boolean>;
	/** What the request will be filed for — the server's figure. */
	amount: MoneyView;
	/** How many lines the order covers. A count, never money. */
	lineCount: number;
	/** The business paying. */
	business: string;
	/** Who can approve, owner first. */
	approvers: readonly string[];
	/** Whether the request is in flight. */
	busy: boolean;
	/** The server's refusal of the REASON — the field's own error; `null` when it took the reason. */
	fieldError: string | null;
	/**
	 * Any other refusal of the request — the basket changed, another member's request is waiting —
	 * said for the whole form, so the reason field is never marked invalid for it.
	 */
	formError: string | null;
	/** File the request with this reason. */
	onSubmit: (reason: string) => void;
}
// #endregion

const MAX_REASON = 400;

/** Ask for approval, with a reason. */
export function RequestApprovalDialog(props: RequestApprovalDialogProps): JSX.Element {
	const { open, amount, lineCount, business, busy, fieldError, formError } = props;
	const reason = useSignal("");
	const who = approverList(props.approvers);
	const ready = reason.value.trim().length > 0 && reason.value.trim().length <= MAX_REASON;

	const send = () => {
		if (!ready || busy) return;
		props.onSubmit(reason.value.trim());
	};

	const footer = (
		<div class="cko-approve__foot">
			<Button
				variant="text"
				label="Cancel"
				disabled={busy}
				onClick={() => {
					open.value = false;
				}}
			/>
			<Button
				severity="primary"
				variant="filled"
				icon={<Icon name="send" />}
				label={busy ? "Sending…" : "Send request"}
				loading={busy}
				disabled={!ready}
				onClick={send}
			/>
		</div>
	);

	return (
		<Dialog
			visible={open}
			modal
			class="cko-approve"
			header="Request approval"
			footer={footer}
			width="var(--overlay-w-sm)"
			closable={!busy}
			closeOnEscape={!busy}
			dismissableMask={!busy}
		>
			<div class="cko-approve__body">
				<MetaLine
					items={[
						{ text: amount.display, tabular: true },
						{ text: `${lineCount} ${lineCount === 1 ? "item" : "items"}`, tabular: true },
						`Paid by ${business}`,
					]}
				/>
				<p class="cko-approve__lead">
					{who ? `Tell ${who} what this order is for.` : "Say what this order is for."}{" "}
					Once it's approved, placing the order uses the approval, once.
				</p>
				{formError && (
					<InlineNotice
						class="cko-approve__error"
						align="start"
						icon={<Icon name="warning" />}
						text={formError}
						assertive
					/>
				)}
				<FormControl
					label="What it's for"
					hint={`Up to ${MAX_REASON} characters.`}
					status={fieldError ? "invalid" : "default"}
					error={fieldError ?? undefined}
					required
				>
					{({ id, describedBy, status, required }) => (
						<Textarea
							id={id}
							aria-describedby={describedBy}
							status={status}
							required={required}
							value={reason}
							maxLength={MAX_REASON}
							rows={3}
							autoResize
							maxRows={8}
							fluid
						/>
					)}
				</FormControl>
			</div>
		</Dialog>
	);
}
