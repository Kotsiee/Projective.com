import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { AuthHeading } from "../components/AuthShell.tsx";
import { WarnIcon } from "../components/icons.tsx";
import { CONFIRM_ENDPOINT } from "../core/confirm-link.ts";

/** The confirm page's link: the token to post, and whether the last press was throttled. */
export interface ConfirmEmailFormProps {
	tokenHash: string;
	type: "email";
	throttled: boolean;
}

/**
 * ConfirmEmailForm — `/verify/confirm`'s one button (Decision #445). A plain form that posts the
 * link's token to `POST /api/auth/confirm`, so it works before hydration and without JavaScript.
 * It never submits itself: a scanner that runs scripts must still not spend the token. Once hydrated
 * it only refuses a second submit, which would abort the first response and drop its session cookie.
 */
export default function ConfirmEmailForm({ tokenHash, type, throttled }: ConfirmEmailFormProps) {
	const sent = useSignal(false);

	useEffect(() => {
		const reset = (e: PageTransitionEvent) => {
			if (e.persisted) sent.value = false;
		};
		globalThis.addEventListener("pageshow", reset);
		return () => globalThis.removeEventListener("pageshow", reset);
	}, []);

	return (
		<>
			<AuthHeading
				title="Confirm your email"
				subtitle="One more step. Press the button to confirm your email and sign in on this device."
			/>

			{throttled
				? (
					<div class="auth-banner auth-banner--error" role="alert">
						<span class="auth-banner__icon">{WarnIcon()}</span>
						<span>Too many attempts just now. Wait a few minutes, then press Confirm again.</span>
					</div>
				)
				: null}

			<form
				method="post"
				action={CONFIRM_ENDPOINT}
				onSubmit={(e) => {
					if (sent.value) {
						e.preventDefault();
						return;
					}
					sent.value = true;
				}}
			>
				<input type="hidden" name="token_hash" value={tokenHash} />
				<input type="hidden" name="type" value={type} />
				<Button
					type="submit"
					label={sent.value ? "Confirming…" : "Confirm my email"}
					fluid
					aria-busy={sent.value || undefined}
				/>
			</form>

			<p class="auth-alt">Didn't create a Projective account? You can close this page.</p>
		</>
	);
}
