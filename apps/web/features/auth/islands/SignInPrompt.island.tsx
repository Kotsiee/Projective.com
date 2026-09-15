import type { JSX } from "preact";
import { Dialog } from "@projective/ui/feedback";
import { Icon } from "@projective/ui/icons";
import "../styles/sign-in-prompt.css";
import { withRedirect } from "../core/redirect.ts";
import {
	dismissSignIn,
	type SignInIntent,
	signInPromptOpen,
	type SignInRequest,
	signInRequest,
} from "../core/sign-in-prompt.ts";

/**
 * SignInPrompt — the authentication prompt a guest meets when they press a control that is a claim on
 * their own account (Follow, Message, Save).
 *
 * It is NOT a second login form. The two links it offers are the standard flow's own entry points —
 * `/login` and `/join`, each carrying the sanitised `redirectTo` that the auth routes, the OAuth
 * callback and the guard all already honour — so signing in from here behaves exactly like signing in
 * from the header, and lands the reader back on the page they pressed the control on. A form here
 * would be a third copy of the login screen to keep in step with the other two.
 *
 * Mounted ONCE per page (a surface that has guest-gated controls renders it beside them); every
 * trigger reaches it through {@link requestSignIn}. Reuses the `@projective/ui` `Dialog` (portal,
 * backdrop, focus trap, Escape, bottom-sheet below `--bp-md`).
 */
const INTENT_COPY: Record<SignInIntent, { title: string; lead: (subject?: string) => string }> = {
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
	const returnTo = request?.returnTo ?? "/";

	return (
		<Dialog
			visible={signInPromptOpen}
			header={title}
			width="24rem"
			class="auth-prompt"
			onVisibleChange={(open) => {
				if (!open) dismissSignIn();
			}}
			footer={
				<div class="auth-prompt__actions">
					<a
						class="ui-button ui-button--primary ui-button--filled ui-button--size-md ui-button--rounded auth-prompt__cta"
						href={withRedirect("/login", returnTo)}
					>
						<span class="ui-button__label">Sign in</span>
					</a>
					<a
						class="ui-button ui-button--primary ui-button--outlined ui-button--size-md ui-button--rounded auth-prompt__cta"
						href={withRedirect("/join", returnTo)}
					>
						<span class="ui-button__label">Create an account</span>
					</a>
				</div>
			}
		>
			<div class="auth-prompt__body">
				<span class="auth-prompt__mark" aria-hidden="true">
					<Icon name="lock" size="md" />
				</span>
				<p class="auth-prompt__lead">{lead}</p>
				<p class="auth-prompt__note">You'll come straight back here afterwards.</p>
			</div>
		</Dialog>
	);
}
