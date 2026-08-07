import type { JSX } from "preact";
import { destinationEmail } from "@projective/types/finance";
import { InputText } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { LineSignals } from "../core/basket-lines.ts";
import type { BasketItem } from "../types/checkout-types.ts";

/**
 * EmailAssignment — the delivery address a digital deliverable is sent to, collected on its own row.
 *
 * Three details here are requirements rather than choices, and each is a bug this codebase has shipped
 * before:
 *
 * 1. **The label is visible and bound by `id`.** An `aria-label` over a visible label replaces the
 *    accessible name with a string that does not match the words on screen, which breaks speech
 *    control (WCAG 2.5.3 "label in name") — `CatalogueCreateModal` shipped exactly that.
 * 2. **Nothing is painted invalid before the reader has had a turn.** `status="invalid"` — and
 *    therefore `aria-invalid` — appears only after the field has been touched AND has failed to parse.
 *    `status="required"` is deliberately never used: it also sets `aria-invalid`, so a merely-empty
 *    field would announce itself as wrong before anything had been typed.
 * 3. **The error is announced, and the hint is not.** The error carries `role="alert"` because it
 *    appears in response to something the reader just did; the outstanding-address hint is present on
 *    first paint, so it is described rather than announced.
 *
 * The verdict comes from the SSOT's own {@link destinationEmail} schema — the same rule the write
 * endpoint validates against — so the field cannot accept something the server will refuse, or refuse
 * something it would have taken.
 */

// #region Props
/** Props for {@link EmailAssignment}. */
export interface EmailAssignmentProps {
	/** The line whose deliverable needs an address. */
	item: BasketItem;
	/** The line's controlled bindings. */
	signals: LineSignals;
	/** Whether a write is in flight for this line. */
	busy: boolean;
	/** Commit a parsed, changed address. Never called with a value the SSOT would refuse. */
	onCommit: (item: BasketItem, address: string) => void;
}
// #endregion

export function EmailAssignment(props: EmailAssignmentProps): JSX.Element {
	const { item, signals, busy, onCommit } = props;

	const fieldId = `bsk-email-${item.id}`;
	const noteId = `${fieldId}-note`;

	const raw = signals.email.value;
	const touched = signals.emailTouched.value;
	const parsed = destinationEmail.safeParse(raw);
	const failed = touched && raw.trim() !== "" && !parsed.success;
	const outstanding = !touched && item.destinationEmail === null;

	const message = failed
		? (parsed.success ? "" : parsed.error.issues[0]?.message ?? "Enter a valid email address.")
		: null;

	/**
	 * Commit on blur rather than on every keystroke: a half-typed address is not a value the basket
	 * should be told about, and a per-keystroke write would put N requests in flight for one address.
	 */
	const commit = () => {
		const next = destinationEmail.safeParse(signals.email.value);
		if (!next.success) return;
		if (next.data === item.destinationEmail) {
			signals.emailTouched.value = false;
			return;
		}
		onCommit(item, next.data);
	};

	return (
		<div class="bsk-email">
			<label class="bsk-email__label" for={fieldId}>Send this download to</label>
			<InputText
				id={fieldId}
				type="email"
				size="sm"
				fluid
				autoComplete="email"
				placeholder="name@example.com"
				value={signals.email}
				disabled={busy}
				status={failed ? "invalid" : "default"}
				aria-describedby={noteId}
				onValueChange={() => {
					signals.emailTouched.value = true;
				}}
				onBlur={commit}
			/>
			{failed
				? (
					<p class="bsk-email__note bsk-email__note--error" id={noteId} role="alert">
						<Icon name="error" size="xs" />
						{message}
					</p>
				)
				: (
					<p
						class="bsk-email__note"
						id={noteId}
						data-outstanding={outstanding ? "true" : undefined}
					>
						{outstanding
							? (
								<>
									<Icon name="warning" size="xs" />
									No address yet — this line cannot be paid for until one is set.
								</>
							)
							: "Change it any time before you pay."}
					</p>
				)}
		</div>
	);
}
