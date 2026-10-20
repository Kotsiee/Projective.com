import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { useSignal, useSignalEffect } from "@preact/signals";
import "../styles/workspace.css";
import { Button } from "@projective/ui/fields";
import { Icon, type IconName } from "@projective/ui/icons";
import { ActionCelebration, Tooltip, useActionCelebration } from "@projective/ui/feedback";
import { motionReduced } from "@projective/ui/display";
import {
	consoleHref,
	type EditSection,
	type ListingStatus,
	workspaceHref,
} from "../types/catalogue-types.ts";
import { ListingRemovalDialog, type RemovalKind } from "../components/ListingRemovalDialog.tsx";
import { sectionDomId } from "../components/edit/EditSectionFrame.tsx";
import { CatalogueService } from "../core/CatalogueService.ts";
import {
	conflictPrompt,
	draft,
	flush,
	notice,
	readiness,
	requestStatus,
	retry,
	savedAt,
	saveState,
	setWorkspaceUrl,
	statusBusy,
	workspaceReady,
	workspaceUrl,
} from "../core/workspace-store.ts";
import {
	readinessSentence,
	type SaveAction,
	saveLabel,
	type SaveState,
	sectionHeadingId,
} from "../core/workspace-model.ts";
import { firstMissingSection } from "../core/readiness-items.ts";

/** Props for {@link ListingActionRig}. */
export interface ListingActionRigProps {
	/** The listing's slug. */
	slug: string;
	/** The SSR status and what the publish gate found missing, so the rig paints before hydration. */
	status: ListingStatus;
	missing: readonly string[];
	/** Whether the seller may hard-delete it: no buyer has engaged with it (Decision #221). */
	deletable: boolean;
}

const GATE_ID = "cat-ws-gate";
const NOTICE_MS = 6_000;
const CONFIRMED_MS = 2_400;
const TICK_MS = 5_000;

const ANNOUNCE: Readonly<Record<SaveState, string>> = {
	saved: "Saved",
	dirty: "",
	saving: "Saving",
	error: "Couldn't save",
	conflict: "This listing changed somewhere else",
};

const ACTION_LABEL: Readonly<Record<SaveAction, string>> = {
	save: "Save now",
	retry: "Retry",
	resolve: "Resolve",
};

function publishLabel(status: ListingStatus): string {
	if (status === "archived") return "Restore & publish";
	if (status === "paused") return "Resume";
	return "Publish";
}

function publishIcon(status: ListingStatus): IconName {
	return status === "paused" ? "play" : "send";
}

function reveal(section: EditSection): void {
	document.getElementById(sectionDomId(section))?.scrollIntoView({
		block: "start",
		behavior: motionReduced() ? "auto" : "smooth",
	});
	document.getElementById(sectionHeadingId(section))?.focus({ preventScroll: true });
}

function goToSection(section: EditSection): void {
	if (workspaceUrl.peek().tab === "edit") {
		setWorkspaceUrl({ section }, "replace");
		reveal(section);
		return;
	}
	setWorkspaceUrl({ tab: "edit", section }, "push");
	setTimeout(() => requestAnimationFrame(() => reveal(section)), 0);
}

function RigIcon(props: {
	label: string;
	icon: IconName;
	onClick: () => void;
	loading?: boolean;
	disabled?: boolean;
}): JSX.Element {
	return (
		<Tooltip content={props.label} placement="top">
			<Button
				rounded
				iconOnly
				size="sm"
				severity="neutral"
				variant="outlined"
				class="cat-ws-rig__icon ui-hit"
				aria-label={props.label}
				icon={<Icon name={props.icon} size="sm" />}
				loading={props.loading}
				disabled={props.disabled}
				onClick={props.onClick}
			/>
		</Tooltip>
	);
}

/**
 * ListingActionRig — the workspace's middle-nav FOOTER band (Decision #304, amending #220). At the
 * start, the save status in the meta register: a pip and "Saved · 2s ago" · "Saving…" · "Unsaved
 * changes" · "Couldn't save" · "Offline · not saved", with Save now, Retry or Resolve beside it; a
 * lifecycle outcome replaces the text for a few seconds. At the end, the secondaries as neutral
 * outlined circles, each with a portal Tooltip — Duplicate, Delete (only while no buyer has engaged,
 * #221), Archive, and Pause while live — then Publish, the one filled commit, icon and text.
 *
 * While the gate is closed Publish shows a lock, stays focusable but inert, and its Tooltip lists
 * what is missing; pressing it takes the seller to the section that fixes the first missing line and
 * says the whole gate in the status. A committed publish shows a "Published" status for a moment inside an
 * {@link ActionCelebration} burst; under reduced motion only the confirmed state shows.
 *
 * Every lifecycle change goes through the store, which saves what the seller typed first.
 */
