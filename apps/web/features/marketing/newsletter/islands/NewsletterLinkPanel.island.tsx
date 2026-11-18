import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import "../styles/newsletter-link.css";
import { Button } from "@projective/ui/fields";
import { InlineNotice } from "@projective/ui/feedback";
import { Icon, type IconName } from "@projective/ui/icons";
import { newsletterLinkCopy, type NewsletterLinkPageData } from "../core/link-copy.ts";

/**
 * NewsletterLinkPanel — the body of `/newsletter/confirm` and `/newsletter/unsubscribe` (PRD-E11). A
 * DUMB island: it renders what {@link newsletterLinkCopy} decides from the address's standing, and
 * its one button is a plain form that posts the token to `/api/newsletter/*`, so it works before
 * hydration and without JavaScript. It never submits itself: a scanner that runs scripts must still
 * not confirm or unsubscribe anybody (Decision #445). Once hydrated it only refuses a second submit.
 * It is also the carrier of the pages' stylesheet.
 */
export default function NewsletterLinkPanel(data: NewsletterLinkPageData) {
	const copy = newsletterLinkCopy(data);
	const sent = useSignal(false);

	useEffect(() => {
		const reset = (e: PageTransitionEvent) => {
			if (e.persisted) sent.value = false;
		};
		globalThis.addEventListener("pageshow", reset);
		return () => globalThis.removeEventListener("pageshow", reset);
	}, []);

	const glyph: IconName = data.failure ? "inbox" : data.mode === "confirm" ? "mail" : "bell-off";

	return (
		<section class="nl-link" aria-labelledby="nl-link-title">
			<span class="nl-link__glyph" aria-hidden="true">
				<Icon name={glyph} />
			</span>
			<h1 id="nl-link-title" class="nl-link__title">{copy.title}</h1>
			<p class="nl-link__lede">{copy.lede}</p>
			{copy.topics ? <p class="nl-link__topics">{copy.topics}</p> : null}

			{data.throttled && copy.action
				? (
					<InlineNotice
						assertive
						align="start"
						icon={<Icon name="warning" />}
						text="Too many attempts just now. Wait a few minutes, then press Confirm again."
					/>
				)
				: null}

			{copy.action && data.token
				? (
					<form
						class="nl-link__form"
						method="post"
						action={copy.action.endpoint}
						onSubmit={(e) => {
							if (sent.value) {
								e.preventDefault();
								return;
							}
							sent.value = true;
						}}
					>
						<input type="hidden" name="token" value={data.token} />
						<Button
							type="submit"
							label={sent.value ? copy.action.busyLabel : copy.action.label}
							aria-busy={sent.value || undefined}
						/>
					</form>
				)
				: null}

			{copy.link ? <a class="nl-link__link" href={copy.link.href}>{copy.link.label}</a> : null}
			{copy.aside ? <p class="nl-link__aside">{copy.aside}</p> : null}
		</section>
	);
}
