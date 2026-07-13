import type { JSX } from "preact";
import { Divider } from "@projective/ui/layout";

/**
 * PublicFooter — the premium, minimalist public footer. Rendered only inside the public/guest shell,
 * so it is naturally absent from the authenticated dashboard layout (auto-hide by composition, not by
 * runtime checks). Non-interactive link groups are separated by spacing + type weight, never boxed
 * (§B.4 separation hierarchy). Zero client JS.
 */
const GROUPS: { title: string; links: { label: string; href: string }[] }[] = [
	{
		title: "Platform",
		links: [
			{ label: "Explore talent", href: "/explore" },
			{ label: "Open projects", href: "/explore" },
			{ label: "Services", href: "/explore" },
			{ label: "Digital products", href: "/explore" },
		],
	},
	{
		title: "Company",
		links: [
			{ label: "About", href: "/about" },
			{ label: "How it works", href: "/help" },
			{ label: "Pricing", href: "/help" },
			{ label: "Careers", href: "/about" },
		],
	},
	{
		title: "Resources",
		links: [
			{ label: "Help center", href: "/help" },
			{ label: "Safe payments", href: "/help" },
			{ label: "Trust & safety", href: "/help" },
			{ label: "Status", href: "/help" },
		],
	},
];

export function PublicFooter(): JSX.Element {
	return (
		<footer class="lp-footer" aria-labelledby="lp-footer-brand">
			<div class="lp-footer__inner">
				<div class="lp-footer__lead">
					<span class="lp-footer__brand" id="lp-footer-brand">Projective</span>
					<p class="lp-footer__tagline">
						Build the perfect team of helpers and pay safely, a little at a time — only when you're
						happy with each step.
					</p>
					<div class="lp-footer__cta">
						<a class="lp-btn lp-btn--primary" href="/join" data-magnetic>Get started</a>
						<a class="lp-btn lp-btn--ghost" href="/login">Sign in</a>
					</div>
				</div>

				<nav class="lp-footer__nav" aria-label="Footer">
					{GROUPS.map((g) => (
						<div class="lp-footer__group" key={g.title}>
							<span class="lp-footer__group-title">{g.title}</span>
							<ul class="lp-footer__links">
								{g.links.map((l) => (
									<li key={l.label}>
										<a class="lp-footer__link" href={l.href}>{l.label}</a>
									</li>
								))}
							</ul>
						</div>
					))}
				</nav>
			</div>

			<Divider class="lp-footer__rule" />

			<div class="lp-footer__base">
				<span class="lp-footer__copy">© 2026 Projective. All rights reserved.</span>
				<div class="lp-footer__legal">
					<a class="lp-footer__link" href="/help">Privacy</a>
					<a class="lp-footer__link" href="/help">Terms</a>
					<a class="lp-footer__link" href="/help">Cookies</a>
				</div>
			</div>
		</footer>
	);
}
