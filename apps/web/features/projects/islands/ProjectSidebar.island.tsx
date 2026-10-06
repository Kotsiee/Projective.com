import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { JSX } from "preact";
import "../styles/project-sidebar.css";
import "../styles/task-lane.css";
import { SidebarHeader, type SidebarMenuAction } from "../components/SidebarHeader.tsx";
import { ProjectContextCard } from "../components/ProjectContextCard.tsx";
import { type ChannelFilterKey, ChannelQuickFilters } from "../components/ChannelQuickFilters.tsx";
import { ChannelTree } from "../components/ChannelTree.tsx";
import { NormalSessionPanel } from "../components/NormalSessionPanel.tsx";
import { GroupSessionPanel } from "../components/GroupSessionPanel.tsx";
import { TaskLanePanel } from "../components/task-lane/TaskLanePanel.tsx";
import { ProjectNavSection } from "../components/ProjectNavSection.tsx";
import { ProjectRail } from "../components/ProjectRail.tsx";
import { CreateStageModal } from "../components/CreateStageModal.tsx";
import { BoardService } from "../core/BoardService.ts";
import { stagesCreatedEpoch } from "../core/stage-events.ts";
import { ArchiveProjectDialog } from "../components/ArchiveProjectDialog.tsx";
import {
	BackIcon,
	DetailsIcon,
	projectViewLinks,
	viewLinkCurrent,
} from "../components/detail-glyphs.tsx";
import {
	LaneCollapseButton,
	LaneFooter,
	LaneFooterActions,
	LaneIconButton,
} from "@projective/ui/navigation";
import { Toast, useToast } from "@projective/ui/feedback";
import { logger } from "@web/utils/logger.ts";
import { SidebarToggleIcon } from "@web/features/shell/core/nav-icons.tsx";
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
import { isTaskDetail } from "../core/task-project.ts";
import { buildTaskLane, type TaskLane } from "../core/task-lane.ts";
import { isOwnerRole } from "../types/projects-types.ts";
import type { ProjectDetail } from "../types/projects-types.ts";

/**
 * SSR default open-set — the highest-traffic groups (Stages/Sub-groups) lead expanded, and a Task's
 * two sections both do: each is a short summary, and a Task's body has nothing else in it.
 */
const DEFAULT_GROUPS: Record<string, boolean> = {
	stages: true,
	subgroups: true,
	teams: false,
	dms: false,
	"task-overview": true,
	"task-lists": true,
};

