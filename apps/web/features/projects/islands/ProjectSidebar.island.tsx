import { useSignal } from "@preact/signals";
import type { JSX } from "preact";
import "../styles/project-sidebar.css";
import { SidebarHeader, type SidebarMenuAction } from "../components/SidebarHeader.tsx";
import { ProjectContextCard } from "../components/ProjectContextCard.tsx";
import { ChannelQuickFilters, type ChannelFilterKey } from "../components/ChannelQuickFilters.tsx";
import { ChannelTree } from "../components/ChannelTree.tsx";
import { ProjectViewNav } from "../components/ProjectViewNav.tsx";
import { ProjectRail } from "../components/ProjectRail.tsx";
import { CreateStageModal } from "../components/CreateStageModal.tsx";
import { BackIcon } from "../components/detail-glyphs.tsx";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import type { ProjectDetail } from "../types/projects-types.ts";

/**
 * ProjectSidebar — the contextual middle-nav sidebar for the Project Details page
 * (`/projects/[projectId]`). Icon-heavy + minimalist: it replaces the `/projects` feed in the lane
 * whenever a single engagement is open. It has two presentations, switched purely by the splitter's
 * density (`.ui-splitter[data-mode]`, driven by width) so BOTH a drag and the toggle flip it:
 *
 *   - **Expanded** — the full stack: sticky header (Back + Star + kebab) → the card-less identity
 *     header + channel quick-filters + four-group channel accordion → a sticky footer with the
 *     icon-only view links and a Collapse toggle.
 *   - **Collapsed** — a single clean vertical icon rail ({@link ProjectRail}): Back · owner avatar ·
 *     the core view icons up top, Settings + an Expand toggle pinned to the bottom.
 *
 * Both are rendered; CSS reveals exactly one, so no client width-observer is needed and the collapse
 * toggles are deterministic (the footer always collapses, the rail always expands).
 *
 * THIN: first paint comes from the SSR-resolved `detail`; it owns only view state (star, accordion
 * open-set, quick-filters, the Create-Stage modal). Persistence lands with the live backend behind
 * `PROJECTS_BACKEND_LIVE` — the star + create-stage are optimistic/stubbed for now.
 */

export interface ProjectSidebarProps {
	/** SSR-resolved engagement, or `null` when the slug matched nothing. */
	detail: ProjectDetail | null;
	/** The routed slug (offers a retry/back even on a miss). */
	slug: string;
	/** Pathname at SSR — seeds the active view link. */
	path: string;
}

export default function ProjectSidebar(props: ProjectSidebarProps): JSX.Element {
	const { detail } = props;

	const starred = useSignal<boolean>(detail?.starred ?? false);
	// General + Stages open by default (the highest-traffic groups); Teams + DMs collapsed.
	const openGroups = useSignal<Record<string, boolean>>({
		general: true,
		stages: true,
		teams: false,
		dms: false,
	});
	const createStageOpen = useSignal<boolean>(false);
	const currentPath = useSignal<string>(props.path);
	// Active channel-tree quick-filters (OR-combined); empty = show the whole tree.
	const filters = useSignal<ChannelFilterKey[]>([]);

	// A slug that resolved to nothing — a calm stub with a way back, never a hard error.
	if (!detail) {
		return (
			<div class="proj-detail proj-detail--empty">
				<a class="proj-detail__back" href="/projects" aria-label="Back to all projects">
					<span class="proj-detail__back-icon" aria-hidden="true">{BackIcon}</span>
					<span class="proj-detail__back-label">Back</span>
				</a>
				<div class="proj-detail__missing">
					<p class="proj-detail__missing-title">Project not found</p>
					<p class="proj-detail__missing-note">
						“{props.slug}” doesn’t match any engagement you can access.
					</p>
				</div>
			</div>
		);
	}

	function toggleStar(): void {
		starred.value = !starred.value;
	}

	function toggleGroup(key: string): void {
		openGroups.value = { ...openGroups.value, [key]: !openGroups.value[key] };
	}

	function toggleFilter(key: ChannelFilterKey): void {
		filters.value = filters.value.includes(key)
			? filters.value.filter((k) => k !== key)
			: [...filters.value, key];
	}

	/**
	 * Drive the whole middle-nav lane's width via the splitter (shared collapse event). Deterministic:
	 * the expanded footer toggle only ever collapses, the collapsed rail toggle only ever expands — each
	 * is visible solely in its own state, so no width-observer/sync is needed.
	 */
	function setLaneCollapsed(next: boolean): void {
		try {
			globalThis.dispatchEvent(
				new CustomEvent(MIDDLE_LANE_TOGGLE_EVENT, { detail: { collapsed: next } }),
			);
		} catch { /* SSR / no window — non-fatal */ }
	}

	function onMenuAction(_action: SidebarMenuAction): void {
		// Report / Leave / Delete need the live backend + confirmation surfaces; wired dumb for now so
		// the menu is fully navigable (open + share resolve client-side inside the header).
	}

	function onCreateStage(_name: string): void {
		// STUB: persistence is deferred to the live `projects.create_stage` RPC. Close on submit.
		createStageOpen.value = false;
	}

	return (
		<div class="proj-detail">
			{/* Collapsed presentation — CSS reveals it only at the narrow rail density. */}
			<ProjectRail
				detail={detail}
				currentPath={currentPath.value}
				onExpand={() => setLaneCollapsed(false)}
			/>

			{/* Expanded presentation. */}
			<div class="proj-detail__full">
				<SidebarHeader
					slug={detail.slug}
					title={detail.title}
					starred={starred.value}
					onToggleStar={toggleStar}
					onMenuAction={onMenuAction}
				/>

				<div class="proj-detail__scroll">
					<ProjectContextCard detail={detail} />

					<ChannelQuickFilters active={filters.value} onToggle={toggleFilter} />

					<hr class="proj-detail__divider" />

					<ChannelTree
						detail={detail}
						openGroups={openGroups.value}
						onToggleGroup={toggleGroup}
						onCreateStage={() => (createStageOpen.value = true)}
						filters={filters.value}
					/>
				</div>

				<div class="proj-detail__footer">
					<ProjectViewNav
						detail={detail}
						currentPath={currentPath.value}
						collapsed={false}
						onToggleCollapse={() => setLaneCollapsed(true)}
					/>
				</div>
			</div>

			<CreateStageModal
				open={createStageOpen.value}
				projectTitle={detail.title}
				onClose={() => (createStageOpen.value = false)}
				onCreate={onCreateStage}
			/>
		</div>
	);
}
