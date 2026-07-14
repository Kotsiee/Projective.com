import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { AuthHeading } from "../components/AuthShell.tsx";
import { OtpField } from "../components/OtpField.tsx";
import { CheckIcon, WarnIcon } from "../components/icons.tsx";
import { useOtpInput } from "../hooks/useOtpInput.ts";
import { AuthService } from "../core/AuthService.ts";
import { safeRedirect } from "../core/redirect.ts";
import { readStored, removeStored, SessionKeys, writeStored } from "@web/utils/storage-keys.ts";

/** How often the verification-status listener polls while the user waits (ms). */
const POLL_INTERVAL_MS = 4000;
/** Resend throttle window (seconds). */
const RESEND_COOLDOWN_S = 30;

/**
 * VerifyForm — email confirmation with two parallel paths that share one screen:
 *
 *  1. **Passive auto-confirm (the "database listener").** On mount the island polls
 *     `/api/auth/verification-status`; when the account's `email_verified` flips (because the user
 *     clicked the magic link in their inbox, possibly on another device) the UI transitions to a
 *     success state and securely redirects them in — no manual refresh, no button.
 *  2. **Manual OTP entry.** The beautifully segmented 6-digit boxes auto-submit once complete for
 *     users who'd rather type the code than open the link.
 *
 * The pending email + resend cooldown persist to `sessionStorage` (see {@link SessionKeys}) so a hard
 * refresh doesn't lose the countdown or the address being confirmed.
 */
export default function VerifyForm({ redirectTo, email }: { redirectTo: string; email?: string }) {
	const otp = useOtpInput(6);
	const submitting = useSignal(false);
	const error = useSignal<string | null>(null);
	const cooldown = useSignal(0);
	const lastTried = useSignal("");
	/** Flipped by either path on success — freezes polling and shows the "you're in" transition. */
	const verified = useSignal(false);

	/** Kick off (or resume) the resend countdown to a given epoch-ms deadline, persisting it. */
	function startCooldown(deadline: number) {
		writeStored("session", SessionKeys.VERIFY_RESEND_DEADLINE, String(deadline));
		const tick = () => {
			const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
			cooldown.value = remaining;
			if (remaining <= 0) {
				clearInterval(id);
				removeStored("session", SessionKeys.VERIFY_RESEND_DEADLINE);
			}
		};
		const id = setInterval(tick, 1000);
		tick();
	}

	function succeed(dest: string) {
		verified.value = true;
		removeStored("session", SessionKeys.PENDING_VERIFICATION_EMAIL);
		removeStored("session", SessionKeys.VERIFY_RESEND_DEADLINE);
		// Brief, felt success beat before the redirect so the state change is legible.
		setTimeout(() => (globalThis.location.href = dest), 900);
	}

	async function verify(code: string) {
		submitting.value = true;
		error.value = null;
		const result = await AuthService.verify({ code, email, redirectTo });
		submitting.value = false;
		if (result.ok) {
			succeed(safeRedirect(result.redirectTo, redirectTo));
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
			code.length === 6 && /^\d{6}$/.test(code) && !submitting.value && !verified.value &&
			code !== lastTried.value
		) {
			lastTried.value = code;
			void verify(code);
		}
	});

	// #region Mount: restore persisted state + start the verification-status listener
	useEffect(() => {
		if (email) writeStored("session", SessionKeys.PENDING_VERIFICATION_EMAIL, email);

		// Resume a still-running resend cooldown after a refresh.
		const rawDeadline = readStored("session", SessionKeys.VERIFY_RESEND_DEADLINE);
		if (rawDeadline) {
			const deadline = Number(rawDeadline);
			if (Number.isFinite(deadline) && deadline > Date.now()) startCooldown(deadline);
		}

		// Poll the "database listener" — auto-confirm when the email is verified out-of-band.
		let stopped = false;
		const id = setInterval(async () => {
			if (stopped || verified.value || submitting.value) return;
			const result = await AuthService.verificationStatus({ email, redirectTo });
			if (result.ok && result.verified) {
				stopped = true;
				clearInterval(id);
				succeed(safeRedirect(result.redirectTo, redirectTo));
			}
		}, POLL_INTERVAL_MS);

		return () => {
			stopped = true;
			clearInterval(id);
		};
	}, []);
	// #endregion

	function resend() {
		if (cooldown.value > 0) return;
		void AuthService.resend({ email });
		startCooldown(Date.now() + RESEND_COOLDOWN_S * 1000);
	}

	if (verified.value) {
		return (
			<div class="auth-verified" role="status" aria-live="polite">
				<span class="auth-verified__badge">{CheckIcon()}</span>
				<h1 class="auth-heading__title">You're verified</h1>
				<p class="auth-heading__subtitle">Signing you in — just a moment…</p>
			</div>
		);
	}

	return (
		<>
			<AuthHeading
				title="Check your email"
				subtitle={email
					? (
						<>
							We sent a 6-digit code to{" "}
							<strong>{email}</strong>. Enter it below, or just tap the link in the email — this
							page will let you in automatically.
						</>
					)
					: "Enter the 6-digit code we emailed you, or tap the link in the email to confirm automatically."}
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
