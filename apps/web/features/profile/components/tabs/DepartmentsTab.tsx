import type { JSX } from "preact";
import { profileHref } from "@features/explore/core/routing.ts";
import { Empty } from "./tab-shared.tsx";
import { ProfileIcon } from "../profile-glyphs.tsx";
import type { DepartmentEntry } from "../../types/profile-types.ts";

/**
 * DepartmentsTab — the Organisation Departments overview (root CLAUDE.md Part 2): a tonal card per
 * department with its remit, member count, and lead link.
 */
export function DepartmentsTab({ departments }: { departments: DepartmentEntry[] }): JSX.Element {
	if (!departments.length) return <Empty note="No departments yet." />;
	return (
		<ul class="pf-depts" role="list">
			{departments.map((d) => (
				<li class="pf-deptcard" key={d.id}>
					<div class="pf-deptcard__head">
						<ProfileIcon name="departments" class="pf-deptcard__icon" />
						<span class="pf-deptcard__name">{d.name}</span>
						<span class="pf-deptcard__count">
							{d.memberCount} {d.memberCount === 1 ? "member" : "members"}
						</span>
					</div>
					{d.summary ? <p class="pf-deptcard__summary">{d.summary}</p> : null}
					{d.leadHandle
						? (
							<a class="pf-deptcard__lead" href={profileHref(d.leadHandle)}>
								<span class="pf-deptcard__leadlabel">Lead</span>
								<span class="pf-deptcard__leadhandle">{d.leadHandle}</span>
							</a>
						)
						: null}
				</li>
			))}
		</ul>
	);
}
