import type { JSX } from "preact";
import type { ProjectView } from "../types/projects-types.ts";

/**
 * LaneTabs — the two friendly, plain-language tabs at the very peak of the projects lane. `Projects`
 * (work the actor commissions or contributes to) vs. `Services` (the provider-side client engagements
 * the actor delivers). A quiet sliding underline marks the active tab; no filled pill, no count — the
 * lane stays calm and spacious (DESIGN_SYSTEM.md §B.4: no boxes on non-interactive chrome).
 */

const TABS: readonly { value: ProjectView; label: string }[] = [
	{ value: "projects", label: "Projects" },
	{ value: "engagements", label: "Services" },
];

export interface LaneTabsProps {
	view: ProjectView;
	onSelect: (view: ProjectView) => void;
}

export function LaneTabs({ view, onSelect }: LaneTabsProps): JSX.Element {
	return (
		<div class="proj-tabs" role="tablist" aria-label="Projects and services">
			{TABS.map((tab) => {
				const selected = view === tab.value;
				return (
					<button
						key={tab.value}
						type="button"
						role="tab"
						aria-selected={selected}
						class="proj-tabs__tab"
						data-selected={selected ? "true" : undefined}
						onClick={() => onSelect(tab.value)}
					>
						{tab.label}
					</button>
				);
			})}
		</div>
	);
}
