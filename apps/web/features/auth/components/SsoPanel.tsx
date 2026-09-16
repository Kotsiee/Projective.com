import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button, FormControl, InputText } from "@projective/ui/fields";
import { InfoIcon, LockIcon } from "./icons.tsx";
import { AuthService } from "../core/AuthService.ts";

const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

/**
 * SsoPanel — the **Enterprise SSO** entry: a toggle styled like the OAuth buttons that reveals a
 * single corporate-domain field, which queries the org's SAML/OIDC provider through
 * {@link AuthService.sso} and follows the resolved authorize URL.
 *
 * ONE implementation shared by the `/login` screen and the in-page {@link SignInPrompt} dialog (the
 * `CredentialsForm` reasoning). Rendered inside an island — it holds state.
 */
export interface SsoPanelProps {
	/** The sanitised in-app path to land on after the identity provider returns. */
	redirectTo: string;
}

export function SsoPanel({ redirectTo }: SsoPanelProps): JSX.Element {
	const open = useSignal(false);
	const domain = useSignal("");
	const error = useSignal<string | null>(null);
	const message = useSignal<string | null>(null);
	const busy = useSignal(false);

	async function onSubmit(e: Event) {
		e.preventDefault();
		error.value = null;
		message.value = null;
		const d = domain.value.trim();
		if (!DOMAIN_RE.test(d)) {
			error.value = "Enter a domain like company.com.";
			return;
		}
		busy.value = true;
		const result = await AuthService.sso({ domain: d, redirectTo });
		busy.value = false;
		if (!result.ok) {
			error.value = result.errors?.domain ?? result.message ?? "Couldn't look up that domain.";
			return;
		}
		// A resolved provider hands back an external IdP authorize URL — begin the handshake.
		if (result.ssoUrl) {
			message.value = "Redirecting to your identity provider…";
			globalThis.location.href = result.ssoUrl;
			return;
		}
		message.value = result.message ?? "Redirecting to your identity provider…";
	}

	return (
		<>
			<div class="auth-oauth">
				<button
					type="button"
					class="auth-oauth__btn"
					aria-expanded={open.value ? "true" : "false"}
					onClick={() => (open.value = !open.value)}
				>
					{LockIcon({ class: "auth-oauth__glyph" })}
					<span class="auth-oauth__label">Enterprise SSO</span>
				</button>
			</div>

			{open.value
				? (
					<div class="auth-sso">
						<p class="auth-sso__hint">
							Enter your work email domain to continue with your company's identity provider.
						</p>
						<form onSubmit={onSubmit} noValidate>
							<FormControl
								label="Company domain"
								error={error.value ?? undefined}
								status={error.value ? "invalid" : "default"}
							>
								{({ id, describedBy }) => (
									<InputText
										id={id}
										aria-describedby={describedBy}
										value={domain}
										placeholder="company.com"
										autoComplete="off"
										variant="filled"
										status={error.value ? "invalid" : "default"}
										fluid
									/>
								)}
							</FormControl>
							<div class="auth-actions">
								<Button
									type="submit"
									label={busy.value ? "Checking…" : "Continue with SSO"}
									loading={busy.value}
									fluid
								/>
							</div>
						</form>
						{message.value
							? (
								<div class="auth-banner auth-banner--info" role="status">
									<span class="auth-banner__icon">{InfoIcon()}</span>
									<span>{message.value}</span>
								</div>
							)
							: null}
					</div>
				)
				: null}
		</>
	);
}
