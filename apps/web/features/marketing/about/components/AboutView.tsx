import type { ComponentChildren, JSX } from "preact";
import type { PublicMetrics } from "@projective/types/marketing";
import {
	ABOUT_CONTRAST,
	ABOUT_CREDENTIALS,
	ABOUT_CREDENTIALS_LABEL,
	ABOUT_CTA,
	ABOUT_FOUNDERS,
	ABOUT_FOUNDERS_LABEL,
	ABOUT_HERO,
	ABOUT_QUOTE,
	ABOUT_TOUR_COPY,
} from "../core/about-content.ts";
import { AboutMetrics } from "./AboutMetrics.tsx";

/** Props for {@link AboutView}. */
export interface AboutViewProps {
	/** The live figures, or `null` when the read failed. */
	metrics: PublicMetrics | null;
	/**
	 * The walkthrough — the route passes the `DeliveryTour` island; a render test passes anything.
	 * It is also the page's stylesheet carrier, so the route must always render it.
	 */
	tour: ComponentChildren;
	/** Whether the viewer is signed in (the closing band's primary action differs). */
	isAuthenticated: boolean;
}

/** One full-bleed band of the page, on `--bg` or (tinted) `--surface-1`, named by its heading. */
function Band(
	props: { tint?: boolean; labelledBy: string; class?: string; children: ComponentChildren },
): JSX.Element {
	return (
		<section
			class={`abt__band${props.tint ? " abt__band--tint" : ""}${
				props.class ? ` ${props.class}` : ""
			}`}
			aria-labelledby={props.labelledBy}
		>
			<div class="abt__inner">{props.children}</div>
		</section>
	);
}

/**
 * AboutView — the `/about` manifesto page (PUBLIC_ROUTES P4, Decision #277): the opening, the
 * friction set against the model, a pull quote, the live metrics row, the delivery walkthrough,
 * the founders, the security and architecture facts, and a closing call to action. One editorial
 * column (`--measure-wide` for display, `--measure` for prose) on full-bleed bands of solid
 * alternating tones; no cards. Renders no `<main>` (the shell's) and no SEO (the route's).
 * Server-safe — imports no stylesheet and no island — so the whole page renders under `deno test`.
 */
export function AboutView({ metrics, tour, isAuthenticated }: AboutViewProps): JSX.Element {
	const ctaHref = isAuthenticated ? ABOUT_CTA.primary.memberHref : ABOUT_CTA.primary.guestHref;
	return (
		<div class="abt">
			<header class="abt__band abt-hero">
				<div class="abt__inner">
					<p class="abt__label">{ABOUT_HERO.eyebrow}</p>
					<h1 class="abt-hero__title">{ABOUT_HERO.title}</h1>
					<p class="abt-hero__standfirst">{ABOUT_HERO.standfirst}</p>
				</div>
			</header>

			<Band tint labelledBy={`abt-${ABOUT_CONTRAST[0].id}`}>
				<div class="abt-contrast">
					{ABOUT_CONTRAST.map((side) => (
						<div class="abt-contrast__side" key={side.id}>
							<h2 class="abt__label" id={`abt-${side.id}`}>{side.label}</h2>
							<ul class="abt-contrast__list">
								{side.statements.map((statement) => (
									<li class="abt-contrast__item" key={statement}>{statement}</li>
								))}
							</ul>
						</div>
					))}
				</div>
			</Band>

			<section class="abt__band" aria-label="In our words">
				<div class="abt__inner">
					<figure class="abt-quote">
						<blockquote class="abt-quote__body">
							<p class="abt-quote__text">“{ABOUT_QUOTE.text}”</p>
						</blockquote>
						<figcaption class="abt-quote__cite">— {ABOUT_QUOTE.attribution}</figcaption>
					</figure>
				</div>
			</section>

			<Band tint labelledBy="abt-metrics-heading">
				<AboutMetrics metrics={metrics} headingId="abt-metrics-heading" />
			</Band>

			<Band labelledBy="abt-tour-heading">
				<h2 class="abt__label" id="abt-tour-heading">{ABOUT_TOUR_COPY.label}</h2>
				<p class="abt__lead">{ABOUT_TOUR_COPY.lead}</p>
				{tour}
			</Band>

			<Band tint labelledBy="abt-founders-heading">
				<h2 class="abt__label" id="abt-founders-heading">{ABOUT_FOUNDERS_LABEL}</h2>
				<ul class="abt-founders">
					{ABOUT_FOUNDERS.map((founder) => (
						<li class="abt-founder" key={founder.id}>
							<img
								class="abt-founder__avatar"
								src={founder.avatar.src}
								width={founder.avatar.w}
								height={founder.avatar.h}
								alt=""
								loading="lazy"
								decoding="async"
							/>
							<div>
								<h3 class="abt-founder__name">{founder.name}</h3>
								<p class="abt-founder__role">{founder.role}</p>
								<p class="abt-founder__bio">{founder.bio}</p>
							</div>
						</li>
					))}
				</ul>
			</Band>

			<Band labelledBy="abt-creds-heading">
				<h2 class="abt__label" id="abt-creds-heading">{ABOUT_CREDENTIALS_LABEL}</h2>
				<dl class="abt-creds">
					{ABOUT_CREDENTIALS.map((cred) => (
						<div class="abt-cred" key={cred.id}>
							<dt class="abt-cred__title">{cred.title}</dt>
							<dd class="abt-cred__body">
								{cred.body}
								{cred.link && (
									<>
										{" "}
										<a class="abt-cred__link" href={cred.link.href}>{cred.link.label}</a>
									</>
								)}
							</dd>
						</div>
					))}
				</dl>
			</Band>

			<Band tint labelledBy="abt-cta-heading">
				<h2 class="abt-cta__title" id="abt-cta-heading">{ABOUT_CTA.title}</h2>
				<p class="abt-cta__body">{ABOUT_CTA.body}</p>
				<div class="abt-cta__actions">
					<a
						class="ui-button ui-button--neutral ui-button--outlined ui-button--size-lg"
						href={ABOUT_CTA.secondary.href}
					>
						<span class="ui-button__label">{ABOUT_CTA.secondary.label}</span>
					</a>
					<a
						class="ui-button ui-button--primary ui-button--filled ui-button--size-lg"
						href={ctaHref}
					>
						<span class="ui-button__label">{ABOUT_CTA.primary.label}</span>
					</a>
				</div>
			</Band>
		</div>
	);
}
