import type { JSX } from "preact";
import { LaneFilterChoices, LaneFilterCombo, LaneFilterIcons } from "@projective/ui/navigation";
import { FormatGlyph, StatusGlyph } from "./glyphs.tsx";
import type {
	ProjectFeedParams,
	ProjectFormat,
	ProjectStatus,
	ProjectView,
	ProjectViewerRole,
	ScopeOption,
	ServiceOption,
} from "../types/projects-types.ts";

/**
 * FilterPanel — the `/projects` facets inside the shared lane filter popover (`LaneFilterPopover`
 * owns the heading, Reset and sort): workspaces, the viewer's role, the delivery model, the lifecycle
 * status, and — on the Services tab only — clients by service. Every change applies live.
 */

// #region Facet vocabularies
const ROLE_OPTS: readonly { value: ProjectViewerRole; label: string }[] = [
	{ value: "owner", label: "Owner" },
	{ value: "admin", label: "Admin" },
	{ value: "freelancer", label: "Freelancer" },
	{ value: "client", label: "Client" },
	{ value: "member", label: "Member" },
];
const FORMAT_OPTS: readonly { value: ProjectFormat; label: string }[] = [
	{ value: "pipeline", label: "Pipeline" },
	{ value: "one_off", label: "One-off" },
	{ value: "session", label: "Session" },
];
const STATUS_OPTS: readonly { value: ProjectStatus; label: string }[] = [
	{ value: "active", label: "Active" },
	{ value: "draft", label: "Draft" },
	{ value: "completed", label: "Complete" },
	{ value: "cancelled", label: "Cancelled" },
];
const ALL_SERVICES = "";
// #endregion

function toggleIn<T>(arr: readonly T[], value: T): T[] {
	return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

/** Props for {@link FilterPanel}. */
export interface FilterPanelProps {
	view: ProjectView;
	params: ProjectFeedParams;
	scopes: readonly ScopeOption[];
	services: readonly ServiceOption[];
	onApply: (next: ProjectFeedParams) => void;
}

/** The `/projects` filter facets. */
export function FilterPanel(props: FilterPanelProps): JSX.Element {
	const { view, params, scopes, services, onApply } = props;

	return (
		<>
			<LaneFilterCombo
				label="Workspaces & teams"
				options={scopes.map((s) => ({ id: s.id, label: s.label }))}
				selected={params.workspaces}
				emptyPlaceholder="All active workspaces"
				onChange={(workspaces) => onApply({ ...params, workspaces })}
			/>

			<LaneFilterChoices
				label="Your role"
				options={ROLE_OPTS}
				active={params.roles}
				onToggle={(v) => onApply({ ...params, roles: toggleIn(params.roles, v) })}
			/>

			<LaneFilterIcons
				label="Delivery model"
				options={FORMAT_OPTS.map((o) => ({ ...o, icon: <FormatGlyph format={o.value} /> }))}
				active={params.formats}
				onToggle={(v) => onApply({ ...params, formats: toggleIn(params.formats, v) })}
			/>

			<LaneFilterIcons
				label="Status"
				options={STATUS_OPTS.map((o) => ({ ...o, icon: <StatusGlyph status={o.value} /> }))}
				active={params.statuses}
				onToggle={(v) => onApply({ ...params, statuses: toggleIn(params.statuses, v) })}
			/>

			{view === "engagements" && services.length > 0 && (
				<LaneFilterChoices
					label="Clients by service"
					single
					options={[
						{ value: ALL_SERVICES, label: "All" },
						...services.map((s) => ({ value: s.id, label: s.name })),
					]}
					active={[params.serviceId]}
					onToggle={(id) =>
						onApply({
							...params,
							serviceId: id === params.serviceId ? ALL_SERVICES : id,
						})}
				/>
			)}
		</>
	);
}
