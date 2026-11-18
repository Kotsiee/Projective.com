import { useSignal } from "@preact/signals";
import { Button, FormControl, InputText, Password } from "@projective/ui/fields";
import { AuthHeading } from "../components/AuthShell.tsx";
import { OtpField } from "../components/OtpField.tsx";
import { CheckIcon, WarnIcon } from "../components/icons.tsx";
import { CaptchaField } from "../components/CaptchaField.tsx";
import { useOtpInput } from "../hooks/useOtpInput.ts";
import { useCaptcha } from "../hooks/useCaptcha.ts";
import { confirmError, emailError, passwordError } from "../core/validate.ts";
import { AuthService } from "../core/AuthService.ts";
import { withRedirect } from "../core/redirect.ts";

/**
 * ForgotPasswordForm — two-step recovery on the soft auth surface. Step 1 requests a reset code by
 * email (the server responds identically whether or not the account exists, to avoid enumeration).
 * Step 2 takes the 6-digit code plus a new password, then returns the user to sign in with the
 * original return path preserved. `codeSent` (the recovery email's button) opens straight on step 2;
 * the link never carries the address, so that step asks for it whenever this page didn't send the
 * code itself. Step 1 carries the Turnstile token GoTrue's recovery endpoint requires (Decision #447).
 */
export default function ForgotPasswordForm(
	{ redirectTo, codeSent = false, captchaSiteKey = null }: {
		redirectTo: string;
		codeSent?: boolean;
		captchaSiteKey?: string | null;
	},
) {
	const captcha = useCaptcha();
	const step = useSignal<"request" | "reset">(codeSent ? "reset" : "request");
	const email = useSignal("");
	const sentTo = useSignal("");
	const otp = useOtpInput(6);
	const password = useSignal("");
	const confirm = useSignal("");
	const submitting = useSignal(false);
	const formError = useSignal<string | null>(null);
	const errors = useSignal<Record<string, string | null>>({});

	async function requestCode(e: Event) {
		e.preventDefault();
		formError.value = null;
		const emailErr = emailError(email.value);
		errors.value = { email: emailErr };
		if (emailErr) return;

		submitting.value = true;
		const captchaToken = await captcha.take();
		const result = await AuthService.forgotPassword({
			email: email.value.trim(),
			redirectTo,
			captchaToken,
		});
		captcha.reset();
		submitting.value = false;
		if (!result.ok) {
			formError.value = result.message ?? "Something went wrong. Please try again.";
			return;
		}
		sentTo.value = email.value.trim();
		step.value = "reset";
	}

	async function resetPassword(e: Event) {
		e.preventDefault();
		formError.value = null;
		const address = sentTo.value || email.value.trim();
		const next = {
			email: sentTo.value ? null : emailError(email.value),
			code: otp.complete ? null : "Enter the 6-digit code.",
			password: passwordError(password.value),
			confirm: confirmError(password.value, confirm.value),
		};
		errors.value = next;
		if (next.email || next.code || next.password || next.confirm) return;

		submitting.value = true;
		const result = await AuthService.resetPassword({
			email: address,
			code: otp.value,
			password: password.value,
			redirectTo,
		});
		submitting.value = false;
		if (!result.ok) {
			if (result.errors) errors.value = { ...errors.value, ...result.errors };
			formError.value = result.message ?? "That code didn't match or has expired.";
			otp.reset();
			return;
		}
		globalThis.location.href = withRedirect("/login?notice=reset", redirectTo);
	}

	const emailField = (
		<div class="auth-field-row">
			<FormControl
				label="Email"
				error={errors.value.email ?? undefined}
				status={errors.value.email ? "invalid" : "default"}
			>
				{({ id, describedBy }) => (
					<InputText
						id={id}
						aria-describedby={describedBy}
						value={email}
						type="email"
						placeholder="you@example.com"
						autoComplete="email"
						status={errors.value.email ? "invalid" : "default"}
						variant="filled"
						fluid
					/>
				)}
			</FormControl>
		</div>
	);

	if (step.value === "reset") {
		const held = sentTo.value;
		return (
			<>
				<AuthHeading
					title="Set a new password"
					subtitle={held
						? (
							<>
								Enter the code we emailed to <strong>{held}</strong> and choose a new password.
							</>
						)
						: "Enter your email, the code we sent to it and a new password."}
				/>

				{formError.value
					? (
						<div class="auth-banner auth-banner--error" role="alert">
							<span class="auth-banner__icon">{WarnIcon()}</span>
							<span>{formError.value}</span>
						</div>
					)
					: held
					? (
						<div class="auth-banner auth-banner--success" role="status">
							<span class="auth-banner__icon">{CheckIcon()}</span>
							<span>If an account exists for that email, a 6-digit code is on its way.</span>
						</div>
					)
					: null}

				<form onSubmit={resetPassword} noValidate>
					{held ? null : emailField}
					<OtpField
						otp={otp}
						label="Reset code"
						error={errors.value.code}
						invalid={!!errors.value.code}
					/>
					<div class="auth-field-row">
						<FormControl
							label="New password"
							error={errors.value.password ?? undefined}
							status={errors.value.password ? "invalid" : "default"}
							required
						>
							{({ id, describedBy }) => (
								<Password
									id={id}
									aria-describedby={describedBy}
									value={password}
									toggleMask
									feedback
									autoComplete="new-password"
									status={errors.value.password ? "invalid" : "default"}
									variant="filled"
									fluid
								/>
							)}
						</FormControl>
					</div>
					<div class="auth-field-row">
						<FormControl
							label="Confirm new password"
							error={errors.value.confirm ?? undefined}
							status={errors.value.confirm ? "invalid" : "default"}
							required
						>
							{({ id, describedBy }) => (
								<Password
									id={id}
									aria-describedby={describedBy}
									value={confirm}
									toggleMask
									autoComplete="new-password"
									status={errors.value.confirm ? "invalid" : "default"}
									variant="filled"
									fluid
								/>
							)}
						</FormControl>
					</div>
					<Button
						type="submit"
						label={submitting.value ? "Updating…" : "Update password"}
						loading={submitting.value}
						fluid
					/>
				</form>

				<p class="auth-alt">
					<button
						type="button"
						class="auth-skip"
						onClick={() => {
							step.value = "request";
							formError.value = null;
							errors.value = {};
						}}
					>
						{held ? "Use a different email" : "Send me a new code"}
					</button>
				</p>
			</>
		);
	}

	return (
		<>
			<AuthHeading
				title="Reset your password"
				subtitle="Enter your email and we'll send a 6-digit code to reset it."
			/>

			{formError.value
				? (
					<div class="auth-banner auth-banner--error" role="alert">
						<span class="auth-banner__icon">{WarnIcon()}</span>
						<span>{formError.value}</span>
					</div>
				)
				: null}

			<form onSubmit={requestCode} noValidate>
				{emailField}
				<CaptchaField controller={captcha} siteKey={captchaSiteKey} action="recover" />
				<Button
					type="submit"
					label={submitting.value ? "Sending…" : "Send reset code"}
					loading={submitting.value}
					fluid
				/>
			</form>

			<p class="auth-alt">
				Remembered it?{" "}
				<a class="auth-link" href={withRedirect("/login", redirectTo)}>Back to sign in</a>
			</p>
		</>
	);
}
