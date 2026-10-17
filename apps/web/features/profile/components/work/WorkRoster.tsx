import type { JSX } from "preact";
import { MetaLine } from "@projective/ui/display";
import { profileHref } from "@features/explore/core/routing.ts";
import { memberSinceLabel } from "../../core/profile-model.ts";
import type { DepartmentEntry, MemberEntry, ProfileKind } from "../../types/profile-types.ts";
import { UserAvatar } from "@web/components/UserAvatar.tsx";

/**
 * WorkRoster — the people behind a multi-member entity. A team or business renders one flat
 * auto-fill grid of avatar · name · role rows, each a link to the member's own `/@handle`. An
 * enterprise groups the same rows by department, a member sitting in several departments listed
 * under each (no chips — the group heading already says which department the row is in), with
 * members assigned to no department gathered last under "Unassigned". Departments with nobody in
 * them are omitted, and an enterprise with no department set falls back to the flat grid.
 *
 * A business row (BP1, Decision #244) reads its second line as a MetaLine — the member's title or
 * base role · "Since 2026" — never a chip: neither fact can be acted on.
 */
export function WorkRoster(
	{ members, departments, kind }: {
		members: readonly MemberEntry[];
		departments: readonly DepartmentEntry[];
		kind: ProfileKind;
	},
): JSX.Element | null {
	if (!members.length) return null;
	if (kind !== "enterprise" || !departments.length) {
		return <PersonList members={members} kind={kind} />;
	}

	const groups = departments
		.map((dept) => ({
			id: dept.id,
			name: dept.name,
			members: members.filter((m) => m.departments.includes(dept.id)),
		}))
		.filter((group) => group.members.length > 0);
	const known = new Set(departments.map((d) => d.id));
	const unassigned = members.filter((m) => !m.departments.some((id) => known.has(id)));
	if (unassigned.length) groups.push({ id: "unassigned", name: "Unassigned", members: unassigned });
	if (!groups.length) return null;

	return (
		<div class="pf-roster__groups">
			{groups.map((group, i) => (
				<Group
					key={group.id}
					name={group.name}
					members={group.members}
					first={i === 0}
					kind={kind}
				/>
			))}
		</div>
	);
}

function Group(
	{ name, members, first, kind }: {
		name: string;
		members: readonly MemberEntry[];
		first: boolean;
		kind: ProfileKind;
	},
): JSX.Element {
	return (
		<>
			{!first && <hr class="pf-rule" />}
			<section class="pf-roster__group" aria-label={name}>
				<h3 class="pf-roster__dept">
					{name}
					<span class="pf-h__count">{members.length}</span>
				</h3>
				<PersonList members={members} kind={kind} />
			</section>
		</>
	);
}

function PersonList(
	{ members, kind }: { members: readonly MemberEntry[]; kind: ProfileKind },
): JSX.Element {
	return (
		<ul class="pf-roster" role="list">
			{members.map((member) => (
				<li class="pf-person" key={member.handle}>
					<a class="pf-person__link" href={profileHref(member.handle)}>
						<UserAvatar
							image={member.avatar}
							label={member.name}
							size={40}
							shape="circle"
							class="pf-person__avatar"
						/>
						<span class="pf-person__name">{member.name}</span>
						{kind === "business"
							? <BusinessMemberMeta member={member} />
							: <span class="pf-person__role">{member.role}</span>}
					</a>
				</li>
			))}
		</ul>
	);
}

/** A business row's second line: role · since, as inline Meta-register text. */
function BusinessMemberMeta({ member }: { member: MemberEntry }): JSX.Element | null {
	const since = memberSinceLabel(member.since);
	return (
		<MetaLine
			as="span"
			size="xs"
			class="pf-person__meta"
			items={[member.role, since && { text: since, tabular: true }]}
		/>
	);
}
