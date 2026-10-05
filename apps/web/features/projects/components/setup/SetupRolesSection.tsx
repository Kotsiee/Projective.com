import type { JSX } from "preact";
import { Chips, InputText, NumberInput, Textarea } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { currencyExponent, toMinorUnits } from "@projective/types/finance";
import {
	ROLE_INSTRUCTIONS_MAX,
	ROLE_SECTION_LABEL,
	teamRolesRequired,
} from "../../types/projects-types.ts";
import type { ProjectRoleSetup, ProjectSetup } from "../../types/projects-types.ts";
import { patchSetup } from "../../core/setup-state.ts";
import { fieldStatus } from "../../core/setup-validation.ts";
import { Field, newRoleId, Section } from "./setup-primitives.tsx";
import {
	minorUnit,
	MONEY_FIELD,
	ROLE_BONUS_HINT,
	ROLE_INSTRUCTIONS_PLACEHOLDER,
	roleBonusLabel,
	roleInstructionsLabel,
	toMajor,
} from "./setup-format.ts";

/**
 * SetupRolesSection — the project-level staffing roles a Direct Deliverable takes in place of a stage
 * run.
 */

// #region Role list
/**
 * The staffing roles a Direct Deliverable takes instead of a stage run.
 *
 * On a one-off without milestones the roles are OPTIONAL (`teamRolesRequired`, the same rule the
 * ladder reads): the empty state says so rather than implying an omission, because the section's
 * hint and its empty copy are the two places an owner learns whether the list is standing between
 * them and publishing.
 */
export function RoleListSection(
	{ setup, hint }: { setup: ProjectSetup; hint?: string },
): JSX.Element {
	const currency = setup.budget.currency;
	const exponent = currencyExponent(currency);
	const optional = !teamRolesRequired(setup.format, setup.structure);

	const add = () => {
		patchSetup({
			roles: [...setup.roles, {
				id: newRoleId(),
				name: `Role ${setup.roles.length + 1}`,
				skills: [],
				description: "",
				budgetCents: null,
			}],
		});
	};

	const patchRow = (id: string, patch: Partial<ProjectRoleSetup>) => {
		patchSetup({ roles: setup.roles.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
	};

	const remove = (id: string) => {
		patchSetup({ roles: setup.roles.filter((r) => r.id !== id) });
	};

	return (
		<Section
			sectionKey="roles"
			title={ROLE_SECTION_LABEL}
			hint={hint}
			hintTone={optional ? "note" : "gate"}
		>
			<ul class="psu-list" aria-label={ROLE_SECTION_LABEL}>
				{setup.roles.map((role) => {
					const nameKey = `role:${role.id}:name`;
					return (
						<li key={role.id} class="psu-role">
							<div class="psu-role__head">
								<Field label="Role name" htmlFor={`psu-role-${role.id}-name`} fieldKey={nameKey}>
									<InputText
										id={`psu-role-${role.id}-name`}
										value={role.name}
										onValueChange={(name: string) => patchRow(role.id, { name })}
										block
										maxLength={120}
										placeholder="e.g. Lead designer"
										status={fieldStatus(nameKey, role.name.trim() ? "default" : "required")}
									/>
								</Field>
								<button
									type="button"
									class="psu-stage__remove"
									aria-label={`Remove ${role.name || "role"}`}
									onClick={() => remove(role.id)}
								>
									<Icon name="trash" />
								</button>
							</div>

							<div class="psu-row">
								<Field label="Skills">
									<Chips
										value={role.skills}
										onValueChange={(skills: string[]) => patchRow(role.id, { skills })}
										placeholder="Add a skill…"
										max={20}
										addOnBlur
										aria-label={`Skills for ${role.name || "role"}`}
									/>
								</Field>
								{
									/*
									 * `default`, never `gate`. The amber ramp says "publishing is waiting on this",
									 * and it is not: a role bonus is optional and {@link setupSteps} does not count
									 * it. Painting it would report a requirement the ladder one region away says
									 * does not exist.
									 */
								}
								<Field
									label="Role bonus"
									htmlFor={`psu-role-${role.id}-budget`}
									hint={ROLE_BONUS_HINT}
								>
									<NumberInput
										{...MONEY_FIELD}
										id={`psu-role-${role.id}-budget`}
										value={toMajor(role.budgetCents, currency)}
										onValueChange={(v: number | null) =>
											patchRow(role.id, { budgetCents: toMinorUnits(v, currency) })}
										currency={currency}
										maxFractionDigits={exponent}
										minFractionDigits={exponent}
										precisionStep={minorUnit(currency)}
										aria-label={roleBonusLabel(role.name)}
									/>
								</Field>
							</div>

							<Field label="Additional instructions" htmlFor={`psu-role-${role.id}-notes`}>
								<Textarea
									id={`psu-role-${role.id}-notes`}
									value={role.description}
									onValueChange={(description: string) => patchRow(role.id, { description })}
									rows={2}
									maxLength={ROLE_INSTRUCTIONS_MAX}
									placeholder={ROLE_INSTRUCTIONS_PLACEHOLDER}
									aria-label={roleInstructionsLabel(role.name)}
								/>
							</Field>
						</li>
					);
				})}
				{setup.roles.length === 0 && (
					<li class="psu-list__empty">
						{optional
							? "No roles yet — and none are needed to publish. Add one only if this deliverable calls for specific seats."
							: "No roles yet. A direct deliverable is staffed by roles rather than by stages."}
					</li>
				)}
			</ul>

			<button type="button" class="psu-add" onClick={add}>
				<Icon name="plus" />
				Add role
			</button>
		</Section>
	);
}
// #endregion
