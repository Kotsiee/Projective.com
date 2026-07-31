import { useSignal } from "@preact/signals";
import { NewsletterService } from "../core/NewsletterService.ts";
import { ArrowIcon } from "../components/footer-icons.tsx";
// The footer is a server component, so its stylesheet only reaches the client when imported from an
// island in the page's client bundle (the same delivery pattern site-shell.css uses via SiteHeader).
// This island renders inside the footer on every public surface, so it is the reliable carrier.
import "../styles/footer.css";
import { Icon } from "@projective/ui/icons";

/**
 * NewsletterForm — the footer "stay updated" capture. A DUMB island (no DB, no logic): it holds the
 * email input, delegates validation + the network round-trip to the thin {@link NewsletterService}
 * (which Zod-validates against the SSOT before hitting `/api/newsletter/subscribe`), and reflects the
 * returned {@link NewsletterResult} as an inline field error or a success confirmation. The submit is
 * icon-only; the accessible name lives on the button, the status is announced via `aria-live`.
 */
export default function NewsletterForm() {
	const email = useSignal("");
	const submitting = useSignal(false);
	const error = useSignal<string | null>(null);
	const done = useSignal(false);

	async function onSubmit(e: Event) {
		e.preventDefault();
		if (submitting.value) return;
		error.value = null;

		submitting.value = true;
		const result = await NewsletterService.subscribe(email.value.trim(), "footer");
		submitting.value = false;

		if (!result.ok) {
			error.value = result.errors?.email ?? result.message ??
				"Something went wrong. Please try again.";
			return;
		}
		done.value = true;
		email.value = "";
	}

	if (done.value) {
		return (
			<p class="lp-footer__news-done" role="status">
				<Icon name="check" class="lp-footer__news-check" />
				You're on the list — thanks for subscribing.
			</p>
		);
	}

	const errorId = "lp-footer-news-error";
	return (
		<form class="lp-footer__news-form" onSubmit={onSubmit} noValidate>
			<div class={`lp-footer__news-field${error.value ? " lp-footer__news-field--invalid" : ""}`}>
				<input
					class="lp-footer__news-input"
					type="email"
					value={email.value}
					onInput={(e) => {
						email.value = (e.currentTarget as HTMLInputElement).value;
						if (error.value) error.value = null;
					}}
					placeholder="you@example.com"
					aria-label="Email address"
					aria-invalid={error.value ? "true" : "false"}
					aria-describedby={error.value ? errorId : undefined}
					autoComplete="email"
					disabled={submitting.value}
				/>
				<button
					type="submit"
					class="lp-footer__news-submit"
					aria-label="Subscribe"
					disabled={submitting.value}
				>
					<ArrowIcon class="lp-footer__news-arrow" />
				</button>
			</div>
			{error.value
				? <span class="lp-footer__news-error" id={errorId} role="alert">{error.value}</span>
				: null}
		</form>
	);
}
