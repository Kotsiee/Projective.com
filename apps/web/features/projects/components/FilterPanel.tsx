import type { JSX } from "preact";
import { WorkspaceCombo } from "./WorkspaceCombo.tsx";
import { IconMatrix } from "./IconMatrix.tsx";
import { StatusGlyph } from "./glyphs.tsx";
import { popoverActiveCount } from "../core/projects-state.ts";
import type {
	ProjectFeedParams,
	ProjectFormat,
	ProjectSort,
	ProjectStatus,
	ProjectView,
	ProjectViewerRole,
	ScopeOption,
	ServiceOption,
} from "../types/projects-types.ts";

/**
 * FilterPanel — the contents of the Smart Filter popover. A masterclass mix of input mechanics rather
 * than one flat wall of tags: a workspace tag-combo, a borderless low-contrast Role text-matrix, a
 * named Project-type text-matrix, an icon-only Status matrix, and a compact Sort segment. The
 * available inputs transform by tab — the "Clients by service" queue renders **only** on the Services
 * tab and is hidden entirely on Projects. Every change applies live to the feed; a quiet header holds
 * the active-filter count and a plain "Reset" affordance.
 */

// #region Facet vocabularies
const SORT_OPTS: readonly { value: ProjectSort; label: string }[] = [
	{ value: "recent", label: "Recent" },
	{ value: "priority", label: "Priority" },
	{ value: "alphabetical", label: "A–Z" },
];
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
// Status facet — exactly Active / Draft / Complete / Cancelled (the `on_hold`/"Paused" lifecycle
// state is intentionally not offered as a filter).
const STATUS_OPTS: readonly { value: ProjectStatus; label: string }[] = [
	{ value: "active", label: "Active" },
	{ value: "draft", label: "Draft" },
	{ value: "completed", label: "Complete" },
	{ value: "cancelled", label: "Cancelled" },
];
// #endregion

function toggleIn<T>(arr: readonly T[], value: T): T[] {
	return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

export interface FilterPanelProps {
	view: ProjectView;
	params: ProjectFeedParams;
	scopes: readonly ScopeOption[];
	services: readonly ServiceOption[];
	onApply: (next: ProjectFeedParams) => void;
	onReset: () => void;
}

export function FilterPanel(props: FilterPanelProps): JSX.Element {
	const { view, params, scopes, services, onApply, onReset } = props;
	const activeCount = popoverActiveCount(params);
	const isServices = view === "engagements";

	return (
		<div class="proj-filter">
			<header class="proj-filter__head">
				<span class="proj-filter__title">
					Filters
					{activeCount > 0 && <span class="proj-filter__count">{activeCount}</span>}
				</span>
				{activeCount > 0 && (
					<button type="button" class="proj-filter__reset" onClick={onReset}>
						Reset
					</button>
				)}
			</header>

			{/* Sort — a compact borderless segment (single-select). */}
			<div class="proj-filter__facet">
				<span class="proj-filter__facet-label">Sort by</span>
				<div class="proj-textmatrix" role="radiogroup" aria-label="Sort by">
					{SORT_OPTS.map((opt) => {
						const on = params.sort === opt.value;
						return (
							<button
								key={opt.value}
								type="button"
								role="radio"
								aria-checked={on}
								class="proj-textmatrix__opt"
								data-on={on ? "true" : undefined}
								onClick={() => onApply({ ...params, sort: opt.value })}
							>
								{opt.label}
							</button>
						);
					})}
				</div>
			</div>

			{/* Workspaces — the dropdown tag-combo. */}
			<div class="proj-filter__facet">
				<span class="proj-filter__facet-label">Workspaces &amp; teams</span>
				<WorkspaceCombo
					scopes={scopes}
					selected={params.workspaces}
					onChange={(workspaces) => onApply({ ...params, workspaces })}
				/>
			</div>

			{/* Role — a borderless low-contrast text matrix (multi-select). */}
			<div class="proj-filter__facet">
				<span class="proj-filter__facet-label">Your role</span>
				<div class="proj-textmatrix" role="group" aria-label="Your role">
					{ROLE_OPTS.map((opt) => {
						const on = params.roles.includes(opt.value);
						return (
							<button
								key={opt.value}
								type="button"
								class="proj-textmatrix__opt"
								data-on={on ? "true" : undefined}
								aria-pressed={on}
								onClick={() => onApply({ ...params, roles: toggleIn(params.roles, opt.value) })}
							>
								{opt.label}
							</button>
						);
					})}
				</div>
			</div>

			{
				/* Project type — a named multi-select text matrix (Pipeline / One-off / Session, plus any
			    future formats). Named rather than icon-only so the delivery model reads at a glance. */
			}
			<div class="proj-filter__facet">
				<span class="proj-filter__facet-label">Project type</span>
				<div class="proj-textmatrix" role="group" aria-label="Project type">
					{FORMAT_OPTS.map((opt) => {
						const on = params.formats.includes(opt.value);
						return (
							<button
								key={opt.value}
								type="button"
								class="proj-textmatrix__opt"
								data-on={on ? "true" : undefined}
								aria-pressed={on}
								onClick={() => onApply({ ...params, formats: toggleIn(params.formats, opt.value) })}
							>
								{opt.label}
							</button>
						);
					})}
				</div>
			</div>

			{/* Status — the icon-only lifecycle matrix. */}
			<IconMatrix
				label="Status"
				options={STATUS_OPTS.map((o) => ({ ...o, icon: <StatusGlyph status={o.value} /> }))}
				active={params.statuses}
				onToggle={(v) => onApply({ ...params, statuses: toggleIn(params.statuses, v) })}
			/>

			{/* Contextual — clients-by-service queue renders ONLY on the Services tab. */}
			{isServices && services.length > 0 && (
				<div class="proj-filter__facet">
					<span class="proj-filter__facet-label">Clients by service</span>
					<div class="proj-textmatrix" role="radiogroup" aria-label="Clients by service">
						<button
							type="button"
							role="radio"
							aria-checked={params.serviceId === ""}
							class="proj-textmatrix__opt"
							data-on={params.serviceId === "" ? "true" : undefined}
							onClick={() => onApply({ ...params, serviceId: "" })}
						>
							All
						</button>
						{services.map((svc) => {
							const on = params.serviceId === svc.id;
							return (
								<button
									key={svc.id}
									type="button"
									role="radio"
									aria-checked={on}
									class="proj-textmatrix__opt"
									data-on={on ? "true" : undefined}
									onClick={() => onApply({ ...params, serviceId: on ? "" : svc.id })}
								>
									{svc.name}
								</button>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
