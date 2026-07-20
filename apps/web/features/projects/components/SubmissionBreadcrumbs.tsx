import type { JSX } from "preact";
import { Breadcrumb } from "@projective/ui/navigation";
import type { SubmissionCrumb } from "../types/projects-types.ts";
import { submissionHref } from "../core/submission-model.ts";

/**
 * SubmissionBreadcrumbs — the interactive trail atop the workspace canvas (Part 3): a direct alternate
 * mechanism for navigating the tree's hierarchical nodes. It reuses the `@projective/ui` {@link Breadcrumb}
 * (extended to honour a per-crumb `command`): every crumb but the current one carries BOTH the deep-link
 * `url` (so middle-click / new-tab still work) AND a `command` that drives the in-place tree navigation
 * without a page load. The trailing crumb is the current node (a plain `aria-current` span).
 *
 * Rendered inside the SubmissionExplorer island (no data access of its own).
 */
export interface SubmissionBreadcrumbsProps {
	crumbs: SubmissionCrumb[];
	/** The submissions base route (`submissionsBase(...)`) the crumb hrefs hang off. */
	base: string;
	onNavigate: (path: string[]) => void;
}

export function SubmissionBreadcrumbs(props: SubmissionBreadcrumbsProps): JSX.Element {
	const { crumbs, base, onNavigate } = props;

	const model = crumbs.map((crumb, i) => {
		const isLast = i === crumbs.length - 1;
		return {
			key: crumb.path.join("/") || "root",
			label: crumb.label,
			// The current (last) crumb is a plain span — no url/command → Breadcrumb renders it as current.
			url: isLast ? undefined : submissionHref(base, crumb.path),
			command: isLast ? undefined : () => onNavigate(crumb.path),
		};
	});

	return (
		<Breadcrumb
			model={model}
			separator="chevron"
			aria-label="Submission path"
			class="subm-breadcrumbs"
		/>
	);
}
