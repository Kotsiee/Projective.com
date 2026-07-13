import type { JSX } from "preact";
import type { OtpInput } from "../hooks/useOtpInput.ts";

/**
 * OtpField — the segmented one-time-code entry (individual digit boxes). Renders one `<input>` per
 * digit wired to the {@link OtpInput} controller (auto-advance, backspace, paste). Grouped under a
 * labelled `role="group"` with per-box `aria-label`s for screen-reader navigation.
 */
export interface OtpFieldProps {
	otp: OtpInput;
	id?: string;
	label?: string;
	error?: string | null;
	invalid?: boolean;
}

export function OtpField(props: OtpFieldProps): JSX.Element {
	const { otp, id = "otp", label, error, invalid } = props;
	return (
		<div class="auth-otp-field">
			{label ? <span class="auth-otp__label" id={`${id}-label`}>{label}</span> : null}
			<div
				class={`auth-otp${invalid ? " is-invalid" : ""}`}
				role="group"
				aria-labelledby={label ? `${id}-label` : undefined}
				aria-label={label ? undefined : "Verification code"}
			>
				{Array.from({ length: otp.length }).map((_, i) => (
					<input
						key={i}
						ref={otp.setRef(i)}
						class="auth-otp__box"
						type="text"
						inputMode="numeric"
						pattern="[0-9]*"
						autoComplete={i === 0 ? "one-time-code" : "off"}
						maxLength={1}
						aria-label={`Digit ${i + 1}`}
						value={otp.digits.value[i]}
						onInput={otp.onInput(i)}
						onKeyDown={otp.onKeyDown(i)}
						onPaste={otp.onPaste}
					/>
				))}
			</div>
			{error ? <p class="auth-fielderror" role="alert">{error}</p> : null}
		</div>
	);
}
