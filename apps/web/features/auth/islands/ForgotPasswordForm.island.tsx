import { useSignal } from "@preact/signals";
import { Button, FormControl, InputText, Password } from "@projective/ui/fields";
import { AuthHeading } from "../components/AuthShell.tsx";
import { OtpField } from "../components/OtpField.tsx";
import { CheckIcon, WarnIcon } from "../components/icons.tsx";
import { useOtpInput } from "../hooks/useOtpInput.ts";
import { confirmError, emailError, passwordError } from "../core/validate.ts";
import { AuthService } from "../core/AuthService.ts";
import { withRedirect } from "../core/redirect.ts";

/**
 * ForgotPasswordForm — two-step recovery on the soft auth surface. Step 1 requests a reset code by
 * email (the server responds identically whether or not the account exists, to avoid enumeration).
 * Step 2 takes the 6-digit code plus a new password, then returns the user to sign in with the
 * original return path preserved.
 */
export default function ForgotPasswordForm(
	{ redirectTo, email: initialEmail }: { redirectTo: string; email?: string },
) {
	const step = useSignal<"request" | "reset">("request");
	const email = useSignal(initialEmail ?? "");
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
		const result = await AuthService.forgotPassword({
			email: email.value.trim(),
			redirectTo,
		});
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
		const next = {
			code: otp.complete ? null : "Enter the 6-digit code.",
			password: passwordError(password.value),
			confirm: confirmError(password.value, confirm.value),
		};
		errors.value = next;
		if (next.code || next.password || next.confirm) return;

		submitting.value = true;
		const result = await AuthService.resetPassword({
			email: sentTo.value,
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

	if (step.value === "reset") {
		return (
			<>
				<AuthHeading
					title="Set a new password"
					subtitle={
						<>
							Enter the code we emailed to <strong>{sentTo.value}</strong>{" "}
							and choose a new password.
						</>
					}
				/>

				{formError.value
					? (
						<div class="auth-banner auth-banner--error" role="alert">
							<span class="auth-banner__icon">{WarnIcon()}</span>
							<span>{formError.value}</span>
						</div>
					)
					: (
						<div class="auth-banner auth-banner--success" role="status">
							<span class="auth-banner__icon">{CheckIcon()}</span>
							<span>If an account exists for that email, a 6-digit code is on its way.</span>
						</div>
					)}

				<form onSubmit={resetPassword} noValidate>
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
						}}
					>
						Use a different email
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
