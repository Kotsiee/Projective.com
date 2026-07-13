import type { CSSProperties, JSX, VNode } from "preact";
import "../styles/metergroup.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { severityToken } from "../../fields/core/field.ts";
import type { Severity } from "../../fields/types/mod.ts";

export type MeterGroupOrientation = "horizontal" | "vertical";

// #region Types
export interface MeterItem {
	label: string;
	value: number;
	/** A CSS token reference for the segment/swatch colour, e.g. `"var(--success)"` — never a hex. */
	color?: string;
	/** Semantic alternative to `color`; resolves to the matching severity token. */
	severity?: Severity;
	icon?: VNode;
}

export interface MeterGroupProps {
	value: MeterItem[];
	/** Scale minimum (default `0`). */
	min?: number;
	/** Scale maximum (default `100`). */
	max?: number;
	orientation?: MeterGroupOrientation;
	/** Custom legend row renderer, replacing the default swatch + label + value. */
	labelTemplate?: (item: MeterItem, index: number) => VNode;
	/** Custom segment renderer, replacing the default coloured bar. */
	meterTemplate?: (item: MeterItem, index: number, percent: number) => VNode;
	"aria-label"?: string;
	id?: string;
	class?: string;
	style?: CSSProperties;
}
// #endregion

const DEFAULT_RAMP = ["primary", "secondary", "tertiary", "success", "warning"];

function resolveColor(item: MeterItem, index: number): string {
	if (item.color) return item.color;
	if (item.severity) return `var(--${severityToken(item.severity)})`;
	return `var(--${DEFAULT_RAMP[index % DEFAULT_RAMP.length]})`;
}

/**
 * MeterGroup — a zero-JS segmented multi-value meter (stacked-bar gauge + legend). Each segment's
 * width/height is a percentage of `max - min`, driven via the `--meter-size`/`--meter-color` custom
 * properties (token references only — no hex). The track carries `role="img"` with a generated
 * `aria-label` summarising every value (composite meters have no single numeric `aria-valuenow`, so
 * `meter`'s single-value semantics don't apply); the legend is plain readable text, not hidden from
 * assistive tech.
 */
export function MeterGroup(props: MeterGroupProps): JSX.Element {
	const {
		value,
		min = 0,
		max = 100,
		orientation = "horizontal",
		labelTemplate,
		meterTemplate,
		"aria-label": ariaLabel,
		id,
		class: className,
		style,
	} = props;

	const span = Math.max(1e-6, max - min);
	const total = value.reduce((s, v) => s + v.value, 0);
	const summary = ariaLabel ??
		`${total} of ${max} — ${value.map((v) => `${v.label} ${v.value}`).join(", ")}`;

	return (
		<div
			id={id}
			class={cx("ui-metergroup", `ui-metergroup--${orientation}`, className)}
			style={style}
		>
			<div class="ui-metergroup__track" role="img" aria-label={summary}>
				{value.map((item, i) => {
					const pct = clampPct(((item.value - min) / span) * 100);
					return meterTemplate ? meterTemplate(item, i, pct) : (
						<span
							key={i}
							class="ui-metergroup__segment"
							style={styleVars({
								"--meter-size": `${pct}%`,
								"--meter-color": resolveColor(item, i),
							})}
						/>
					);
				})}
			</div>

			<ul class="ui-metergroup__legend">
				{value.map((item, i) =>
					labelTemplate ? labelTemplate(item, i) : (
						<li key={i} class="ui-metergroup__legend-item">
							<span
								class="ui-metergroup__swatch"
								aria-hidden="true"
								style={styleVars({ "--meter-color": resolveColor(item, i) })}
							/>
							{item.icon && <span class="ui-metergroup__icon">{item.icon}</span>}
							<span class="ui-metergroup__legend-label">{item.label}</span>
							<span class="ui-metergroup__legend-value">{item.value}</span>
						</li>
					)
				)}
			</ul>
		</div>
	);
}

function clampPct(v: number): number {
	return Math.max(0, Math.min(100, v));
}
