import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { JSX } from "preact";
import "../styles/project-sidebar.css";
import { SidebarHeader, type SidebarMenuAction } from "../components/SidebarHeader.tsx";
import { ProjectContextCard } from "../components/ProjectContextCard.tsx";
import { type ChannelFilterKey, ChannelQuickFilters } from "../components/ChannelQuickFilters.tsx";
import { ChannelTree } from "../components/ChannelTree.tsx";
import { NormalSessionPanel } from "../components/NormalSessionPanel.tsx";
import { GroupSessionPanel } from "../components/GroupSessionPanel.tsx";
import { ProjectViewNav } from "../components/ProjectViewNav.tsx";
import { ProjectRail } from "../components/ProjectRail.tsx";
import { CreateStageModal } from "../components/CreateStageModal.tsx";
import { BackIcon } from "../components/detail-glyphs.tsx";
import {
	deriveGroupSession,
	deriveNormalSession,
	type DevSeamState,
	liveSessionKind,
	readDevSeam,
	type SessionKind,
	subscribeDevSeam,
} from "../core/session-model.ts";
import { MIDDLE_LANE_TOGGLE_EVENT } from "@web/utils/lane-events.ts";
import { LocalKeys, readStored, writeStored } from "@web/utils/storage-keys.ts";
import type { ProjectDetail } from "../types/projects-types.ts";

/** SSR default open-set — the highest-traffic groups (General + Stages/Sub-groups) lead expanded. */
const DEFAULT_GROUPS: Record<string, boolean> = {
	general: true,
	stages: true,
	subgroups: true,
	teams: false,
	dms: false,
};

/**
 * A fixed reference instant for the mini-calendar's SSR + first-paint render (matches the calendar
 * fixtures' reference clock). Seeding a constant keeps SSR and hydration byte-identical; the island
 * swaps to the real clock after mount, so the mini-calendar then reflects the live month.
 */
const SSR_REF_MS = Date.UTC(2026, 6, 17, 16, 20);
const DAY_MS = 86_400_000;

