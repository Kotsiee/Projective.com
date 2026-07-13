import { useSignal } from "@preact/signals";
import { Button, FormControl, InputText, Password } from "@projective/ui/fields";
import { AuthHeading } from "../components/AuthShell.tsx";
import { OAuthButtons } from "../components/OAuthButtons.tsx";
import { CheckIcon, InfoIcon, LockIcon, WarnIcon } from "../components/icons.tsx";
import { emailError, requiredError } from "../core/validate.ts";
import { postAuth } from "../core/api.ts";
import { safeRedirect, withRedirect } from "../core/redirect.ts";

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

/**
 * LoginForm — email/password sign-in plus Google OAuth and an **Enterprise SSO** path. Clicking
 * "Enterprise SSO" reveals a single corporate-domain field that queries the org's SAML/OIDC provider
 * (`/api/auth/sso`). On success it honours the captured return path; unverified accounts route to
 * `/verify`. Built from `@projective/ui` field components on the soft, filled auth surface.
 */
export default function LoginForm(
	{ redirectTo, notice }: { redirectTo: string; notice?: string | null },
) {
	const email = useSignal("");
	const password = useSignal("");
	const remember = useSignal(true);
	const submitting = useSignal(false);
	const formError = useSignal<string | null>(null);
	const errors = useSignal<{ email?: string | null; password?: string | null }>({});

	const ssoOpen = useSignal(false);
	const domain = useSignal("");
	const ssoError = useSignal<string | null>(null);
	const ssoMessage = useSignal<string | null>(null);
	const ssoBusy = useSignal(false);

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
		const result = await postAuth("/api/auth/login", {
			email: email.value.trim(),
			password: password.value,
			remember: remember.value,
			redirectTo,
		});
		submitting.value = false;
		if (!result.ok) {
			if (result.errors) errors.value = result.errors;
			formError.value = result.message ?? "We couldn't sign you in. Check your details and retry.";
			return;
		}
		const dest = safeRedirect(result.redirectTo, redirectTo);
		globalThis.location.href = result.requiresVerification
			? withRedirect(`/verify?email=${encodeURIComponent(email.value.trim())}`, dest)
			: dest;
	}

	async function ssoSubmit(e: Event) {
		e.preventDefault();
		ssoError.value = null;
		ssoMessage.value = null;
		const d = domain.value.trim();
		if (!DOMAIN_RE.test(d)) {
			ssoError.value = "Enter a domain like company.com.";
			return;
		}
		ssoBusy.value = true;
		const result = await postAuth("/api/auth/sso", { domain: d, redirectTo });
		ssoBusy.value = false;
		if (!result.ok) {
			ssoError.value = result.errors?.domain ?? result.message ?? "Couldn't look up that domain.";
			return;
		}
		ssoMessage.value = result.message ?? "Redirecting to your identity provider…";
	}

	return (
		<>
			<AuthHeading
				title="Welcome back"
				subtitle={
					<>
						New to Projective?{" "}
						<a class="auth-link" href={withRedirect("/join", redirectTo)}>Create an account</a>
					</>
				}
			/>

			{notice === "reset"
				? (
					<div class="auth-banner auth-banner--success" role="status">
						<span class="auth-banner__icon">{CheckIcon()}</span>
						<span>Password updated. Sign in with your new password.</span>
					</div>
				)
				: null}

			<OAuthButtons redirectTo={redirectTo} label="Sign in" />

			<div class="auth-oauth">
				<button
					type="button"
					class="auth-oauth__btn"
					aria-expanded={ssoOpen.value}
					onClick={() => (ssoOpen.value = !ssoOpen.value)}
				>
					{LockIcon({ class: "auth-oauth__glyph" })}
					<span class="auth-oauth__label">Enterprise SSO</span>
				</button>
			</div>

			{ssoOpen.value
				? (
					<div class="auth-sso">
						<p class="auth-sso__hint">
							Enter your work email domain to continue with your company's identity provider.
						</p>
						<form onSubmit={ssoSubmit} noValidate>
							<FormControl
								label="Company domain"
								error={ssoError.value ?? undefined}
								status={ssoError.value ? "invalid" : "default"}
							>
								{({ id, describedBy }) => (
									<InputText
										id={id}
										aria-describedby={describedBy}
										value={domain}
										placeholder="company.com"
										autoComplete="off"
										variant="filled"
										status={ssoError.value ? "invalid" : "default"}
										fluid
									/>
								)}
							</FormControl>
							<div class="auth-actions">
								<Button
									type="submit"
									label={ssoBusy.value ? "Checking…" : "Continue with SSO"}
									loading={ssoBusy.value}
									fluid
								/>
							</div>
						</form>
						{ssoMessage.value
							? (
								<div class="auth-banner auth-banner--info" role="status">
									<span class="auth-banner__icon">{InfoIcon()}</span>
									<span>{ssoMessage.value}</span>
								</div>
							)
							: null}
					</div>
				)
				: null}

			<div class="auth-divider">
				<span>or</span>
			</div>

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
