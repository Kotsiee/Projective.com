import { useSignal, useSignalEffect } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { AuthHeading } from "../components/AuthShell.tsx";
import { OtpField } from "../components/OtpField.tsx";
import { WarnIcon } from "../components/icons.tsx";
import { useOtpInput } from "../hooks/useOtpInput.ts";
import { postAuth } from "../core/api.ts";
import { safeRedirect } from "../core/redirect.ts";

/**
 * VerifyForm — email confirmation via a 6-digit code entered in individual digit boxes. The code
 * auto-submits once complete; a resend control is throttled by a countdown. On success the user is
 * returned to wherever they started (`redirectTo`).
 *
 * Production note: the real flow (SYSTEM_ARCHITECTURE.md §Authentication) also lets the emailed
 * magic-link confirm out-of-band — that path advances `verified_at` and the page would additionally
 * poll `api/v1/auth/verification-status`. This MVP island implements the code-entry path; the poll
 * hooks in alongside once the endpoint is live.
 */
export default function VerifyForm({ redirectTo, email }: { redirectTo: string; email?: string }) {
	const otp = useOtpInput(6);
	const submitting = useSignal(false);
	const error = useSignal<string | null>(null);
	const cooldown = useSignal(0);
	const lastTried = useSignal("");

	async function verify(code: string) {
		submitting.value = true;
		error.value = null;
		const result = await postAuth("/api/auth/verify", { code, email, redirectTo });
		submitting.value = false;
		if (result.ok) {
			globalThis.location.href = safeRedirect(result.redirectTo, redirectTo);
			return;
		}
		error.value = result.message ?? "That code didn't match. Check the digits and try again.";
		otp.reset();
		lastTried.value = "";
	}

	// Auto-submit once six digits are present (reads the digits signal ⇒ reactive).
	useSignalEffect(() => {
		const code = otp.digits.value.join("");
		if (
			code.length === 6 && /^\d{6}$/.test(code) && !submitting.value && code !== lastTried.value
		) {
			lastTried.value = code;
			void verify(code);
		}
	});

	function resend() {
		if (cooldown.value > 0) return;
		void postAuth("/api/auth/resend", { email });
		cooldown.value = 30;
		const id = setInterval(() => {
			cooldown.value -= 1;
			if (cooldown.value <= 0) clearInterval(id);
		}, 1000);
	}

	return (
		<>
			<AuthHeading
				title="Check your email"
				subtitle={email
					? (
						<>
							We sent a 6-digit code to <strong>{email}</strong>. Enter it below to continue.
						</>
					)
					: "Enter the 6-digit code we emailed you to confirm your account."}
			/>

			{error.value
				? (
					<div class="auth-banner auth-banner--error" role="alert">
						<span class="auth-banner__icon">{WarnIcon()}</span>
						<span>{error.value}</span>
					</div>
				)
				: null}

			<form onSubmit={(e) => e.preventDefault()} noValidate>
				<OtpField otp={otp} label="Verification code" invalid={!!error.value} />

				<Button
					type="button"
					label={submitting.value ? "Verifying…" : "Verify"}
					fluid
					loading={submitting.value}
					disabled={!otp.complete}
					onClick={() => otp.complete && verify(otp.value)}
				/>
			</form>

			<p class="auth-resend">
				Didn't get it?{" "}
				<button
					type="button"
					class="auth-resend__btn"
					disabled={cooldown.value > 0}
					onClick={resend}
				>
					{cooldown.value > 0 ? `Resend in ${cooldown.value}s` : "Resend code"}
				</button>
			</p>

			<p class="auth-alt">
				Wrong address? <a class="auth-link" href="/join">Start over</a>
			</p>
		</>
	);
}
