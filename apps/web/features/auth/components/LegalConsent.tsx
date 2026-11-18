import type { Signal } from "@preact/signals";
import type { JSX } from "preact";
import { Checkbox } from "@projective/ui/fields";

const CONSENT_ID = "join-accept-terms";
const CONSENT_ERROR_ID = "join-accept-terms-error";

function DocLink(props: { slug: string; children: string }): JSX.Element {
	return (
		<a class="auth-link" href={`/legal/${props.slug}`} target="_blank" rel="noopener noreferrer">
			{props.children}
		</a>
	);
}

/**
 * The consent box on the final step of every `/join` path (Decision #446): unticked, with the Terms,
 * the Acceptable Use Policy and the Privacy Policy linked beside it (each opens in a new tab, so the
 * wizard keeps its place). The sentence is the box's label, so a click on its text ticks it and a
 * click on a link only follows the link.
 */
export function LegalConsent(
	props: { value: Signal<boolean>; error?: string | null },
): JSX.Element {
	const invalid = Boolean(props.error);
	return (
		<div class="auth-consent">
			<div class="auth-consent__row">
				<Checkbox
					id={CONSENT_ID}
					value={props.value}
					status={invalid ? "invalid" : "default"}
					aria-describedby={invalid ? CONSENT_ERROR_ID : undefined}
					required
				/>
				<label class="auth-consent__text" for={CONSENT_ID}>
					I agree to the <DocLink slug="terms">Terms of Service</DocLink> and the{" "}
					<DocLink slug="acceptable-use">Acceptable Use Policy</DocLink>, and I have read the{" "}
					<DocLink slug="privacy">Privacy Policy</DocLink>.
				</label>
			</div>
			{invalid
				? <p id={CONSENT_ERROR_ID} class="auth-consent__error" role="alert">{props.error}</p>
				: null}
		</div>
	);
}
