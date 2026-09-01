import type { JSX } from "preact";
import { withRedirect } from "../core/redirect.ts";

/**
 * OAuthButtons — federated sign-in (MVP: Google). A link to the server OAuth entry carrying the
 * sanitised return path and the screen it was pressed on; for a brand-new identity the flow lands on
 * `/join` with the Google profile pre-filled, while a returning user goes to their return path.
 * Pair with an `.auth-divider` where an "or" separator is wanted.
 */
export interface OAuthButtonsProps {
	redirectTo: string;
	label?: string;
	/**
	 * Which screen the button sits on. It is a hint, not a decision: the live callback resolves
	 * new-vs-returning from the database, and only the non-live simulation — which has no identity to
	 * look up — falls back to this to avoid sending a sign-in attempt to `/join`.
	 */
	mode?: "signin" | "signup";
}

function GoogleIcon(): JSX.Element {
	return (
		<svg class="auth-oauth__glyph" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
			<path
				fill="#4285F4"
				d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
			/>
			<path
				fill="#34A853"
				d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
			/>
			<path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3-2.33Z" />
			<path
				fill="#EA4335"
				d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
			/>
		</svg>
	);
}

export function OAuthButtons(
	{ redirectTo, label = "Continue", mode = "signup" }: OAuthButtonsProps,
): JSX.Element {
	const href = withRedirect(`/api/auth/oauth/google?mode=${mode}`, redirectTo);
	return (
		<div class="auth-oauth">
			<a class="auth-oauth__btn" href={href} data-provider="google">
				<GoogleIcon />
				<span class="auth-oauth__label">{label} with Google</span>
			</a>
		</div>
	);
}
