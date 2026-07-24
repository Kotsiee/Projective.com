import type { JSX } from "preact";
import { Tooltip } from "@projective/ui/feedback";
import { fundStateMeta } from "../core/wallet-model.ts";
import { InfoIcon } from "./wallet-glyphs.tsx";
import type { FundState, MoneyView } from "../types/wallet-types.ts";

/**
 * wallet-bits — the small shared display primitives every Wallet surface renders: a {@link Money} value
 * (the display-currency string the server formatted, with an origin-currency hover for cross-currency
 * figures — the client NEVER re-computes the amount), a fund-state chip, a hairline-separated meta row,
 * and a tonal section card. Presentation only; no data access.
 */

// #region Money
/**
 * Render a server-formatted {@link MoneyView}. When the underlying figure was priced in another currency,
 * the origin `(amount, rate)` is disclosed on hover — the client only ever renders strings the fat
 * service produced (conversion + formatting are the service's, finance-model.md §11).
 */
export function Money(
	{ value, class: cls, muted }: { value: MoneyView; class?: string; muted?: boolean },
): JSX.Element {
	const body = (
		<span class={`wallet-money${muted ? " wallet-money--muted" : ""}${cls ? ` ${cls}` : ""}`}>
			{value.display}
			{value.origin && <InfoIcon size={12} class="wallet-money__fx" />}
		</span>
	);
	if (!value.origin) return body;
	return (
		<Tooltip
			content={`Priced ${value.origin.display} · rate ${value.origin.fxRate}`}
			placement="top"
		>
			{body}
		</Tooltip>
	);
}
// #endregion

// #region Fund-state chip
/** A tonal chip naming a fund state (§B.6 icon-first status; the word lives in the chip, tone in colour). */
export function FundStateChip(
	{ state, class: cls }: { state: FundState; class?: string },
): JSX.Element {
	const m = fundStateMeta(state);
	return (
		<span class={`wallet-chip${cls ? ` ${cls}` : ""}`} data-tone={m.tone}>
			{m.label}
		</span>
	);
}
// #endregion

// #region Section card + heading
/** A tonal-surface section (separated by tint + a single hairline, not a four-sided box — §B.4). */
export function SectionCard(
	{ title, action, class: cls, children }: {
		title?: string;
		action?: JSX.Element;
		class?: string;
		children: preact.ComponentChildren;
	},
): JSX.Element {
	return (
		<section class={`wallet-card${cls ? ` ${cls}` : ""}`}>
			{(title || action) && (
				<header class="wallet-card__head">
					{title && <h2 class="wallet-card__title">{title}</h2>}
					{action}
				</header>
			)}
			{children}
		</section>
	);
}
// #endregion

// #region Meta row
/** A label · value row separated from its neighbours by an ultra-faint hairline. */
export function MetaRow(
	{ label, children }: { label: string; children: preact.ComponentChildren },
): JSX.Element {
	return (
		<div class="wallet-metarow">
			<span class="wallet-metarow__label">{label}</span>
			<span class="wallet-metarow__value">{children}</span>
		</div>
	);
}
// #endregion

// #region Meter (utilization bar)
/**
 * A single-value utilization bar (a track + a fill), token-only. `ratioBp` is basis points (0–10000);
 * the fill tone escalates to `--warning` past 80% and `--danger` past 100% (over-budget). The percentage
 * is server-derived — the client only renders the width.
 */
export function Meter(
	{ ratioBp, label, class: cls }: { ratioBp: number; label?: string; class?: string },
): JSX.Element {
	const pct = Math.min(100, Math.round(ratioBp / 100));
	const tone = ratioBp >= 10000 ? "danger" : ratioBp >= 8000 ? "warning" : "ok";
	return (
		<div class={`wallet-meter${cls ? ` ${cls}` : ""}`} data-tone={tone}>
			<div
				class="wallet-meter__track"
				role="meter"
				aria-valuenow={pct}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-label={label ?? "Utilization"}
			>
				<span class="wallet-meter__fill" style={`inline-size:${Math.min(100, ratioBp / 100)}%`} />
			</div>
		</div>
	);
}
// #endregion
