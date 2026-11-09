import type { JSX } from "preact";
import { granteeKey, type GranteeKind, type GrantRole } from "@projective/types/files";
import type { DraftGrant } from "../../core/access-draft.ts";
import { GranteePicker } from "./GranteePicker.tsx";
import { GranteeRow } from "./GranteeRow.tsx";

/** Props for {@link PeoplePanel}. */
export interface PeoplePanelProps {
	grants: readonly DraftGrant[];
	/** Whether grants open the file at the draft's tier; Private pauses them. */
	active: boolean;
	/** A refused save's messages, keyed by grantee. */
	errors: Readonly<Record<string, string>>;
	/** A passing word about the last edit. */
	notice: string | null;
	/** People the picker never offers (the owner). */
	excludeIds: readonly string[];
	isAdded: (grantee: { kind: GranteeKind; id: string }) => boolean;
	onAdd: (grantee: Omit<DraftGrant, "role">) => void;
	onRemove: (key: string) => void;
	onRole: (key: string, role: GrantRole) => void;
}

function pausedNote(count: number): string {
	if (count === 0) return "Choose Specific people to add people, teams or projects.";
	const who = count === 1 ? "The one added keeps its" : `All ${count} added keep their`;
	return `${who} place but can't open it while it's private. Choose Specific people to give access back.`;
}

/**
 * Who the file is shared with: the picker, then one row per person, team, business or project with
 * their level and Remove. While the tier is Private the list stays in view, dimmed and inert, so a
 * person sees who gets access back when they raise it again.
 */
export function PeoplePanel(props: PeoplePanelProps): JSX.Element {
	const { grants, active, errors } = props;
	return (
		<section class="ins-access__group ins-access__people" data-paused={active ? undefined : "true"}>
			<h3 class="ins-access__subtitle">
				People with access
				{grants.length > 0 ? <span class="ins-access__count">{grants.length}</span> : null}
			</h3>
			<GranteePicker
				isAdded={props.isAdded}
				onAdd={props.onAdd}
				onRemove={(grantee) =>
					props.onRemove(granteeKey(grantee))}
				excludeIds={props.excludeIds}
				disabled={!active}
				disabledReason={null}
			/>
			{props.notice ? <p class="ins-access__notice" role="status">{props.notice}</p> : null}
			{!active ? <p class="ins-access__note">{pausedNote(grants.length)}</p> : null}
			{grants.length === 0
				? (active
					? (
						<p class="ins-access__empty">
							No one's been added yet. Search above to share it with people, a team you're in, or
							one of your projects.
						</p>
					)
					: null)
				: (
					<ul class="ins-access__list" inert={!active || undefined}>
						{grants.map((grant) => {
							const key = granteeKey(grant);
							return (
								<GranteeRow
									key={key}
									grant={grant}
									error={errors[key] ?? null}
									editable={active}
									onRole={(role) => props.onRole(key, role)}
									onRemove={() =>
										props.onRemove(key)}
								/>
							);
						})}
					</ul>
				)}
		</section>
	);
}
