import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import {
	Button,
	Checkbox,
	FloatLabel,
	FormControl,
	InputText,
	Password,
} from "@projective/ui/fields";
import { WarnIcon } from "./icons.tsx";
import { identifierError, isEmailIdentifier, requiredError } from "../core/validate.ts";
import { AuthService } from "../core/AuthService.ts";
import { safeRedirect, withRedirect } from "../core/redirect.ts";

/**
 * CredentialsForm — the identifier + password sign-in form: client-side validation, the
 * {@link AuthService.login} call, the error banner, "Keep me signed in" and the forgot-password link.
 * The identifier is an email OR a username in one field; which it is, and the username → email
 * resolution, is the fat service's business. On success it navigates to the captured return path
 * (or to `/verify` for an unverified account).
 *
 * ONE implementation, composed by both the `/login` screen (`LoginForm`) and the in-page
 * {@link SignInPrompt} dialog — the two surfaces must sign a reader in identically, and a second copy
 * of this form is how one of them comes to validate, redirect or fail differently from the other.
 * Rendered inside an island (it holds state), never as a bare server component.
 *
 * Keyboard: Enter on the identifier moves focus to an EMPTY password field rather than submitting a
 * form that could only fail on the field the reader has not reached yet; Enter on the password
 * submits (native implicit submission — the Sign-in button is the form's only submit control, the
 * show/hide toggle inside `Password` being `type="button"`).
 */
export interface CredentialsFormProps {
	/** The sanitised in-app path to land on after signing in. */
	redirectTo: string;
	/** Fired the moment the form starts navigating away (a host dialog can lock itself). */
	onSuccess?: () => void;
}

const PASSWORD_FIELD = "password";

/**
 * The password `<input>` of the form an event came from, by NAME rather than id — the two
 * `FormControl`s thread their ids into separate render scopes, and the form's own element map is the
 * one thing both fields already share.
 */
function passwordInputOf(form: HTMLFormElement | null): HTMLInputElement | null {
	const el = form?.elements.namedItem(PASSWORD_FIELD);
	return el instanceof HTMLInputElement ? el : null;
}

export function CredentialsForm({ redirectTo, onSuccess }: CredentialsFormProps): JSX.Element {
	const identifier = useSignal("");
	const password = useSignal("");
	const remember = useSignal(true);
	const submitting = useSignal(false);
	const formError = useSignal<string | null>(null);
	const errors = useSignal<{ identifier?: string | null; password?: string | null }>({});

	async function onSubmit(e: Event) {
		e.preventDefault();
		formError.value = null;
		const next = {
			identifier: identifierError(identifier.value),
			password: requiredError(password.value, "Password"),
		};
		errors.value = next;
		if (next.identifier || next.password) return;

		const typed = identifier.value.trim();
		submitting.value = true;
		const result = await AuthService.login({
			identifier: typed,
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
		// A username sign-in cannot know its own email; the service returns it on this branch.
		const verifyEmail = result.email ?? (isEmailIdentifier(typed) ? typed : null);
		globalThis.location.href = result.requiresVerification
			? withRedirect(
				verifyEmail ? `/verify?email=${encodeURIComponent(verifyEmail)}` : "/verify",
				dest,
			)
			: dest;
	}

	function onIdentifierKeyDown(e: JSX.TargetedKeyboardEvent<HTMLInputElement>) {
		if (e.key !== "Enter") return;
		const next = passwordInputOf(e.currentTarget.form);
		// The DOM value, not the signal: a manager's autofill can land without an `input` event, and
		// a password that is already there means Enter should do what it always does — submit.
		if (!next || next.value.length > 0) return;
		e.preventDefault();
		next.focus();
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
				<div class="auth-credentials">
					<FormControl
						error={errors.value.identifier ?? undefined}
						status={errors.value.identifier ? "invalid" : "default"}
					>
						{({ id, describedBy }) => (
							<FloatLabel label="Email or username" for={id} variant="in">
								<InputText
									id={id}
									name="identifier"
									aria-describedby={describedBy}
									value={identifier}
									type="text"
									placeholder=" "
									autoComplete="username"
									autoCapitalize="none"
									spellcheck={false}
									status={errors.value.identifier ? "invalid" : "default"}
									variant="filled"
									onKeyDown={onIdentifierKeyDown}
									fluid
								/>
							</FloatLabel>
						)}
					</FormControl>

					<FormControl
						error={errors.value.password ?? undefined}
						status={errors.value.password ? "invalid" : "default"}
					>
						{({ id, describedBy }) => (
							<FloatLabel label="Password" for={id} variant="in">
								<Password
									id={id}
									name={PASSWORD_FIELD}
									aria-describedby={describedBy}
									value={password}
									placeholder=" "
									toggleMask
									autoComplete="current-password"
									status={errors.value.password ? "invalid" : "default"}
									variant="filled"
									fluid
								/>
							</FloatLabel>
						)}
					</FormControl>
				</div>

				<div class="auth-row-split">
					<Checkbox value={remember} name="remember" label="Keep me signed in" />
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
