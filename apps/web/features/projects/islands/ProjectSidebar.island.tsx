import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
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
import { activeChannelIdOf } from "../core/chat-context.ts";
import { projectSidebarProjection } from "../core/sidebar-overlay.ts";
import { setupBaseline, setupCommitEpoch, setupDraft } from "../core/setup-store.ts";
import { ProjectSidebarService } from "../core/ProjectSidebarService.ts";
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
 * ## Live sync with the owner's setup form
 *
 * On `/projects/{slug}` the owner edits the engagement in the BODY, which is a different hydration
 * root. Both read one store — `core/setup-store.ts` — so the identity the lane draws tracks the form
 * as it is typed: the title (falling back to "Untitled Project"), the description, the engagement
 * type, and the stage list including adds, removals, renames and reorders. Nothing is copied between
 * the two regions and nothing is pushed: the form writes the draft, this island reads it, and
 * {@link projectSidebarProjection} is the ONE place the fold is expressed.
 *
 * The draft is what is drawn, never the server's acknowledgement, so a save landing mid-sentence
 * cannot flicker the sidebar back one edit. What the acknowledgement does trigger is a re-read of the
 * engagement, and only when the projection says one would change something — which is how a stage
 * created in the form acquires the channel it needs before the lane can offer a link to it.
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

	/**
	 * The freshest server copy of the engagement — the SSR prop until a re-read replaces it.
	 *
	 * Held in a signal rather than read straight off the prop because a write made in the setup form
	 * can create things this projection needs and cannot invent: a stage acquires its channel
	 * server-side, so until the engagement is re-read the lane knows the stage but not the room.
	 */
	const liveDetail = useSignal<ProjectDetail | null>(detail);

	/**
	 * The last unresolved-state key a completed re-read left behind — a `useRef`, not a signal,
	 * because nothing renders it and a re-render on every write would be noise.
	 */
	const settledKey = useRef<string>("");

	/**
	 * How many writes the setup form has had acknowledged, read during render so this island
	 * re-renders when one lands. It is the effect's dependency: a plain number, so the re-read below
	 * fires once per acknowledged write and never once per keystroke.
	 */
	const committed = setupCommitEpoch.value;

	/**
	 * Re-read the engagement after a write, but only when a re-read would change what can be drawn.
	 *
	 * The condition is the projection's own `stale` — a stage with no channel, or a channel for a stage
	 * the draft no longer has. A rename or a reorder is fully expressible from the draft, so those
	 * cost nothing: with auto-save on, a round trip per blur would be a request per field.
	 *
	 * Signals are `peek`ed, never read, so this effect depends on the epoch alone. `cancelled` is what
	 * makes a slow response harmless: a newer epoch tears this closure down first, so an older read can
	 * never land on top of a newer one.
	 *
	 * A FAILED read is deliberately silent. The write that triggered it has already reported its own
	 * outcome, and this one costs nothing the owner can act on — a stage row stays non-navigable until
	 * the next navigation resolves it. A second toast here would interrupt with a problem that has no
	 * remedy but waiting.
	 */
	useEffect(() => {
		if (committed === 0) return;
		const current = liveDetail.peek();
		if (!current) return;
		const { staleKey } = projectSidebarProjection(
			current,
			setupDraft.peek(),
			setupBaseline.peek(),
		);
		// Nothing outstanding, or a read has already come back and left exactly this outstanding — the
		// server cannot currently do better, so asking again would be a round trip per save forever.
		if (staleKey === "" || staleKey === settledKey.current) return;

		let cancelled = false;
		void ProjectSidebarService.detail(current.slug).then((res) => {
			if (cancelled || !res.ok || !res.data) return;
			// Recorded only on a response: a read that FAILED has resolved nothing, and marking it
			// settled would retire the retry along with it.
			settledKey.current = staleKey;
			liveDetail.value = res.data.detail;
		});
		return () => {
			cancelled = true;
		};
	}, [committed]);

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

	/*
	 * The engagement as the lane draws it RIGHT NOW: the server's copy with the owner's unsaved edits
	 * folded on. Reading `setupDraft` here is the whole live-sync mechanism — the setup form writes the
	 * store on every keystroke and this island is a subscriber, so the title, description, type and
	 * stage list track the form without either side holding a copy of the other's state.
	 *
	 * On every route that is not the owner's setup surface there is no draft, and the projection hands
	 * back the server's answer unchanged — so this is one code path, not a live one beside a static one.
	 */
	const projection = projectSidebarProjection(
		liveDetail.value ?? detail,
		setupDraft.value,
		setupBaseline.value,
	);
	const view = projection.detail;

	// The session projection recomputes when the archetype or the dev seam changes (both signals). It
	// derives from the immutable `slug`, so folding the draft in cannot shuffle it as the owner types.
	const normalData = activeKind === "normal" ? deriveNormalSession(view, seam.value) : null;
	const groupData = activeKind === "group" ? deriveGroupSession(view, seam.value) : null;

	return (
		<div class="proj-detail" data-service={activeKind}>
			{/* Collapsed presentation — CSS reveals it only at the narrow rail density. */}
			<ProjectRail
				detail={view}
				currentPath={currentPath.value}
				sessionKind={activeKind}
				onExpand={() => setLaneCollapsed(false)}
				onCreateStage={openCreateStage}
			/>

			{/* Expanded presentation. */}
			<div class="proj-detail__full">
				<SidebarHeader
					slug={view.slug}
					title={view.title}
					starred={starred.value}
					onToggleStar={toggleStar}
					onMenuAction={onMenuAction}
				/>

				<div class="proj-detail__scroll">
					<ProjectContextCard detail={view} />

					{normalData
						? (
							<NormalSessionPanel
								detail={view}
								data={normalData}
								calendarHref={calendarHref}
								filesHref={filesHref}
							/>
						)
						: groupData
						? (
							<GroupSessionPanel
								detail={view}
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
									detail={view}
									stages={projection.stages}
									openGroups={openGroups.value}
									onToggleGroup={toggleGroup}
									onCreateStage={openCreateStage}
									filters={filters.value}
									activeChannelId={activeChannelIdOf(currentPath.value)}
								/>
							</>
						)}
				</div>

				<div class="proj-detail__footer">
					<ProjectViewNav
						detail={view}
						currentPath={currentPath.value}
						collapsed={false}
						sessionKind={activeKind}
						onToggleCollapse={() => setLaneCollapsed(true)}
					/>
				</div>
			</div>

			<CreateStageModal
				open={createStageOpen}
				projectTitle={view.title}
				onClose={() => (createStageOpen.value = false)}
				onCreate={onCreateStage}
			/>
		</div>
	);
}
