import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button, FormControl, InputText, Password } from "@projective/ui/fields";
import { WarnIcon } from "./icons.tsx";
import { emailError, requiredError } from "../core/validate.ts";
import { AuthService } from "../core/AuthService.ts";
import { safeRedirect, withRedirect } from "../core/redirect.ts";

/**
 * CredentialsForm — the email + password sign-in form: client-side validation, the
 * {@link AuthService.login} call, the error banner, "Keep me signed in" and the forgot-password link.
 * On success it navigates to the captured return path (or to `/verify` for an unverified account).
 *
 * ONE implementation, composed by both the `/login` screen (`LoginForm`) and the in-page
 * {@link SignInPrompt} dialog — the two surfaces must sign a reader in identically, and a second copy
 * of this form is how one of them comes to validate, redirect or fail differently from the other.
 * Rendered inside an island (it holds state), never as a bare server component.
 */
export interface CredentialsFormProps {
	/** The sanitised in-app path to land on after signing in. */
	redirectTo: string;
	/** Fired the moment the form starts navigating away (a host dialog can lock itself). */
	onSuccess?: () => void;
}

export function CredentialsForm({ redirectTo, onSuccess }: CredentialsFormProps): JSX.Element {
	const email = useSignal("");
	const password = useSignal("");
	const remember = useSignal(true);
	const submitting = useSignal(false);
	const formError = useSignal<string | null>(null);
	const errors = useSignal<{ email?: string | null; password?: string | null }>({});

	async function onSubmit(e: Event) {
		e.preventDefault();
		formError.value = null;
		const next = {
			email: emailError(email.value),
			password: requiredError(password.value, "Password"),
		};
		errors.value = next;
		if (next.email || next.password) return;

		submitting.value = true;
		const result = await AuthService.login({
			email: email.value.trim(),
			password: password.value,
			remember: remember.value,
			redirectTo,
		});
		if (!result.ok) {
			submitting.value = false;
			if (result.errors) errors.value = result.errors;
			formError.value = result.message ?? "We couldn't sign you in. Check your details and retry.";
			return;
		}
		onSuccess?.();
		const dest = safeRedirect(result.redirectTo, redirectTo);
		globalThis.location.href = result.requiresVerification
			? withRedirect(`/verify?email=${encodeURIComponent(email.value.trim())}`, dest)
			: dest;
	}

	return (
		<>
			{formError.value
				? (
					<div class="auth-banner auth-banner--error" role="alert">
						<span class="auth-banner__icon">{WarnIcon()}</span>
						<span>{formError.value}</span>
					</div>
				)
				: null}

			<form onSubmit={onSubmit} noValidate>
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

				<div class="auth-field-row">
					<FormControl
						label="Password"
						error={errors.value.password ?? undefined}
						status={errors.value.password ? "invalid" : "default"}
					>
						{({ id, describedBy }) => (
							<Password
								id={id}
								aria-describedby={describedBy}
								value={password}
								toggleMask
								autoComplete="current-password"
								status={errors.value.password ? "invalid" : "default"}
								variant="filled"
								fluid
							/>
						)}
					</FormControl>
				</div>

				<div class="auth-row-split">
					<label class="auth-remember">
						<input
							type="checkbox"
							checked={remember.value}
							onChange={(ev) => (remember.value = ev.currentTarget.checked)}
						/>
						<span>Keep me signed in</span>
					</label>
					<a class="auth-link" href={withRedirect("/forgot-password", redirectTo)}>
						Forgot password?
					</a>
				</div>

				<Button
					type="submit"
					label={submitting.value ? "Signing in…" : "Sign in"}
					loading={submitting.value}
					fluid
				/>
			</form>
		</>
	);
}
