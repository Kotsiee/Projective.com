import type { JSX } from "preact";
import { GoogleMark } from "@features/shell/components/brand-marks.tsx";
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

export function OAuthButtons(
	{ redirectTo, label = "Continue", mode = "signup" }: OAuthButtonsProps,
): JSX.Element {
	const href = withRedirect(`/api/auth/oauth/google?mode=${mode}`, redirectTo);
	return (
		<div class="auth-oauth">
			<a class="auth-oauth__btn" href={href} data-provider="google">
				<GoogleMark class="auth-oauth__glyph" />
				<span class="auth-oauth__label">{label} with Google</span>
			</a>
		</div>
	);
}
