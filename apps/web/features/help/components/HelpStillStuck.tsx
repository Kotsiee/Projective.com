import type { JSX } from "preact";

/**
 * Where a signed-in reader's secondary action leads (see {@link HelpStillStuck}): the article that
 * explains disputes, until a member dispute route exists (Decision #275 (a)).
 */
export const HELP_DISPUTE_HREF = "/help/disputes-and-fair-exit/how-disputes-are-decided";

/**
 * The secondary's label. It names what the link does — it opens an article — so it says "How
 * disputes work", not "Raise a dispute" (WCAG 2.4.4). It becomes "Raise a dispute" in the same change
 * that points {@link HELP_DISPUTE_HREF} at a real dispute flow.
 */
export const HELP_DISPUTE_LABEL = "How disputes work";

/** Where "Contact support" goes: the contact page, opened on its support intent (P3). */
export const HELP_CONTACT_HREF = "/contact?intent=support";

/**
 * HelpStillStuck — the "Still stuck?" band that closes the hub and every category page (P2 §2): one
 * line, a filled **Contact support** (tier 3, the region's one fill) and, for a signed-in reader, an
 * outlined {@link HELP_DISPUTE_LABEL} (tier 4) before it in the inline order (§B.8.6). The band is a
 * solid `--surface-1` region holding controls, not a card around static text.
 *
 * There is no dispute route for members yet — a no-show is reported from the session's sidebar and
 * a deliverable stage ends through Fair Exit — so the secondary leads to the article that explains
 * both, and is labelled for that (flagged for P8, Decision #275 (a)).
 */
export function HelpStillStuck({ signedIn }: { signedIn: boolean }): JSX.Element {
	return (
		<section class="hc-stuck" aria-labelledby="hc-stuck-title">
			<div class="hc-stuck__text">
				<h2 id="hc-stuck-title" class="hc-stuck__title">Still stuck?</h2>
				<p class="hc-stuck__line">
					Tell us what you were trying to do, and we'll help you sort it out.
				</p>
			</div>
			<div class="hc-stuck__actions">
				{signedIn && (
					<a
						class="ui-button ui-button--neutral ui-button--outlined ui-button--size-md"
						href={HELP_DISPUTE_HREF}
					>
						<span class="ui-button__label">{HELP_DISPUTE_LABEL}</span>
					</a>
				)}
				<a
					class="ui-button ui-button--primary ui-button--filled ui-button--size-md"
					href={HELP_CONTACT_HREF}
				>
					<span class="ui-button__label">Contact support</span>
				</a>
			</div>
		</section>
	);
}
