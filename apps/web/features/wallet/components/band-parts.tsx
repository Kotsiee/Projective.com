import type { ComponentChildren, JSX } from "preact";
import { cx } from "@ui/core/cx.ts";
import { styleVars } from "@ui/core/style.ts";
import { Alert } from "@projective/ui/feedback";

/**
 * band-parts — the band-stack frame primitives (BUILD CONTRACT §4).
 *
 * A band is FULL-BLEED. `Band` deliberately exposes no width prop and `.wlt-band__inner` carries no
 * `max-inline-size` — constraining a band is the anti-goal this whole architecture exists to remove
 * (§12.3). Running text and form fields get their max-widths from `.wlt-prose` / `.wlt-formfield`,
 * and RULE L-1 forbids a money figure, chart or table from being their descendant.
 */

// #region Band
export interface BandProps {
	/** The band's role, which selects its tonal step and its separator. */
	tone: "hero" | "flow" | "intel" | "ledger" | "accounts" | "page" | "head";
	/** Index in the stack — drives the 40ms staggered entrance. */
	index?: number;
	/** Accessible label for the band's `<section>`; omitted bands fall back to `aria-label`. */
	titleId?: string;
	label?: string;
	class?: string;
	children: ComponentChildren;
}

export function Band(props: BandProps): JSX.Element {
	return (
		<section
			class={cx("wlt-band", `wlt-band--${props.tone}`, props.class)}
			style={styleVars({ "--wlt-band-i": props.index ?? 0 })}
			aria-labelledby={props.titleId}
			aria-label={props.titleId ? undefined : props.label}
		>
			<div class="wlt-band__inner">{props.children}</div>
		</section>
	);
}
// #endregion

// #region Band head
export interface BandHeadProps {
	id: string;
	title: string;
	/** Right-aligned supporting figures. Never a control — controls live in the chrome (§4.6). */
	meta?: ComponentChildren;
}

export function BandHead(props: BandHeadProps): JSX.Element {
	return (
		<div class="wlt-band__head">
			<h2 class="wlt-band__title" id={props.id}>{props.title}</h2>
			{props.meta && <div class="wlt-band__meta wlt-num">{props.meta}</div>}
		</div>
	);
}
// #endregion

// #region Page head (deep pages)
export interface PageHeadProps {
	title: string;
	meta?: ComponentChildren;
}

/**
 * The deep pages' one heading. Deliberately inert: section navigation is the lane's job, filtering
 * the header band's, and every action the footer rig's (§6).
 */
export function PageHead(props: PageHeadProps): JSX.Element {
	return (
		<div class="wlt-pagehead">
			<h1 class="wlt-pagehead__title">{props.title}</h1>
			{props.meta && <div class="wlt-pagehead__meta wlt-num">{props.meta}</div>}
		</div>
	);
}
// #endregion

// #region Empty / error / locked states
/** An empty band. Never a centred cartoon — the band's own rhythm stays, with one honest line. */
export function EmptyBand(props: { text: string; hint?: string }): JSX.Element {
	return (
		<div class="wlt-empty">
			<p class="wlt-empty__text">{props.text}</p>
			{props.hint && <p class="wlt-empty__hint">{props.hint}</p>}
		</div>
	);
}

/**
 * A BAND-SCOPED error. Every other band keeps rendering: a wallet that blanks entirely because one
 * fetch failed destroys the sense of custody the whole surface is built to produce (§9).
 */
export function BandError(props: { message: string; retryHref: string }): JSX.Element {
	return (
		<div class="wlt-error">
			<Alert severity="danger" class="wlt-error__alert">{props.message}</Alert>
			<a class="wlt-error__retry" href={props.retryHref}>Try again</a>
		</div>
	);
}
// #endregion