export default function ListingActionRig(props: ListingActionRigProps): JSX.Element {
	const shown = useSignal<string | null>(null);
	const removal = useSignal<RemovalKind | null>(null);
	const confirming = useSignal(false);
	const deleting = useSignal(false);
	const duplicating = useSignal(false);
	const confirmed = useSignal(false);
	const now = useSignal(Date.now());
	const offline = useSignal(false);
	const celebration = useActionCelebration();

	useEffect(() => {
		const tick = setInterval(() => (now.value = Date.now()), TICK_MS);
		const sync = () => (offline.value = !navigator.onLine);
		sync();
		globalThis.addEventListener("online", sync);
		globalThis.addEventListener("offline", sync);
		return () => {
			clearInterval(tick);
			globalThis.removeEventListener("online", sync);
			globalThis.removeEventListener("offline", sync);
		};
	}, []);

	useSignalEffect(() => {
		const message = notice.value;
		shown.value = message;
		if (!message) return;
		const timer = setTimeout(() => {
			if (notice.peek() === message) notice.value = null;
		}, NOTICE_MS);
		return () => clearTimeout(timer);
	});

	useSignalEffect(() => {
		if (!confirmed.value) return;
		const timer = setTimeout(() => (confirmed.value = false), CONFIRMED_MS);
		return () => clearTimeout(timer);
	});

	function confirm(kind: RemovalKind): void {
		removal.value = kind;
		confirming.value = true;
	}

	async function runRemoval(): Promise<void> {
		const kind = removal.peek();
		removal.value = null;
		if (kind === "archive") {
			await requestStatus("archived");
			return;
		}
		if (kind !== "delete") return;
		deleting.value = true;
		const res = await CatalogueService.remove(props.slug);
		if (res.ok) {
			globalThis.location.assign(consoleHref({}));
			return;
		}
		deleting.value = false;
		notice.value = res.message ?? "Couldn't delete the listing.";
	}

	async function duplicate(): Promise<void> {
		duplicating.value = true;
		await flush();
		const res = await CatalogueService.duplicate(props.slug);
		if (res.ok && res.data) {
			globalThis.location.assign(workspaceHref(res.data.listing.id, {}));
			return;
		}
		duplicating.value = false;
		notice.value = res.message ?? "Couldn't duplicate the listing.";
	}

	function runSaveAction(action: SaveAction): void {
		if (action === "resolve") conflictPrompt.value = true;
		else void retry();
	}

	const ready = workspaceReady.value;
	const status = (ready ? draft.value?.status : null) ?? props.status;
	const missing = (ready ? readiness.value?.missing : null) ?? props.missing;
	const open = missing.length === 0;
	const busy = statusBusy.value;
	const locked = busy !== null || deleting.value || duplicating.value;
	const state = ready ? saveState.value : "saved";
	const label = saveLabel(state, savedAt.value, now.value, offline.value);
	const saveAction = shown.value ? null : label.action;
	const pip = offline.value && (state === "dirty" || state === "error") ? "offline" : state;

	async function publish(): Promise<void> {
		if (busy) return;
		if (!open) {
			const section = firstMissingSection(missing);
			if (section) goToSection(section);
			notice.value = readinessSentence(missing);
			return;
		}
		if (await requestStatus("published")) {
			confirmed.value = true;
			celebration.celebrate();
		}
	}

	const publishButton = confirmed.value
		? (
			<span class="cat-ws-rig__confirmed">
				<Icon name="check" size="sm" />
				Published
			</span>
		)
		: (
			<Button
				size="sm"
				label={publishLabel(status)}
				icon={<Icon name={open ? publishIcon(status) : "lock"} size="sm" />}
				loading={busy === "published"}
				aria-disabled={!open || busy !== null}
				aria-describedby={open ? undefined : GATE_ID}
				class="cat-ws-rig__publish"
				data-locked={open ? undefined : "true"}
				onClick={() => void publish()}
			/>
		);

	return (
		<div class="cat-ws-rig">
			<p class="cat-ws-rig__status">
				<span class="cat-ws-rig__pip" data-state={pip} aria-hidden="true" />
				<span class="cat-ws-rig__text" aria-hidden="true">{shown.value ?? label.text}</span>
				{saveAction && (
					<button
						type="button"
						class="cat-ws-rig__link"
						onClick={() => runSaveAction(saveAction)}
					>
						{ACTION_LABEL[saveAction]}
					</button>
				)}
			</p>
			<span class="ui-visually-hidden" role="status">{shown.value ?? ANNOUNCE[state]}</span>
			<span class="ui-visually-hidden" id={GATE_ID} data-ready={open ? "true" : undefined}>
				{readinessSentence(missing)}
			</span>

			<div class="cat-ws-rig__actions">
				<RigIcon
					label="Duplicate listing"
					icon="copy"
					loading={duplicating.value}
					disabled={locked}
					onClick={() => void duplicate()}
				/>
				{props.deletable && (
					<RigIcon
						label="Delete listing"
						icon="trash"
						loading={deleting.value}
						disabled={locked}
						onClick={() => confirm("delete")}
					/>
				)}
				{status !== "archived" && (
					<RigIcon
						label="Archive listing"
						icon="archive-box"
						loading={busy === "archived"}
						disabled={locked}
						onClick={() => confirm("archive")}
					/>
				)}
				{status === "published" && !confirmed.value && (
					<RigIcon
						label="Pause listing"
						icon="pause"
						loading={busy === "paused"}
						disabled={locked}
						onClick={() => void requestStatus("paused")}
					/>
				)}
				{(status !== "published" || confirmed.value) && (
					<ActionCelebration active={celebration.active.value} class="cat-ws-rig__commit">
						{open || confirmed.value ? publishButton : (
							<Tooltip
								placement="top"
								content={
									<div class="cat-ws-rig__tip">
										<p class="cat-ws-rig__tip-head">Before you publish</p>
										<ul class="cat-ws-rig__tip-list">
											{missing.map((m) => <li key={m}>{m}</li>)}
										</ul>
									</div>
								}
							>
								{publishButton}
							</Tooltip>
						)}
					</ActionCelebration>
				)}
			</div>
			{removal.value && (
				<ListingRemovalDialog
					visible={confirming}
					kind={removal.value}
					subject={`“${draft.value?.title ?? "this listing"}”`}
					onConfirm={() => void runRemoval()}
					onCancel={() => (removal.value = null)}
				/>
			)}
		</div>
	);
}
