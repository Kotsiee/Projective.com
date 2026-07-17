import type { JSX, VNode } from "preact";
import { Tooltip } from "@projective/ui/feedback";

/**
 * IconMatrix — a compact row of icon-only toggle buttons for a facet whose options read best as
 * glyphs (Format: pipeline / one-off / session; Status: the lifecycle marks). Each option is a custom
 * SVG backed by a floating `@projective/ui` {@link Tooltip} carrying its label, so the popover stays
 * visual and uncluttered instead of stacking text tags. Active options gain colour + a soft tonal
 * tint (no hard border on the resting state — §B.4).
 */

export interface IconMatrixOption<T extends string> {
	value: T;
	label: string;
	icon: VNode;
}

export interface IconMatrixProps<T extends string> {
	label: string;
	options: readonly IconMatrixOption<T>[];
	active: readonly T[];
	onToggle: (value: T) => void;
}

export function IconMatrix<T extends string>(props: IconMatrixProps<T>): JSX.Element {
	const set = new Set(props.active);
	return (
		<div class="proj-filter__facet">
			<span class="proj-filter__facet-label">{props.label}</span>
			<div class="proj-matrix" role="group" aria-label={props.label}>
				{props.options.map((opt) => {
					const on = set.has(opt.value);
					return (
						<Tooltip key={opt.value} content={opt.label} placement="bottom">
							<button
								type="button"
								class="proj-matrix__btn"
								data-on={on ? "true" : undefined}
								aria-pressed={on}
								aria-label={opt.label}
								onClick={() => props.onToggle(opt.value)}
							>
								{opt.icon}
							</button>
						</Tooltip>
					);
				})}
			</div>
		</div>
	);
}
