import type { JSX } from "preact";
import { NavItem } from "@projective/ui/navigation";
import {
	hubSignal,
	type LaneHubRow,
	type ModuleSignals,
	signalLabel,
} from "../../core/lane-model.ts";
import { cloneGlyph } from "../../core/workspace-glyphs.tsx";

/**
 * HubList — one lane section's hubs as `NavItem` rows (glyph + label), the current hub marked
 * `aria-current="page"`. A hub's mark folds its modules' marks (`hubSignal`): a queue's size as plain
 * tabular text at the row's end, an attention mark as a dot, both in the row's accessible name (§B.6).
 */
export function HubList(
	props: { rows: readonly LaneHubRow[]; signals: ModuleSignals },
): JSX.Element {
	return (
		<ul class="wsp-lane__navlist" role="list">
			{props.rows.map((row) => {
				const signal = hubSignal(row.modules, props.signals);
				const mark = signalLabel(signal);
				return (
					<li key={row.key}>
						<NavItem
							href={row.href}
							label={row.label}
							icon={cloneGlyph(row.glyph)}
							active={row.active}
							dot={mark !== null}
							dotLabel={mark ?? undefined}
							trailing={signal?.count
								? <span class="wsp-lane__navcount">{signal.count}</span>
								: signal?.dot
								? <span class="wsp-pulse" />
								: undefined}
						/>
					</li>
				);
			})}
		</ul>
	);
}
