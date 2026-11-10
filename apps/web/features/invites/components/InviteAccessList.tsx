import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { Button, Select } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { Tooltip } from "@projective/ui/feedback";
import { UserAvatar } from "@web/components/UserAvatar.tsx";
import { type AccessPerson, rowRoleOptions, sortAccess } from "../core/access-people.ts";

/**
 * InviteAccessList — "People with access" under the Invite modal's link row (Decision #405): each
 * person's picture, name and `@handle`, their role, and a quiet remove. A role picker appears only on
 * a row the surface lets the viewer change ({@link AccessPerson.roles}); elsewhere the role is read.
 * A role change is not optimistic — the row shows the new role once the surface has saved it, and a
 * refusal is said on the row. Remove hands the row to the surface, which confirms it with its own
 * consequence-aware dialog in place of this one (§B.10.9).
 */

// #region Props
export interface InviteAccessListProps {
	people: readonly AccessPerson[];
	/** Save a role; answers the refusal, or `null` once it is saved. */
	onRoleChange?: (key: string, roleId: string) => Promise<string | null>;
	onRemove?: (key: string) => void;
}
// #endregion

export function InviteAccessList(props: InviteAccessListProps): JSX.Element | null {
	const busy = useSignal<string | null>(null);
	const errors = useSignal<Readonly<Record<string, string>>>({});
	if (props.people.length === 0) return null;

	async function changeRole(person: AccessPerson, roleId: string): Promise<void> {
		if (!props.onRoleChange || roleId === person.roleId || busy.peek()) return;
		busy.value = person.key;
		const refusal = await props.onRoleChange(person.key, roleId);
		busy.value = null;
		const next = { ...errors.peek() };
		if (refusal) next[person.key] = refusal;
		else delete next[person.key];
		errors.value = next;
	}

	return (
		<section class="inv-access" aria-labelledby="inv-access-title">
			<h3 class="inv-access__title" id="inv-access-title">People with access</h3>
			<ul class="inv-access__list">
				{sortAccess(props.people).map((person) => {
					const error = errors.value[person.key];
					const editable = person.roles !== null && !!props.onRoleChange;
					return (
						<li key={person.key} class="inv-access__row">
							<UserAvatar
								image={person.avatar ?? undefined}
								label={person.name}
								shape="circle"
								class="inv-access__avatar"
							/>
							<span class="inv-access__who">
								<span class="inv-access__name">
									{person.name}
									{person.self && <span class="inv-access__you">(you)</span>}
								</span>
								<span class="inv-access__meta" data-tone={error ? "danger" : undefined}>
									{error ?? (person.handle ? `@${person.handle}` : null)}
								</span>
							</span>
							{editable && person.roles
								? (
									<Select
										key={`${person.roleId}:${error ?? ""}`}
										size="sm"
										class="inv-access__role"
										options={rowRoleOptions(person, person.roles).map((r) => ({
											label: r.name,
											value: r.id,
										}))}
										value={person.roleId}
										onValueChange={(next) => next && void changeRole(person, next)}
										disabled={busy.value !== null}
										panelWidth="auto"
										aria-label={`Role for ${person.name}`}
									/>
								)
								: <span class="inv-access__role-text">{person.roleLabel}</span>}
							{person.removable && props.onRemove
								? (
									<Tooltip content={`Remove ${person.name}`} placement="top">
										<Button
											iconOnly
											rounded
											size="sm"
											variant="text"
											severity="secondary"
											class="inv-access__remove ui-hit"
											icon={<Icon name="user-minus" size="sm" />}
											aria-label={`Remove ${person.name}`}
											disabled={busy.value !== null}
											onClick={() => props.onRemove?.(person.key)}
										/>
									</Tooltip>
								)
								: <span class="inv-access__remove-slot" aria-hidden="true" />}
						</li>
					);
				})}
			</ul>
		</section>
	);
}