/**
 * ProjectSidebar — the contextual middle-nav sidebar for the Project Details page
 * (`/projects/[projectId]`). Icon-heavy + minimalist: it replaces the `/projects` feed in the lane
 * whenever a single engagement is open. It has two presentations, switched purely by the splitter's
 * density (`.ui-splitter[data-mode]`, driven by width) so BOTH a drag and the toggle flip it:
 *
 *   - **Expanded** — four vertical zones, top to bottom:
 *       1. the project header — a sticky row (Back + Star + kebab) over the card-less identity header;
 *       2. the **top tier** ({@link ProjectNavSection}) — the engagement's primary views as full nav
 *          rows: Overview first (the engagement's root, Decision #144), then Discussion, the
 *          archetype's Board / Timeline / Calendar, Files, Submissions and Members
 *          ({@link projectViewLinks});
 *       3. the **contextual body**, which adapts to the archetype (below);
 *       4. a **utility footer** — the collapse toggle and, for the owner, Project details (the
 *          engagement's configuration at `/details`), nothing else.
 *   - **Collapsed** — a single clean vertical icon rail ({@link ProjectRail}) mirroring the same views.
 *
 * The contextual body is **archetype-aware** (task §3), resolved from the SSR `sessionKind` baseline
 * layered with the dev Context Switcher (`liveSessionKind`), exactly like the channel header:
 *
 *   - **One-off / pipeline** (`none`) — the channel tree: a STAGES section (the owner's inline ＋ opens
 *     Create Stage) plus Teams and Private Messages when the viewer has something in them, under the
 *     quick filters. There is no General group: the project-wide room is the top tier's Discussion.
 *   - **Normal (1-1) session** (`normal`) — {@link NormalSessionPanel}: a mini-calendar + upcoming-
 *     session widget + session counter + shared-resources links (no stage tree).
 *   - **Group session** (`group`) — {@link GroupSessionPanel}: Sub-groups + Private-messages tree,
 *     cohort vote alert, and a 1-1 continuation CTA.
 *   - **Task** (a standard engagement whose type is Task) — {@link TaskLanePanel}: its overview and its
 *     task lists in place of the channel tree. Its one conversation and its roster are top-tier links.
 *     Keyed on the engagement with the draft folded on, so switching an unsaved form's type swaps the
 *     body AND the top tier live; a session archetype still wins, so the dev switcher can simulate one
 *     on any row.
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
	/**
	 * A Task's lane projection — its ticket, due date and task lists — resolved server-side from the
	 * board read. `null` for every other engagement (they draw a channel tree, not this), and rebuilt
	 * empty on the client when an unsaved setup form turns a non-Task into one.
	 */
	taskLane?: TaskLane | null;
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
	// The kebab's Archive project confirmation, and the write it guards while in flight.
	const archiveOpen = useSignal<boolean>(false);
	const archiving = useSignal<boolean>(false);
	/** Mounted only when no other island has already put a stack up (they share one signal). */
	const toastMounted = useSignal<boolean>(false);
	const toast = useToast();

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

	/**
	 * Re-read the engagement whenever a stage is created — here, on the Board or on the Timeline. A new
	 * stage's room exists only server-side until it is read back, so this read is unconditional, unlike
	 * the setup re-read above which first asks whether anything is outstanding. Same `cancelled` guard.
	 */
	const stagesCreated = stagesCreatedEpoch.value;
	useEffect(() => {
		if (stagesCreated === 0) return;
		const current = liveDetail.peek();
		if (!current) return;
		let cancelled = false;
		void ProjectSidebarService.detail(current.slug).then((res) => {
			if (cancelled || !res.ok || !res.data) return;
			liveDetail.value = res.data.detail;
		});
		return () => {
			cancelled = true;
		};
	}, [stagesCreated]);

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

	function onMenuAction(action: SidebarMenuAction): void {
		// Open and Share resolve inside the header; Archive is the one action that writes.
		if (action === "archive") archiveOpen.value = true;
	}

	/** Push a toast, mounting a stack first when the page has none (they all render one signal). */
	function notify(severity: "success" | "danger", summary: string): void {
		if (!document.querySelector(".ui-toast")) toastMounted.value = true;
		toast.show({ severity, summary, life: severity === "danger" ? 6000 : 3000 });
	}

	/**
	 * Soft-archive the engagement (root CLAUDE.md §5 — the row and its history survive) and leave for
	 * the feed, exactly as the setup rig's Archive does: every view in this lane addresses a project
	 * that is no longer in circulation. A refusal stays on the page and says why, in the server's words.
	 */
	async function archiveProject(): Promise<void> {
		if (archiving.value || !detail) return;
		archiving.value = true;
		const res = await ProjectSidebarService.archive(detail.slug);
		archiving.value = false;
		if (!res.ok) {
			logger.error("Project archive failed", { slug: detail.slug, message: res.message });
			notify("danger", res.message ?? "That did not archive — please try again.");
			return;
		}
		globalThis.location.href = "/projects";
	}

	/**
	 * Persist a new stage through `BoardService.createStage`. On success the service announces it
	 * (`stagesCreatedEpoch`), which is what re-reads the engagement below — the lane learns the stage
	 * and its freshly provisioned room from the server, exactly as a reload would. A refusal is
	 * returned to the modal, which keeps the draft open and shows it.
	 */
	async function onCreateStage(
		stage: { name: string; description: string },
	): Promise<string | null> {
		const slug = (liveDetail.peek() ?? detail)?.slug;
		if (!slug) return "This project could not be found.";
		const res = await BoardService.createStage(slug, stage);
		if (!res.ok || !res.data) return res.message ?? "That stage could not be created.";
		createStageOpen.value = false;
		return null;
	}

	/** Best-effort client navigation (the Propose-Time / continuation actions route to the calendar). */
	function go(href: string): void {
		try {
			globalThis.location.assign(href);
		} catch { /* SSR / no window — non-fatal */ }
	}

	const activeKind = kind.value;
	const base = `/projects/${detail.slug}`;
	const detailsCurrent = viewLinkCurrent(currentPath.value, base, { seg: "details" }) !== null;
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
	// The top tier follows the same projection, so an unsaved type switch moves it with the body.
	const views = projectViewLinks(view, activeKind);

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
					canArchive={isOwnerRole(view.viewerRole)}
					onMenuAction={onMenuAction}
				/>

				<div class="proj-detail__scroll">
					<ProjectContextCard detail={view} />

					<ProjectNavSection links={views} base={base} currentPath={currentPath.value} />

					<hr class="proj-detail__divider" />

					{normalData
						? (
							<NormalSessionPanel
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
						: isTaskDetail(view)
						? (
							<TaskLanePanel
								detail={view}
								lane={props.taskLane ?? buildTaskLane(view, null)}
								path={currentPath.value}
								openGroups={openGroups.value}
								onToggleGroup={toggleGroup}
							/>
						)
						: (
							<>
								<ChannelQuickFilters active={filters.value} onToggle={toggleFilter} />

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

				{
					/*
					 * Utilities only — the views moved up into the top tier. The collapse toggle docks to the
					 * lane's corner (`LaneCollapseButton`), the same point the collapsed rail's expand toggle
					 * occupies, so collapsing and expanding never move the pointer. Project details is the
					 * owner's configuration at `/details` (Decision #144) — not drawn for anybody else, whose
					 * way into the engagement is the top tier's Overview, and not drawn twice on a Task,
					 * whose top tier already carries it.
					 */
				}
				<LaneFooter class="proj-detail__footer">
					<LaneCollapseButton
						collapsed={false}
						icon={<SidebarToggleIcon />}
						onToggle={() => setLaneCollapsed(true)}
					/>
					{view.viewerIsClient && !views.some((link) => link.key === "details") && (
						<LaneFooterActions>
							<LaneIconButton
								href={`${base}/details`}
								icon={DetailsIcon}
								label="Project details & settings"
								tooltipPlacement="top"
								active={detailsCurrent}
							/>
						</LaneFooterActions>
					)}
				</LaneFooter>
			</div>

			<CreateStageModal
				open={createStageOpen}
				projectTitle={view.title}
				onClose={() => (createStageOpen.value = false)}
				onCreate={onCreateStage}
			/>

			<ArchiveProjectDialog
				visible={archiveOpen}
				title={view.title}
				onAccept={() => void archiveProject()}
			/>

			{toastMounted.value ? <Toast position="bottom-center" /> : null}
		</div>
	);
}
