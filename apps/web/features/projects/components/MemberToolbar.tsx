import type { JSX } from "preact";
import type { Signal } from "@preact/signals";
import { InputText, MultiSelect, Select, SortControl } from "@projective/ui/fields";
import type { MemberStageRef } from "../types/projects-types.ts";
import { ROLE_FILTER_OPTIONS } from "../core/member-model.ts";
import { SearchIcon } from "./file-glyphs.tsx";

/**
 * MemberToolbar — the roster's control bar, rendered as the SHARED `.fx-toolbar` the File Explorer and
 * the Submissions explorer draw (borderless search · bare filter fields · `SortControl`), so the three
 * surfaces read as one system rather than lookalikes. The role filter is offered where a role exists
 * on the rows (Members, Invitations), the stage filter only where stages are a dimension of the
 * engagement (a pipeline); the sort choices follow the section.
 */
export interface MemberToolbarProps {
	query: Signal<string>;
	placeholder: string;
	roleFilter: Signal<string[]>;
	showRoles: boolean;
	stageFilter: Signal<string>;
	stages: readonly MemberStageRef[];
	showStages: boolean;
	sortKey: Signal<string>;
	sortDir: Signal<"asc" | "desc">;
	sortOptions: ReadonlyArray<{ value: string; label: string }>;
}

export function MemberToolbar(props: MemberToolbarProps): JSX.Element {
	return (
		<div class="fx-toolbar">
			<div class="fx-toolbar__search">
				<InputText
					type="search"
					variant="bare"
					size="sm"
					block
					placeholder={props.placeholder}
					aria-label={props.placeholder.replace(/…$/, "")}
					value={props.query}
					start={
						<span class="fx-toolbar__searchicon" aria-hidden="true">
							<SearchIcon size={16} />
						</span>
					}
				/>
			</div>
			<span class="fx-toolbar__spacer" />
			{props.showRoles && (
				<MultiSelect
					class="ui-field--bare"
					size="sm"
					display="chip"
					placeholder="All roles"
					aria-label="Filter by role"
					options={ROLE_FILTER_OPTIONS.map((r) => ({ label: r.label, value: r.value }))}
					value={props.roleFilter}
				/>
			)}
			{props.showStages && props.stages.length > 0 && (
				<Select
					class="ui-field--bare"
					size="sm"
					placeholder="All stages"
					aria-label="Filter by stage"
					options={[
						{ label: "All stages", value: "" },
						...props.stages.map((s) => ({ label: s.name, value: s.name })),
					]}
					value={props.stageFilter}
				/>
			)}
			<SortControl
				size="sm"
				options={[...props.sortOptions]}
				value={props.sortKey}
				direction={props.sortDir}
			/>
		</div>
	);
}
