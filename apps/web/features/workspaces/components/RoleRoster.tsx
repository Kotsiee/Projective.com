import type { JSX } from "preact";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { RolesAction, RosterSection } from "../core/roles-model.ts";
import { rolesTierProps } from "../core/roles-model.ts";

/**
 * RoleRoster — the Roles screen's master pane (Decisions #320, #321): every role the entity has, as a
 * list the reader picks one from, sticky beside the canvas while the canvas scrolls.
 *
 * Two headed runs from `rosterSections`: **Preset roles** (each name led by a padlock — fixed,
 * read-only) and **Custom roles** ("None yet." while empty), and under the custom run a slim tier-5
 * **New role** for a `manage_roles` holder — a list affordance beside the list it adds to. Each row
 * is ONE pressable: the role's name, a dot while it holds unsaved changes, and the count of members
 * holding it as a plain tabular figure (its words visually hidden beside it). The remit is the
 * canvas's to say, so the list stays one line a role.
 *
 * The selected row is `aria-current="true"` and controls the canvas (`aria-controls`), and pressing a
 * row only selects — the island decides whether the canvas also takes focus (the narrow drill-down).
 * Rows are native `<button>`s because a row is rich content the ui `Button`'s single-label geometry
 * does not hold; the press is the shared scale compression (§B.12).
 */

export interface RoleRosterProps {
	sections: readonly RosterSection[];
	/** The selected role's id. */
	selected: string | null;
	/** The canvas the rows control. */
	canvasId: string;
	/** `newRoleAction` — `null` draws no New role. */
	create: RolesAction | null;
	onCreate: () => void;
	onSelect: (id: string) => void;
}

export function RoleRoster(props: RoleRosterProps): JSX.Element {
	return (
		<section class="wsp-roles__master" aria-label="Role list">
			{props.sections.map((section) => (
				<div key={section.key} class="wsp-roles__section">
					<h2 class="wsp-roles__section-head">{section.title}</h2>
					{section.rows.length === 0
						? section.empty && <p class="wsp-roles__empty">{section.empty}</p>
						: (
							<ul class="wsp-roles__list">
								{section.rows.map((row) => (
									<li key={row.id}>
										<button
											type="button"
											class="wsp-roles__row"
											data-role-id={row.id}
											aria-current={row.id === props.selected ? "true" : undefined}
											aria-controls={props.canvasId}
											onClick={() => props.onSelect(row.id)}
										>
											<span class="wsp-roles__row-name">
												{row.preset && <Icon name="lock" size="sm" class="wsp-roles__row-lock" />}
												<span class="wsp-roles__row-label">{row.name}</span>
												{row.preset && <span class="ui-visually-hidden">, preset</span>}
												{row.edited && (
													<>
														<span class="wsp-roles__row-dot" aria-hidden="true" />
														<span class="ui-visually-hidden">, unsaved changes</span>
													</>
												)}
											</span>
											<span class="wsp-roles__row-count" aria-hidden="true">
												{row.memberCount}
											</span>
											<span class="ui-visually-hidden">, {row.countText}</span>
										</button>
									</li>
								))}
							</ul>
						)}
					{section.key === "custom" && props.create && (
						<div class="wsp-roles__create">
							<Button
								{...rolesTierProps(props.create.tier)}
								size="sm"
								label={props.create.label}
								icon={<Icon name="plus" size="sm" />}
								onClick={props.onCreate}
							/>
						</div>
					)}
				</div>
			))}
		</section>
	);
}
