import type { JSX } from "preact";
import { useMediaQuery } from "@projective/ui/hooks";
import { ChevronIcon } from "../components/footer-icons.tsx";
import "../styles/footer.css";

/** One footer quick-link stack. */
export interface FooterLinkGroup {
	title: string;
	links: { label: string; href: string }[];
}

/**
 * FooterLinkGroups — the footer's quick-link stacks: open columns from `--bp-md` (768px) up,
 * collapsible `<details>` accordions below it.
 *
 * The stylesheet shows the columns on first paint through `::details-content`; this island makes the
 * semantics agree once hydrated. On a wide viewport each group carries `open`, its summary leaves the
 * tab order and a click on it does nothing, so a heading never announces itself as a collapsed control
 * over links that are already visible.
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
								<a class="lp-footer__link" href={l.href}>{l.label}</a>
							</li>
						))}
					</ul>
				</details>
			))}
		</nav>
	);
}
