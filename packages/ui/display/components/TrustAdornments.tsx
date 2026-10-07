import type { JSX } from "preact";
import "../styles/trust-adornments.css";
import { cx } from "../../core/cx.ts";
import { Icon } from "../../icons/mod.ts";
import type { IconName } from "../../icons/mod.ts";
import { Tooltip } from "../../feedback/islands/Tooltip.tsx";

// #region Props
/** One earned trust signal. */
export interface TrustAdornmentItem {
	/** Stable key (the signal's slug). */
	id: string;
	/** The inline claim ("Fast replies"). */
	label: string;
	/** What earned it — shown on demand in a portal tooltip. */
	description: string;
	/** The dimension's registry glyph. */
	icon: IconName;
}

/** Props for {@link TrustAdornments}. */
export interface TrustAdornmentsProps {
	/** The signals, already ranked and capped by the caller. Empty renders nothing. */
	items: readonly TrustAdornmentItem[];
	/** Accessible name for the list (default "Trust signals"). */
	label?: string;
	class?: string;
}
// #endregion

/**
 * TrustAdornments — earned trust signals as one inline Meta-register line (DESIGN_SYSTEM §B.11.2 /
 * §B.11.4): `--text-sm` · `--fw-normal` · `--text-secondary`, each signal an inline glyph and its
 * claim, middot-separated, every claim explained by a portal `Tooltip`. No fill, no pill, no badge
 * row — a signal is a summary of history, never dressed as a control or a lifecycle status.
 */
export function TrustAdornments(
	{ items, label = "Trust signals", class: className }: TrustAdornmentsProps,
): JSX.Element | null {
	if (items.length === 0) return null;
	return (
		<ul class={cx("ui-trust", className)} aria-label={label}>
			{items.map((item, i) => (
				<li key={item.id} class="ui-trust__item">
					{i > 0 ? <span class="ui-trust__sep" aria-hidden="true">·</span> : null}
					<Tooltip content={item.description} placement="top">
						<span class="ui-trust__signal" tabIndex={0}>
							<Icon name={item.icon} size="xs" />
							<span>{item.label}</span>
						</span>
					</Tooltip>
				</li>
			))}
		</ul>
	);
}
