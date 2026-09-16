import { AuthHeading } from "../components/AuthShell.tsx";
import { OAuthButtons } from "../components/OAuthButtons.tsx";
import { CredentialsForm } from "../components/CredentialsForm.tsx";
import { SsoPanel } from "../components/SsoPanel.tsx";
import { CheckIcon } from "../components/icons.tsx";
import { withRedirect } from "../core/redirect.ts";

/**
 * LoginForm — the `/login` screen: Google OAuth, the **Enterprise SSO** path ({@link SsoPanel}) and
 * email/password sign-in ({@link CredentialsForm}), on the soft, filled auth surface. The same three
 * parts compose the in-page `SignInPrompt` dialog, so signing in from either lands identically.
 */
export default function LoginForm(
	{ redirectTo, notice }: { redirectTo: string; notice?: string | null },
) {
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

			<OAuthButtons redirectTo={redirectTo} label="Sign in" mode="signin" />
			<SsoPanel redirectTo={redirectTo} />

			<div class="auth-divider">
				<span>or</span>
			</div>

			<CredentialsForm redirectTo={redirectTo} />
		</>
	);
}
