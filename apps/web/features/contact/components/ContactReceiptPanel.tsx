import type { JSX, RefObject } from "preact";
import { useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { ContactIntent } from "@projective/types/contact";
import { INTENT_COPY, nextSteps, type ReceiptReply } from "../core/contact-copy.ts";

/**
 * ContactReceiptPanel — what replaces the form once a request is in (Decision #276): a check, the
 * reference in the mono face (with a Copy control that really copies it), what happens next for this
 * intent, and a way to send another. Unboxed — spacing and type separate it (§B.4). The heading is
 * the focus target when it appears, so a keyboard or screen-reader user lands on the outcome; the
 * same outcome is announced through the intake's live region independently of any motion. A plain
 * `div`: the intake's own region already takes this heading as its name, so a second region would
 * list the outcome twice in landmark navigation. A successful Copy is announced through the same
 * live region (a name change on the focused button is not re-read by every screen reader).
 */

/** Props for {@link ContactReceiptPanel}. */
export interface ContactReceiptPanelProps {
	reference: string;
	intent: ContactIntent;
	/** Where the answer goes — a known address, the one the sender gave, or nowhere (anonymous). */
	reply: ReceiptReply;
	/** Receives focus when the panel mounts. */
	headingRef: RefObject<HTMLHeadingElement>;
	/** Clear the form and start a new request. */
	onAnother: () => void;
	/** Say something through the intake's polite live region. */
	announce: (text: string) => void;
}

export function ContactReceiptPanel(props: ContactReceiptPanelProps): JSX.Element {
	const { reference, intent, reply, headingRef, onAnother, announce } = props;
	const copied = useSignal<"idle" | "copied" | "failed">("idle");

	async function copy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(reference);
			copied.value = "copied";
			announce(`Reference ${reference} copied.`);
		} catch {
			copied.value = "failed";
		}
	}

	return (
		<div class="ctc-receipt">
			<span class="ctc-receipt__mark" aria-hidden="true">
				<Icon name="success" size="xl" />
			</span>
			<h2 class="ctc-receipt__title" id="ctc-receipt-title" ref={headingRef} tabIndex={-1}>
				{INTENT_COPY[intent].label} request received
			</h2>
			<dl class="ctc-receipt__ref">
				<dt>Your reference</dt>
				<dd>
					<span class="ctc-receipt__code">{reference}</span>
					<Button
						type="button"
						severity="neutral"
						variant="outlined"
						size="sm"
						icon={<Icon name={copied.value === "copied" ? "check" : "copy"} />}
						label={copied.value === "copied" ? "Copied" : "Copy"}
						aria-label={copied.value === "copied"
							? `Copied ${reference}`
							: `Copy reference ${reference}`}
						onClick={copy}
					/>
				</dd>
			</dl>
			{copied.value === "failed" && (
				<p class="ctc-note" role="status">
					Copying isn't available here — select the reference to copy it.
				</p>
			)}
			<p class="ctc-receipt__steps-title" id="ctc-receipt-next">What happens next</p>
			<ol class="ctc-receipt__steps" aria-labelledby="ctc-receipt-next">
				{nextSteps(intent, reference, reply).map((step) => <li key={step}>{step}</li>)}
			</ol>
			<div class="ctc-receipt__actions">
				<Button
					type="button"
					severity="neutral"
					variant="outlined"
					label="Send another request"
					onClick={onAnother}
				/>
				<a class="ui-button ui-button--primary ui-button--link ui-button--size-md" href="/help">
					<span class="ui-button__label">Browse the help centre</span>
				</a>
			</div>
		</div>
	);
}
