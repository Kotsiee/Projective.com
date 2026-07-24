import type { JSX } from "preact";
import { LaneTabs as UiLaneTabs } from "@projective/ui/navigation";
import type { ProjectView } from "../types/projects-types.ts";

/**
 * LaneTabs — the two friendly, plain-language tabs at the very peak of the projects lane. `Projects`
 * (work the actor commissions or contributes to) vs. `Services` (the provider-side client engagements
 * the actor delivers).
 *
 * A thin domain adapter over the shared `@projective/ui/navigation` {@link UiLaneTabs}: the quiet
 * sliding underline, weights, and focus ring are owned by the package, so this strip and the
 * `/messages` inbox partitions render from ONE implementation (§B.4 — no boxes on non-interactive
 * chrome).
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
		<UiLaneTabs
			label="Projects and services"
			value={view}
			options={TABS}
			onSelect={onSelect}
		/>
	);
}
