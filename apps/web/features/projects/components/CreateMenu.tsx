import type { JSX, VNode } from "preact";
import { FormatGlyph } from "./glyphs.tsx";
import type { ProjectView } from "../types/projects-types.ts";

/**
 * CreateMenu — the contents of the Create (`+`) popover. The offered creation contexts adapt to the
 * active tab: on **Projects** the actor commissions or drafts a client-architected project; on
 * **Services** they publish a provider-side service or a one-off product. Each option is a quiet
 * icon + label + one-line hint row (no boxes); picking one routes to the create surface. Kept dumb —
 * the parent island owns navigation so the real Create-Project modal can slot in later.
 */

export interface CreateOption {
	kind: string;
	label: string;
	hint: string;
	icon: VNode;
}

const PROJECT_OPTS: readonly CreateOption[] = [
	{
		kind: "project",
		label: "New project",
		hint: "Commission staged work",
		icon: <FormatGlyph format="pipeline" />,
	},
	{
		kind: "one_off",
		label: "Quick brief",
		hint: "A single one-off deliverable",
		icon: <FormatGlyph format="one_off" />,
	},
];

const SERVICE_OPTS: readonly CreateOption[] = [
	{
		kind: "service",
		label: "New service",
		hint: "A repeatable staged offering",
		icon: <FormatGlyph format="pipeline" />,
	},
	{
		kind: "session",
		label: "Session offering",
		hint: "Bookable live sessions",
		icon: <FormatGlyph format="session" />,
	},
];

export interface CreateMenuProps {
	view: ProjectView;
	onPick: (kind: string) => void;
}

export function CreateMenu({ view, onPick }: CreateMenuProps): JSX.Element {
	const options = view === "engagements" ? SERVICE_OPTS : PROJECT_OPTS;
	return (
		<div class="proj-create" role="menu" aria-label="Create">
			<span class="proj-create__head">Create</span>
			{options.map((opt) => (
				<button
					key={opt.kind}
					type="button"
					role="menuitem"
					class="proj-create__item"
					onClick={() => onPick(opt.kind)}
				>
					<span class="proj-create__icon" aria-hidden="true">{opt.icon}</span>
					<span class="proj-create__text">
						<span class="proj-create__label">{opt.label}</span>
						<span class="proj-create__hint">{opt.hint}</span>
					</span>
				</button>
			))}
		</div>
	);
}
