import type { JSX } from "preact";

/**
 * HowItWorks — a Framer-style infographic mapping the Projective flow in plain language: build your
 * team → pay as you go → see it come to life (the underlying model is still the escrow-backed staged
 * engagement from PRODUCT_SPEC; only the customer-facing wording is simplified). Crisp, numbered
 * surface tiles connected by a hairline rail; each tile pairs a glyph with a short explanation.
 * Non-interactive content, so separation is spacing + tonal tint + a single rail — no boxing (§B.4).
 * Zero client JS.
 */
interface Step {
	n: string;
	title: string;
	body: string;
	glyph: JSX.Element;
}

const STEPS: Step[] = [
	{
		n: "01",
		title: "Build your team",
		body:
			"Pick your favourite helpers, or let us put a ready-made team together for you. You work with everyone as one friendly group.",
		glyph: (
			<svg viewBox="0 0 48 48" aria-hidden="true">
				<circle cx="17" cy="19" r="6" />
				<circle cx="31" cy="19" r="6" />
				<path d="M9 38c0-6 4-9 8-9s8 3 8 9M23 38c0-6 4-9 8-9s8 3 8 9" />
			</svg>
		),
	},
	{
		n: "02",
		title: "Pay as you go",
		body:
			"Break the work into small steps and pop the money for each step into a safe money box. It's only handed over once you're happy.",
		glyph: (
			<svg viewBox="0 0 48 48" aria-hidden="true">
				<rect x="9" y="16" width="30" height="22" rx="4" />
				<path d="M16 16v-3a8 8 0 0 1 16 0v3M24 24v6" />
			</svg>
		),
	},
	{
		n: "03",
		title: "See it come to life",
		body:
			"Watch your project grow step by step. When you love what you see, the money is released automatically — no awkward chasing, no surprises.",
		glyph: (
			<svg viewBox="0 0 48 48" aria-hidden="true">
				<path d="M8 26l9 9 23-23" />
				<path d="M8 38h32" />
			</svg>
		),
	},
];

export function HowItWorks(): JSX.Element {
	return (
		<section class="lp-section lp-how" id="how-it-works" aria-labelledby="lp-how-title">
			<div class="lp-section__container">
				<header class="lp-section__head lp-how__head">
					<div class="lp-section__headmain">
						<span class="lp-eyebrow">How Projective works</span>
						<h2 class="lp-section__title" id="lp-how-title">
							<span class="lp-section__title-thin">Three steps from</span>
							<span class="lp-section__title-strong">idea to done</span>
						</h2>
						<p class="lp-section__lede">
							Getting help is as easy as one, two, three — with your money kept safe every step of
							the way.
						</p>
					</div>
				</header>

				<ol class="lp-how__grid">
					{STEPS.map((s, i) => (
						<li class="lp-how__step" key={s.n}>
							<div class="lp-how__glyph">{s.glyph}</div>
							<span class="lp-how__n">{s.n}</span>
							<h3 class="lp-how__title">{s.title}</h3>
							<p class="lp-how__body">{s.body}</p>
							{i < STEPS.length - 1 && <span class="lp-how__rail" aria-hidden="true" />}
						</li>
					))}
				</ol>

				<div class="lp-how__banner">
					<div class="lp-how__banner-copy">
						<span class="lp-eyebrow">Your money's always safe</span>
						<p class="lp-how__banner-line">
							<span class="lp-hero__thin">Your money waits</span>{" "}
							<span class="lp-hero__strong">safely in the box</span>{" "}
							<span class="lp-hero__thin">until you're happy with the work.</span>
						</p>
					</div>
					<a class="lp-btn lp-btn--primary" href="/join" data-magnetic>Start a project</a>
				</div>
			</div>
		</section>
	);
}
