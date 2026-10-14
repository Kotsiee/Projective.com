import type { JSX } from "preact";
import { Button, InputText, NumberStepper } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { STAGES_MAX } from "@projective/types/catalogue";
import type { TeamRole } from "../../../types/catalogue-types.ts";
import { addItem, newTeamRole, patchItem, removeItem } from "../../../core/offer-model.ts";
import { SkillTags } from "./SkillTags.tsx";

/** Props for {@link TeamRolesEditor}. */
export interface TeamRolesEditorProps {
	roles: readonly TeamRole[];
	onChange: (roles: readonly TeamRole[]) => void;
	/** The first unsaveable role's sentence, keyed by its index. */
	problemAt?: { index: number; message: string } | null;
}

function RoleRow(
	props: {
		index: number;
		role: TeamRole;
		problem: string | null;
		onPatch: (patch: Partial<TeamRole>) => void;
		onRemove: () => void;
	},
): JSX.Element {
	const { index, role } = props;
	const base = `cat-offer-role-${index}`;
	const label = role.name.trim() || `Role ${index + 1}`;
	return (
		<li class="cat-offer__role">
			<div class="cat-offer__step-head">
				<InputText
					id={`${base}-name`}
					value={role.name}
					onValueChange={(name) => props.onPatch({ name })}
					maxLength={80}
					placeholder="Role, e.g. Illustrator"
					aria-label={`Role ${index + 1} name`}
					aria-describedby={props.problem ? `${base}-problem` : undefined}
					status={props.problem ? "invalid" : "default"}
					fluid
				/>
				<button
					type="button"
					class="cat-offer__remove"
					aria-label={`Remove ${label}`}
					onClick={props.onRemove}
				>
					<Icon name="close" size="2xs" />
				</button>
			</div>
			{props.problem && <p class="cat-offer__problem" id={`${base}-problem`}>{props.problem}</p>}
			<InputText
				value={role.summary}
				onValueChange={(summary) => props.onPatch({ summary })}
				maxLength={240}
				placeholder="What this person does"
				aria-label={`${label} summary`}
				fluid
			/>
			<div class="cat-sec__field">
				<label class="cat-sec__label" for={`${base}-count`}>People</label>
				<div class="cat-offer__compact">
					<NumberStepper
						id={`${base}-count`}
						value={role.count}
						onValueChange={(n) => props.onPatch({ count: n ?? 1 })}
						min={1}
						max={20}
						unit={role.count === 1 ? "person" : "people"}
					/>
				</div>
			</div>
			<SkillTags
				id={`${base}-skills`}
				value={role.skills}
				onChange={(skills) => props.onPatch({ skills })}
				aria-label={`${label} skills`}
			/>
		</li>
	);
}

/**
 * TeamRolesEditor — the named roles on a Direct Deliverable's or a Pipeline's team: each a name, how
 * many people fill it, a one-line summary and its skills. Unboxed rows separated by spacing; at most
 * twelve roles.
 */
export function TeamRolesEditor(props: TeamRolesEditorProps): JSX.Element {
	const { roles, onChange } = props;
	return (
		<div class="cat-offer__roles-wrap">
			{roles.length > 0 && (
				<ul class="cat-offer__roles" aria-label="Team roles">
					{roles.map((role, i) => (
						<RoleRow
							key={i}
							index={i}
							role={role}
							problem={props.problemAt?.index === i ? props.problemAt.message : null}
							onPatch={(patch) => onChange(patchItem(roles, i, patch))}
							onRemove={() => onChange(removeItem(roles, i))}
						/>
					))}
				</ul>
			)}
			{roles.length < STAGES_MAX && (
				<Button
					label="Add role"
					icon={<Icon name="plus" size="xs" />}
					variant="text"
					size="sm"
					onClick={() => onChange(addItem(roles, newTeamRole(roles.length + 1), STAGES_MAX))}
				/>
			)}
		</div>
	);
}
