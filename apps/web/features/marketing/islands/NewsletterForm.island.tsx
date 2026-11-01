import { useSignal } from "@preact/signals";
import { NewsletterService } from "../core/NewsletterService.ts";
import { ArrowIcon } from "../components/footer-icons.tsx";
// The footer is a server component, so its stylesheet only reaches the client when imported from an
// island in the page's client bundle (the same delivery pattern site-shell.css uses via SiteHeader).
// This island renders inside the footer on every public surface, so it is the reliable carrier.
import "../styles/footer.css";
import { Icon } from "@projective/ui/icons";
import { useId } from "@projective/ui/hooks";
import type { NewsletterSource, NewsletterTopic } from "@projective/types/community";

/** Props for {@link NewsletterForm}. Both are optional: the footer passes neither. */
export interface NewsletterFormProps {
	/** The list this capture opts into — `general` (the default) or `changelog` (the changelog). */
	topic?: NewsletterTopic;
	/** Where the capture sits, for attribution — `footer` (the default), `landing` or `explore`. */
	source?: NewsletterSource;
}

/**
 * NewsletterForm — the "stay updated" capture, in the footer by default and reusable on a page with a
 * `topic` (the changelog subscribes to `changelog`). A DUMB island (no DB, no logic): it holds the
 * email input, delegates validation + the network round-trip to the thin {@link NewsletterService}
 * (which Zod-validates against `NewsletterSubscribeSchema` before hitting `/api/newsletter/subscribe`),
 * and reflects the returned {@link NewsletterResult} in one status line under the field — a retry
 * warning or the success confirmation. That line is always in the DOM at a reserved height and is a
 * polite live region, so the outcome is announced without interrupting and nothing below it moves.
 * The submit is icon-only; the accessible name lives on the button.
 */
export default function NewsletterForm(
	{ topic = "general", source = "footer" }: NewsletterFormProps,
) {
	const email = useSignal("");
	const submitting = useSignal(false);
	const error = useSignal<string | null>(null);
	const done = useSignal(false);
	// One id per instance, so two captures on one page (the footer's and a page's own, even with the
	// same topic) never share an id or an ambiguous aria-describedby.
	const statusId = useId(undefined, "lp-footer-news-status");

	async function onSubmit(e: Event) {
		e.preventDefault();
		if (submitting.value) return;
		error.value = null;
		done.value = false;

		submitting.value = true;
		const result = await NewsletterService.subscribe(email.value.trim(), source, topic);
		submitting.value = false;

		if (!result.ok) {
			error.value = result.errors?.email ?? result.message ??
				"Something went wrong. Please try again.";
			return;
		}
		done.value = true;
		email.value = "";
	}

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
						done.value = false;
					}}
					placeholder="you@example.com"
					aria-label="Email address"
					aria-invalid={error.value ? "true" : "false"}
					aria-describedby={error.value ? statusId : undefined}
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
			<p
				id={statusId}
				class={`lp-footer__news-status${error.value ? " lp-footer__news-status--error" : ""}`}
				role="status"
			>
				{error.value ?? (done.value
					? (
						<>
							<Icon name="check" class="lp-footer__news-check" />
							You're on the list — thanks for subscribing.
						</>
					)
					: null)}
			</p>
		</form>
	);
}