/** The UTC midnight day-key of an instant. */
function dayKeyOf(ms: number): number {
	const d = new Date(ms);
	return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * ProjectSidebar — the contextual middle-nav sidebar for the Project Details page
 * (`/projects/[projectId]`). Icon-heavy + minimalist: it replaces the `/projects` feed in the lane
 * whenever a single engagement is open. It has two presentations, switched purely by the splitter's
 * density (`.ui-splitter[data-mode]`, driven by width) so BOTH a drag and the toggle flip it:
 *
 *   - **Expanded** — the full stack: sticky header (Back + Star + kebab) → the card-less identity
 *     header + a body that adapts to the service archetype → a sticky footer with the icon-only view
 *     links and a Collapse toggle.
 *   - **Collapsed** — a single clean vertical icon rail ({@link ProjectRail}).
 *
 * The expanded body is **service-archetype-aware** (task §3), resolved from the SSR `sessionKind`
 * baseline layered with the dev Context Switcher (`liveSessionKind`), exactly like the channel header:
 *
 *   - **Standard project** (`none`) — the four-group channel tree + quick filters (the original view).
 *   - **Normal (1-1) session** (`normal`) — {@link NormalSessionPanel}: a mini-calendar + upcoming-
 *     session widget + session counter + shared-resources links + General channels (no stage tree).
 *   - **Group session** (`group`) — {@link GroupSessionPanel}: General + Sub-groups + Private-messages
 *     tree, cohort vote alert, and a 1-1 continuation CTA.
 *
 * Both presentations are rendered; CSS reveals exactly one, so no client width-observer is needed and
 * the collapse toggles are deterministic (the footer always collapses, the rail always expands).
 *
 * THIN: first paint comes from the SSR-resolved `detail`; it owns only view state (star, accordion
 * open-set, quick-filters, the Create-Stage modal) + the reactive session projection. Persistence lands
 * with the live backend behind `PROJECTS_BACKEND_LIVE` — the star, booking, and continuation are
 * optimistic/stubbed for now.
 */

export interface ProjectSidebarProps {
	/** SSR-resolved engagement, or `null` when the slug matched nothing. */
	detail: ProjectDetail | null;
	/** The routed slug (offers a retry/back even on a miss). */
	slug: string;
	/** Pathname at SSR — seeds the active view link. */
	path: string;
	/**
	 * The SSR-resolved service archetype baseline (from the engagement `format`). The island re-derives
	 * it live from the dev Context Switcher after hydration, so the first byte matches the real format.
	 */
	sessionKind?: SessionKind;
}

export default function ProjectSidebar(props: ProjectSidebarProps): JSX.Element {
	const { detail, sessionKind = "none" } = props;

	const starred = useSignal<boolean>(detail?.starred ?? false);
	// General + Stages/Sub-groups open by default; Teams + DMs collapsed. SSR paints these defaults; the
	// persisted preference is layered in after hydration (below) to avoid a mismatch.
	const openGroups = useSignal<Record<string, boolean>>({ ...DEFAULT_GROUPS });
	const createStageOpen = useSignal<boolean>(false);
	const currentPath = useSignal<string>(props.path);
	// Active channel-tree quick-filters (OR-combined); empty = show the whole tree.
	const filters = useSignal<ChannelFilterKey[]>([]);

	// The effective service archetype — seeded from the SSR baseline (no hydration mismatch), then
	// tracked live from the dev Context Switcher, with the current seam snapshot kept for the derivations.
	const kind = useSignal<SessionKind>(sessionKind);
	const seam = useSignal<DevSeamState | null>(null);
	// The mini-calendar clock — a fixed reference for SSR/first paint, the real clock after mount.
	const nowMs = useSignal<number>(SSR_REF_MS);
	const mounted = useSignal<boolean>(false);

	// Restore the persisted accordion open/closed preference once, client-side (never during SSR, so
	// the server-rendered defaults stay authoritative for hydration). Merged onto the defaults so a
	// newly-added group without a stored value keeps its default state.
	useEffect(() => {
		const raw = readStored("local", LocalKeys.PROJECT_CHANNEL_GROUPS);
		if (!raw) return;
		try {
			const stored = JSON.parse(raw) as Record<string, boolean>;
			openGroups.value = { ...openGroups.value, ...stored };
		} catch { /* corrupt value — ignore, keep defaults */ }
	}, []);

	// Track the dev Context Switcher so the archetype (and thus the whole sidebar body) live-updates when
	// the developer flips the service type — mirrors the ChannelHeader tab-set reactivity (task §2/§4).
	useEffect(() => {
		const sync = () => {
			const s = readDevSeam();
			seam.value = s;
			kind.value = liveSessionKind(sessionKind, s);
		};
		sync();
		return subscribeDevSeam(sync);
	}, [sessionKind]);

	// Swap the mini-calendar to the real clock after mount (deterministic SSR before, live month after).
	useEffect(() => {
		nowMs.value = Date.now();
		mounted.value = true;
	}, []);

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
		const next = { ...openGroups.value, [key]: !openGroups.value[key] };
		openGroups.value = next;
		writeStored("local", LocalKeys.PROJECT_CHANNEL_GROUPS, JSON.stringify(next));
	}

	function openCreateStage(): void {
		createStageOpen.value = true;
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

	function onCreateStage(_stage: { name: string; description: string }): void {
		// STUB: persistence is deferred to the live `projects.create_stage` RPC. Close on submit.
		createStageOpen.value = false;
	}

	/** Best-effort client navigation (the Propose-Time / continuation actions route to the calendar). */
	function go(href: string): void {
		try {
			globalThis.location.assign(href);
		} catch { /* SSR / no window — non-fatal */ }
	}

	const activeKind = kind.value;
	const base = `/projects/${detail.slug}`;
	const calendarHref = `${base}/calendar`;
	const filesHref = `${base}/files`;

	// The session projection recomputes when the archetype or the dev seam changes (both signals).
	const normalData = activeKind === "normal" ? deriveNormalSession(detail, seam.value) : null;
	const groupData = activeKind === "group" ? deriveGroupSession(detail, seam.value) : null;
	const sessionDayMs = normalData
		? dayKeyOf(nowMs.value) + normalData.upcoming.dayOffset * DAY_MS
		: 0;

	return (
		<div class="proj-detail" data-service={activeKind}>
			{/* Collapsed presentation — CSS reveals it only at the narrow rail density. */}
			<ProjectRail
				detail={detail}
				currentPath={currentPath.value}
				sessionKind={activeKind}
				onExpand={() => setLaneCollapsed(false)}
				onCreateStage={openCreateStage}
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

					{normalData
						? (
							<NormalSessionPanel
								detail={detail}
								data={normalData}
								nowMs={nowMs.value}
								sessionDayMs={sessionDayMs}
								mounted={mounted.value}
								calendarHref={calendarHref}
								filesHref={filesHref}
								onPickDay={() => go(calendarHref)}
							/>
						)
						: groupData
						? (
							<GroupSessionPanel
								detail={detail}
								data={groupData}
								openGroups={openGroups.value}
								onToggleGroup={toggleGroup}
								onContinuation={() => go(calendarHref)}
							/>
						)
						: (
							<>
								<ChannelQuickFilters active={filters.value} onToggle={toggleFilter} />

								<hr class="proj-detail__divider" />

								<ChannelTree
									detail={detail}
									openGroups={openGroups.value}
									onToggleGroup={toggleGroup}
									onCreateStage={openCreateStage}
									filters={filters.value}
								/>
							</>
						)}
				</div>

				<div class="proj-detail__footer">
					<ProjectViewNav
						detail={detail}
						currentPath={currentPath.value}
						collapsed={false}
						sessionKind={activeKind}
						onToggleCollapse={() => setLaneCollapsed(true)}
						onCreateStage={openCreateStage}
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
