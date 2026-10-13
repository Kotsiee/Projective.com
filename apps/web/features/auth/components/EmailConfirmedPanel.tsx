import { Button } from "@projective/ui/fields";
import { CheckIcon } from "./icons.tsx";
import { withRedirect } from "../core/redirect.ts";

/**
 * The `/verify` state for an email confirmed somewhere this browser has no session (Decision #185):
 * the link was opened on another device or browser. It says so and offers sign-in, rather than
 * navigating into a guarded route that would bounce to `/login` unexplained.
 */
export function EmailConfirmedPanel({ redirectTo, email }: { redirectTo: string; email?: string }) {
	return (
		<div class="auth-verified" role="status" aria-live="polite">
			<span class="auth-verified__badge">{CheckIcon()}</span>
			<h1 class="auth-heading__title">Email confirmed</h1>
			<p class="auth-heading__subtitle">
				{email ? <strong>{email}</strong> : "Your email"}{" "}
				is confirmed. Sign in to continue to your account.
			</p>
			<Button
				type="button"
				label="Sign in"
				fluid
				onClick={() => {
					globalThis.location.href = withRedirect("/login?notice=confirmed", redirectTo);
				}}
			/>
		</div>
	);
}
