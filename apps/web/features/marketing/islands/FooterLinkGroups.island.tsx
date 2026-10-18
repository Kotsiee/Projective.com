import type { JSX } from "preact";
import { useMediaQuery } from "@projective/ui/hooks";
import { openFeedback } from "@features/feedback/core/feedback-bridge.ts";
import { ChevronIcon } from "../components/footer-icons.tsx";
import type { FooterLink, FooterLinkGroup } from "../core/footer-links.ts";
import "../styles/footer.css";

export type { FooterLink, FooterLinkGroup };

/** Whether a click is a plain one the page may take over (not a new tab, window or download). */
function isPlainClick(e: JSX.TargetedMouseEvent<HTMLAnchorElement>): boolean {
	return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/**
 * FooterLinkGroups — the footer's quick-link stacks: open columns from `--bp-md` (768px) up,
 * collapsible `<details>` accordions below it.
 *
 * The stylesheet shows the columns on first paint through `::details-content`; this island makes the
 * semantics agree once hydrated. On a wide viewport each group carries `open`, its summary leaves the
 * tab order and a click on it does nothing, so a heading never announces itself as a collapsed control
 * over links that are already visible.
 *
 * A link marked `opens: "feedback"` is the board's own page as an href — what a new tab, a copied link
 * or a page without JavaScript gets — and a plain click opens the board in the drawer over the page
 * the reader is on instead, through the feedback bridge (Decision #272), which falls back to that page
 * where no drawer host is mounted.
 */
export default function FooterLinkGroups({ groups }: { groups: FooterLinkGroup[] }): JSX.Element {
	const wide = useMediaQuery("(min-width: 768px)");

	return (
		<nav class="lp-footer__nav" aria-label="Quick links">
			{groups.map((g) => (
				<details class="lp-footer__group" key={g.title} open={wide || undefined}>
					<summary
						class="lp-footer__group-head"
						tabIndex={wide ? -1 : undefined}
						onClick={(e) => {
							if (wide) e.preventDefault();
						}}
					>
						<span class="lp-footer__group-title">{g.title}</span>
						<ChevronIcon class="lp-footer__group-chevron" />
					</summary>
					<ul class="lp-footer__links">
						{g.links.map((l) => (
							<li key={l.label}>
								<a
									class="lp-footer__link"
									href={l.href}
									onClick={l.opens === "feedback"
										? (e) => {
											if (!isPlainClick(e)) return;
											e.preventDefault();
											openFeedback();
										}
										: undefined}
								>
									{l.label}
								</a>
							</li>
						))}
					</ul>
				</details>
			))}
		</nav>
	);
}
