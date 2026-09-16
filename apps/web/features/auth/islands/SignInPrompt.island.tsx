import type { JSX } from "preact";
import { Dialog } from "@projective/ui/feedback";
import "../styles/auth-controls.css";
import "../styles/sign-in-prompt.css";
import { OAuthButtons } from "../components/OAuthButtons.tsx";
import { CredentialsForm } from "../components/CredentialsForm.tsx";
import { SsoPanel } from "../components/SsoPanel.tsx";
import { safeRedirect, withRedirect } from "../core/redirect.ts";
import {
	dismissSignIn,
	type SignInIntent,
	signInPromptOpen,
	type SignInRequest,
	signInRequest,
} from "../core/sign-in-prompt.ts";

/**
 * SignInPrompt — the authentication dialog a guest meets when they press a control that is a claim on
 * their own account (Hire, Follow, Message, Save). It signs them in IN PLACE — Google OAuth, Enterprise
 * SSO or email + password — and lands them back on the page they pressed the control on.
 *
 * It is NOT a second login form. Every part is the `/login` screen's own: {@link OAuthButtons} (the
 * server OAuth entry, which sends a brand-new Google identity on to `/join` pre-filled and a returning
 * one to its return path — the callback decides, not this dialog), {@link SsoPanel} and
 * {@link CredentialsForm}, each carrying the sanitised `redirectTo` that the auth routes, the OAuth
 * callback and the guard all already honour. The "Create an account" link is the same `/join` entry
 * the login screen offers. A form of its own here would be a third copy of the login screen to keep in
 * step with the other two.
 *
 * Mounted ONCE per page (a surface that has guest-gated controls renders it beside them); every
 * trigger reaches it through {@link requestSignIn}. Reuses the `@projective/ui` `Dialog` (portal,
 * backdrop, focus trap, Escape, bottom-sheet below `--bp-md`).
 */
const INTENT_COPY: Record<SignInIntent, { title: string; lead: (subject?: string) => string }> = {
	hire: {
		title: "Sign in to hire",
		lead: (subject) =>
			subject
				? `Hiring ${subject} starts a project on your account, so you need one to bring them in.`
				: "Hiring starts a project on your account, so you need one to bring somebody in.",
	},
	follow: {
		title: "Sign in to follow",
		lead: (subject) =>
			subject
				? `Following ${subject} keeps their new work and posts in your feed.`
				: "Following keeps new work and posts in your feed.",
	},
	message: {
		title: "Sign in to message",
		lead: (subject) =>
			subject
				? `Your conversation with ${subject} lives in your inbox, so you need an account to start one.`
				: "Conversations live in your inbox, so you need an account to start one.",
	},
	save: {
		title: "Sign in to save",
		lead: () => "Saved items are kept on your account, so they follow you between devices.",
	},
	generic: {
		title: "Sign in to continue",
		lead: () => "This needs a Projective account.",
	},
};

function copyFor(request: SignInRequest | null) {
	const intent = request?.intent ?? "generic";
	const entry = INTENT_COPY[intent];
	return { title: entry.title, lead: entry.lead(request?.subject) };
}

export default function SignInPrompt(): JSX.Element {
	const request = signInRequest.value;
	const { title, lead } = copyFor(request);
	// Sanitised ONCE here; the three parts and the join link all receive the same destination.
	const redirectTo = safeRedirect(request?.returnTo, "/");

	return (
		<Dialog
			visible={signInPromptOpen}
			header={title}
			width="28rem"
			class="auth-prompt"
			onVisibleChange={(open) => {
				if (!open) dismissSignIn();
			}}
			footer={
				<p class="auth-prompt__join">
					New to Projective?{" "}
					<a class="auth-link" href={withRedirect("/join", redirectTo)}>Create an account</a>
				</p>
			}
		>
			<div class="auth-prompt__body">
				<p class="auth-prompt__lead">{lead}</p>

				<OAuthButtons redirectTo={redirectTo} label="Sign in" mode="signin" />
				<SsoPanel redirectTo={redirectTo} />

				<div class="auth-divider">
					<span>or</span>
				</div>

				<CredentialsForm redirectTo={redirectTo} />

				<p class="auth-prompt__note">You'll come straight back here afterwards.</p>
			</div>
		</Dialog>
	);
}
