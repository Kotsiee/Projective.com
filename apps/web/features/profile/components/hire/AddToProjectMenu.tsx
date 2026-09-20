import type { JSX } from "preact";
import { Icon } from "@projective/ui/icons";
import type { ProjectStatus } from "@projective/types/projects";
import type { HireProject } from "../../core/profile-model.ts";

/**
 * AddToProjectMenu — the contents of the hero's **Add to project** popover: the viewer's open
 * projects, published first, and a persistent "Create new project" row.
 *
 * The create row is ALWAYS present and always first, which is what makes the control honest for a
 * viewer with no projects at all: the menu is never empty, and the person with nothing to add to
 * is exactly the person who needs the way to make something. The rows are BUTTONS — picking a
 * project opens the assignment modal in place, and picking Create opens the wizard.
 *
 * The lifecycle word beside a project is a STATE, so it earns its place as text (§B.11); an
 * unpublished project is also named as such in its accessible name, because picking it stages a
 * placeholder rather than sending an offer and the buyer should know that before the modal says so.
 */
export interface AddToProjectMenuProps {
	projects: readonly HireProject[];
	sellerName: string;
	onPickProject: (project: HireProject) => void;
	onCreate: () => void;
}

/** The lifecycle word beside a project. */
const STATUS_LABEL: Record<ProjectStatus, string> = {
	draft: "Draft",
	active: "Active",
	on_hold: "On hold",
	completed: "Completed",
	cancelled: "Cancelled",
};

export function AddToProjectMenu(
	{ projects, sellerName, onPickProject, onCreate }: AddToProjectMenuProps,
): JSX.Element {
	return (
		<div class="pf-addmenu">
			<p class="pf-addmenu__lead">Add {sellerName} to</p>
			<button
				type="button"
				class="pf-addmenu__create"
				aria-haspopup="dialog"
				onClick={onCreate}
			>
				<Icon name="plus" size="sm" aria-hidden />
				<span class="pf-addmenu__create-text">
					<span class="pf-addmenu__title">Create new project</span>
					<span class="pf-addmenu__meta">Start a draft and bring {sellerName} in</span>
				</span>
			</button>
			{projects.length === 0
				? (
					<p class="pf-addmenu__empty">
						You have no open projects yet.
					</p>
				)
				: (
					<ul class="pf-addmenu__list" role="list">
						{projects.map((project) => (
							<li key={project.slug}>
								<button
									type="button"
									class="pf-addmenu__item"
									aria-haspopup="dialog"
									aria-label={`${project.title}, ${project.scopeLabel}, ${
										STATUS_LABEL[project.status]
									}${project.published ? "" : " — not published yet"}`}
									data-published={project.published ? "true" : "false"}
									onClick={() => onPickProject(project)}
								>
									<span class="pf-addmenu__text">
										<span class="pf-addmenu__title">{project.title}</span>
										<span class="pf-addmenu__meta">
											<span>{project.scopeLabel}</span>
											<span class="pf-addmenu__dot" aria-hidden="true">·</span>
											<span class="pf-addmenu__status" data-status={project.status}>
												{STATUS_LABEL[project.status]}
											</span>
										</span>
									</span>
									<Icon name="chevron-right" size="xs" class="pf-addmenu__chev" aria-hidden />
								</button>
							</li>
						))}
					</ul>
				)}
		</div>
	);
}
