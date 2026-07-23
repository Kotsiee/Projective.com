import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { profileHref } from "@features/explore/core/routing.ts";
import { Empty } from "./tab-shared.tsx";
import { ProfileIcon } from "../profile-glyphs.tsx";
import type { DepartmentEntry, MemberEntry, ProfileView } from "../../types/profile-types.ts";

/**
 * MembersTab — the team / business / organisation member roster (root CLAUDE.md Part 2). An
 * organisation arrives with a department set and renders grouped by department (a member spanning
 * multiple departments appears under each, with multi-department chips); every other kind renders a
 * flat grid.
 */

/** One member card — an avatar/name/role tile, plus multi-department chips when the member spans >1. */
function MemberCard(
	{ member, deptNames }: { member: MemberEntry; deptNames?: Record<string, string> },
): JSX.Element {
	const multi = deptNames && member.departments.length > 1;
	return (
		<li class="pf-member" key={member.handle}>
			<a class="pf-member__link" href={profileHref(member.handle)}>
				<Avatar image={member.avatar} label={member.name} size="xl" shape="circle" />
				<span class="pf-member__name">{member.name}</span>
				<span class="pf-member__role">{member.role}</span>
				{multi
					? (
						<span class="pf-member__depts" aria-label="Departments">
							{member.departments.map((id) => (
								<span class="pf-member__deptchip" key={id}>{deptNames?.[id] ?? id}</span>
							))}
						</span>
					)
					: null}
			</a>
		</li>
	);
}

/** Flat member roster (team / business). */
function MembersGrid({ members }: { members: MemberEntry[] }): JSX.Element {
	if (!members.length) return <Empty note="No members listed yet." />;
	return (
		<ul class="pf-members" role="list">
			{members.map((m) => <MemberCard member={m} key={m.handle} />)}
		</ul>
	);
}

/**
 * Department-grouped member roster (Organisation, root CLAUDE.md — Part 2.2). One section per
 * department; a member assigned to multiple departments appears under EACH (and their card carries
 * multi-department chips). Falls back to the flat grid if the org has no department structure.
 */
function MembersByDepartment(
	{ members, departments }: { members: MemberEntry[]; departments: DepartmentEntry[] },
): JSX.Element {
	if (!members.length) return <Empty note="No members listed yet." />;
	if (!departments.length) return <MembersGrid members={members} />;
	const deptNames: Record<string, string> = {};
	for (const d of departments) deptNames[d.id] = d.name;
	return (
		<div class="pf-deptgroups">
			{departments.map((dept) => {
				const inDept = members.filter((m) => m.departments.includes(dept.id));
				return (
					<section class="pf-deptgroup" key={dept.id} aria-label={`${dept.name} department`}>
						<header class="pf-deptgroup__head">
							<ProfileIcon name="departments" class="pf-deptgroup__icon" />
							<h3 class="pf-deptgroup__name">{dept.name}</h3>
							<span class="pf-deptgroup__count">{inDept.length}</span>
						</header>
						{inDept.length
							? (
								<ul class="pf-members" role="list">
									{inDept.map((m) => (
										<MemberCard member={m} deptNames={deptNames} key={`${dept.id}-${m.handle}`} />
									))}
								</ul>
							)
							: <Empty note="No members in this department yet." />}
					</section>
				);
			})}
		</div>
	);
}

export function MembersTab(
	{ profile, members, departments }: {
		profile: ProfileView;
		members: MemberEntry[];
		departments: DepartmentEntry[];
	},
): JSX.Element {
	return profile.kind === "organisation"
		? <MembersByDepartment members={members} departments={departments} />
		: <MembersGrid members={members} />;
}
