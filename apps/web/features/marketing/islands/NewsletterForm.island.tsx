import type { ComponentType } from "preact";
import { useMemo } from "preact/hooks";
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
import {
	type CaptchaController,
	createCaptchaController,
} from "@features/auth/core/captcha-controller.ts";
import type { CaptchaFieldProps } from "@features/auth/components/CaptchaField.tsx";

/** Props for {@link NewsletterForm}. Both are optional: the footer passes neither. */
export interface NewsletterFormProps {
	/** The list this capture opts into — `general` (the default) or `changelog` (the changelog). */
	topic?: NewsletterTopic;
	/** Where the capture sits, for attribution — `footer` (the default), `landing` or `explore`. */
	source?: NewsletterSource;
}

/** What the form says once a subscribe is accepted, when the server's own line is missing. */
const ACCEPTED =
	"Thanks! If you're not already subscribed, check your inbox for a link to confirm.";

/**
 * NewsletterForm — the "stay updated" capture, in the footer by default and reusable on a page with a
 * `topic` (the changelog subscribes to `changelog`). A DUMB island (no DB, no logic): it holds the
 * email input, delegates validation + the network round-trip to the thin {@link NewsletterService}
 * (which Zod-validates against `NewsletterSubscribeSchema` before hitting `/api/newsletter/subscribe`),
 * and reflects the returned {@link NewsletterResult} in one status line under the field — a retry
 * warning or the "check your inbox" line (a subscribe is confirmed from the mailed link, PRD-E11).
 * That line is always in the DOM at a reserved height and is a polite live region, so the outcome is
 * announced without interrupting and nothing below it moves. The submit is icon-only; the accessible
 * name lives on the button.
 *
 * **The bot check.** A subscribe mails the address it is given, so it carries a Turnstile token
 * (action `newsletter`, Decision #447's widget). The footer is on every public page, so the widget is
 * not: the form arms it on the first focus inside it, loading `CaptchaField` (and Cloudflare's
 * script) as a lazy chunk, and the submit waits for its token. `interaction-only`, so most people
 * never see it; it opens under the field only when Cloudflare asks for a click.
 */
export default function NewsletterForm(
	{ topic = "general", source = "footer" }: NewsletterFormProps,
) {
	const email = useSignal("");
	const submitting = useSignal(false);
	const error = useSignal<string | null>(null);
	const done = useSignal<string | null>(null);
	const captcha = useMemo<CaptchaController>(() => createCaptchaController(), []);
	const Field = useSignal<ComponentType<CaptchaFieldProps> | null>(null);
	const armed = useSignal(false);
	// One id per instance, so two captures on one page (the footer's and a page's own, even with the
	// same topic) never share an id or an ambiguous aria-describedby.
	const statusId = useId(undefined, "lp-footer-news-status");

	/** Load the widget once. Until it mounts, a submit waits as if the check were running. */
	function arm() {
		if (armed.value) return;
		armed.value = true;
		captcha.phase.value = "loading";
		import("@features/auth/components/CaptchaField.tsx")
			.then((module) => {
				Field.value = module.CaptchaField;
			})
			.catch(() => {
				captcha.phase.value = "failed";
			});
	}

	async function onSubmit(e: Event) {
		e.preventDefault();
		if (submitting.value) return;
		error.value = null;
		done.value = null;

		submitting.value = true;
		arm();
		const captchaToken = await captcha.take();
		const result = await NewsletterService.subscribe(
			email.value.trim(),
			source,
			topic,
			captchaToken,
		);
		submitting.value = false;
		captcha.reset();

		if (!result.ok) {
			error.value = result.errors?.email ?? result.message ??
				"Something went wrong. Please try again.";
			return;
		}
		done.value = result.message ?? ACCEPTED;
		email.value = "";
	}

	const CaptchaWidget = Field.value;

	return (
		<form class="lp-footer__news-form" onSubmit={onSubmit} onFocusIn={arm} noValidate>
			<div class={`lp-footer__news-field${error.value ? " lp-footer__news-field--invalid" : ""}`}>
				<input
					class="lp-footer__news-input"
					type="email"
					value={email.value}
					onInput={(e) => {
						email.value = (e.currentTarget as HTMLInputElement).value;
						if (error.value) error.value = null;
						done.value = null;
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
			{CaptchaWidget ? <CaptchaWidget controller={captcha} action="newsletter" /> : null}
			<p
				id={statusId}
				class={`lp-footer__news-status${error.value ? " lp-footer__news-status--error" : ""}`}
				role="status"
			>
				{error.value ?? (done.value
					? (
						<>
							<Icon name="check" class="lp-footer__news-check" />
							{done.value}
						</>
					)
					: null)}
			</p>
		</form>
	);
}
