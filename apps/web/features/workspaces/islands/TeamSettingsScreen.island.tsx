import type { JSX, Ref } from "preact";
import { batch, useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "../styles/workspace.css";
import { MetaLine, Tag } from "@projective/ui/display";
import { ConfirmDialog, InlineNotice } from "@projective/ui/feedback";
import {
	Button,
	FormControl,
	InputText,
	SelectButton,
	useFieldValidation,
} from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { Link } from "@projective/ui/navigation";
import {
	type ArchiveBlockerCode,
	kindCopy,
	WORKSPACE_NAME_MAX,
	type WorkspaceDetail,
	type WorkspaceStatusChange,
	WorkspaceVisibility,
} from "@projective/types/workspace";
import { readDevSeam, subscribeDevSeam } from "@web/utils/dev-seam.ts";
import { WorkspaceService } from "../core/WorkspaceService.ts";
import { archiveRefusal, publishDetail, saveState } from "../core/workspace-state.ts";
import { usePolicyBridge } from "../hooks/usePolicyBridge.ts";
import { useModuleCommit } from "../hooks/useModuleCommit.ts";
import {
	type BlockerLine,
	identityDirty,
	identityPatch,
	nameError,
	refusedBlockers,
	type SettingsInput,
	settingsModel,
	type SettingsSimulation,
	simulateSettings,
	visibilityHint,
} from "../core/settings-model.ts";

/**
 * TeamSettingsScreen — a team console's Settings module (Teams work order C6; TEAMS_AUDIT S1–S5).
 *
 * Three sections, separated by space and one hairline, never boxed (§B.4):
 *
 *   - **Identity** — the display name in a FormControl (an `edit_profile` holder's; the same bounds
 *     `org.update_workspace` holds it to) and the `@handle`, read-only: handles never change.
 *   - **Visibility** — the directory visibility on a SelectButton (`org.update_workspace`, Decision
 *     #230 (h)), named by its visible label, with what the choice means and, until the team is live,
 *     that only members see it.
 *   - **Lifecycle** — the status Tag and what it means, then ONE control: an `archive_entity` holder's
 *     "Archive team…" (danger, text, confirmed) — replaced, while the read lists a held escrow or
 *     live work, by those blockers, each with the link that clears it, never a button that would fail;
 *     on an archived team, Restore (tier 3) named for where the server says it lands (Decision #250
 *     (c)). A refusal that raced the read is said in the same words, in the button's place: its codes
 *     replace Archive at once — here and in the header band's kebab (`archiveRefusal`) — and the
 *     re-read that follows brings their counts to every root. A refusal that names no blocker is said
 *     under the control and takes focus, scrolled into view: the pressed control was disabled while
 *     the write ran, and a refused Publish rides the band, far above the Lifecycle section.
 *
 * Every rule above is `settings-model.ts`, pinned by its test; this island renders it. The one
 * filled control per region (§B.8.1) is split across three roots: Publish, while the team is a draft,
 * is the header band's commit (`useModuleCommit`); Save and Discard for the name and visibility are
 * the footer rig's (`usePolicyBridge`); Restore is the body's. Every write answers with the re-read
 * detail, which replaces this island's copy and is relayed to the lane, band and rig
 * (`publishDetail`) — nothing here patches its own state.
 *
 * The Dev Context Switcher's `teamSettings` axis substitutes the lifecycle after mount (never during
 * hydration); the doors still answer with the server's truth.
 */

/** Props for {@link TeamSettingsScreen} — the console read, serialisable. */
export interface TeamSettingsScreenProps {
	workspace: WorkspaceDetail;
}

/** The lifecycle write in flight, if any. */
type LifecycleMove = "publish" | "archive" | "restore";

/** No refusal since the read. */
const NO_CODES: readonly ArchiveBlockerCode[] = [];

/** How long focus waits for a closing overlay to let the page go: 40 × 50 ms — two seconds at most. */
const FOCUS_WAITS = 40;
const FOCUS_WAIT_MS = 50;

/**
 * The settings input the model reads, straight off the detail, plus the blocker codes a refused
 * archive named since that read (`raced`).
 */
function inputOf(ws: WorkspaceDetail, raced: readonly ArchiveBlockerCode[]): SettingsInput {
	return {
		kind: ws.kind,
		id: ws.id,
		name: ws.name,
		handle: ws.handle,
		status: ws.status,
		visibility: ws.visibility,
		capabilities: ws.viewerCapabilities,
		archiveBlockers: ws.archiveBlockers,
		raced,
		restoreTarget: ws.restoreTarget,
		memberCount: ws.members.length,
	};
}

export default function TeamSettingsScreen(props: TeamSettingsScreenProps): JSX.Element {
	// #region State
	/** The server's projection — replaced wholesale by every write's re-read, never patched here. */
	const detail = useSignal(props.workspace);
	/**
	 * What a refused archive named since the read — it stands in for Archive until the re-read lands.
	 * Held in `workspace-state` (`archiveRefusal`), so the header band withholds its Archive… too.
	 */
	const raced = useComputed(() => {
		const refusal = archiveRefusal.value;
		return refusal && refusal.id === detail.value.id ? refusal.codes : NO_CODES;
	});
	const forced = useSignal<SettingsSimulation | undefined>(undefined);
	const model = useComputed(() =>
		settingsModel(simulateSettings(inputOf(detail.value, raced.value), forced.value))
	);

	/** The identity being edited, and the last saved one it is measured against. */
	const name = useSignal(props.workspace.name);
	const saved = useSignal({ name: props.workspace.name, visibility: props.workspace.visibility });
	/** The SelectButton's own binding (a string signal), read back as a visibility. */
	const visibilityPick = useSignal<string>(props.workspace.visibility);
	const visibility = useComputed(() =>
		WorkspaceVisibility.catch(saved.value.visibility).parse(visibilityPick.value)
	);
	const dirty = useComputed(() =>
		identityDirty(saved.value, { name: name.value, visibility: visibility.value })
	);
	/** Set by a save, so a name nobody has left yet is still judged when Save is pressed. */
	const reveal = useSignal(false);
	/** The server's word on the name (a refusal keyed to it), cleared by the next keystroke. */
	const nameRefusal = useSignal<string | null>(null);
	const nameField = useFieldValidation({
		problem: () => nameRefusal.value ?? nameError(name.value),
		reveal,
		initiallyTouched: true,
	});
	const saveError = useSignal<string | null>(null);

	const moving = useSignal<LifecycleMove | null>(null);
	/** A lifecycle refusal that named no blocker — said beside the control. */
	const failure = useSignal<string | null>(null);
	const confirmArchive = useSignal(false);
	/** The status line, where focus lands once a lifecycle change has replaced the pressed control. */
	const statusRef = useRef<HTMLDivElement>(null);
	/** The blockers' list, where focus lands when a refusal has replaced the Archive button with it. */
	const blockersRef = useRef<HTMLUListElement>(null);
	/** A refusal that named no blocker, where focus lands once the pressed control has let it go. */
	const failureRef = useRef<HTMLDivElement>(null);

	// The dev seam is a DOM attribute set, so it is read after mount and on every switcher change.
	useEffect(() => {
		forced.value = readDevSeam()?.teamSettings;
		return subscribeDevSeam((s) => {
			forced.value = s?.teamSettings;
		});
	}, []);
	// A refusal this screen had never outlives it.
	useEffect(() => () => {
		archiveRefusal.value = null;
	}, []);
	// #endregion

	// #region Adopting the server's answer
	/**
	 * Take the re-read detail as the truth here and on every other root. A lifecycle move keeps the
	 * name and visibility being edited (`keepDraft`): it changed neither, and an unsaved edit is still
	 * the reader's to save or discard.
	 */
	function adopt(next: WorkspaceDetail, keepDraft = false): void {
		batch(() => {
			detail.value = next;
			archiveRefusal.value = null;
			saved.value = { name: next.name, visibility: next.visibility };
			if (keepDraft) return;
			name.value = next.name;
			visibilityPick.value = next.visibility;
		});
		publishDetail(next);
	}
	// #endregion

	// #region Identity — the footer rig's Save and Discard
	async function save(): Promise<void> {
		reveal.value = true;
		if (nameField.problem.value) {
			saveState.value = "error";
			return;
		}
		const patch = identityPatch(saved.value, { name: name.value, visibility: visibility.value });
		if (Object.keys(patch).length === 0) return;
		saveState.value = "saving";
		saveError.value = null;
		const ws = detail.value;
		const res = await WorkspaceService.update({ kind: ws.kind, id: ws.id, ...patch });
		if (!res.ok || !res.data) {
			saveState.value = "error";
			nameRefusal.value = res.errors?.name ?? null;
			saveError.value = res.errors?.name ? null : res.message ?? "Could not save the settings.";
			return;
		}
		saveState.value = "saved";
		reveal.value = false;
		adopt(res.data);
	}

	/** Return the name and visibility to their last saved values. */
	function discard(): void {
		batch(() => {
			name.value = saved.value.name;
			visibilityPick.value = saved.value.visibility;
			nameRefusal.value = null;
			saveError.value = null;
			reveal.value = false;
		});
	}

	usePolicyBridge({ dirty, save, discard });
	// #endregion

	// #region Lifecycle — Publish (header band), Archive and Restore (here)
	/**
	 * Put focus where the pressed control was, once it has been replaced (after the next render).
	 * `reveal` scrolls the target into view as it takes focus — a refused Publish is said in the
	 * Lifecycle section, which can sit below the fold.
	 *
	 * An answer can land while the archive confirm is still closing: its focus trap holds the page
	 * `inert`, so a focus call then is dropped, and the trap hands focus back to its trigger as it
	 * lets go — a control that is disabled, or already gone. So focus waits for the page to be live
	 * again (a bounded wait), and lands last.
	 */
	function focusLater(target: { current: HTMLElement | null }, reveal = false): void {
		let waits = 0;
		const land = () => {
			const el = target.current;
			if (!el) return;
			if (el.closest("[inert]") && waits++ < FOCUS_WAITS) {
				setTimeout(land, FOCUS_WAIT_MS);
				return;
			}
			el.focus({ preventScroll: !reveal });
		};
		setTimeout(land, 0);
	}

	/**
	 * Re-read the detail after a refusal that raced the read, and adopt it here and on every other
	 * root — so the blockers arrive counted everywhere. A failed re-read leaves the refusal's codes
	 * standing in, here and in the header band's kebab.
	 */
	async function reread(ws: WorkspaceDetail): Promise<void> {
		const res = await WorkspaceService.detail(ws.kind, ws.handle);
		if (res.ok && res.data) adopt(res.data, true);
	}

	/**
	 * Move the team through `org.set_workspace_status`. A refusal that names blockers replaces the
	 * archive control with them at once (`archiveRefusal`, which the header band's kebab honours too)
	 * — never leaving a button that would fail again — and re-reads the detail, and focus moves onto
	 * that list. Any other refusal is said under the control, and focus moves onto it: the pressed
	 * control was disabled while the write ran, so the browser had already let go of it. A landed
	 * move replaces the detail, and focus moves to the status line — the control that was pressed is
	 * gone.
	 */
	async function move(kind: LifecycleMove, status: WorkspaceStatusChange): Promise<void> {
		moving.value = kind;
		failure.value = null;
		const ws = detail.value;
		const res = await WorkspaceService.update({ kind: ws.kind, id: ws.id, status });
		moving.value = null;
		if (!res.ok || !res.data) {
			const codes = refusedBlockers(res.details?.blockers);
			if (codes.length > 0) {
				archiveRefusal.value = { id: ws.id, codes };
				focusLater(blockersRef);
				void reread(ws);
				return;
			}
			failure.value = res.message ?? "That couldn't be completed. Nothing was changed.";
			focusLater(failureRef, true);
			return;
		}
		adopt(res.data, true);
		focusLater(statusRef);
	}

	useModuleCommit(() => {
		const commit = model.value.commit;
		if (!commit) return null;
		const busy = moving.value;
		return {
			...commit,
			busy: busy === "publish",
			disabled: busy !== null && busy !== "publish",
			run: () => void move("publish", "active"),
		};
	});
	// #endregion

	const view = model.value;
	const ws = detail.value;
	const copy = kindCopy(ws.kind);
	const control = view.lifecycle.control;
	const failed = failure.value;
	const visibilityLabel = view.visibility.options.find((o) => o.value === ws.visibility)?.label ??
		ws.visibility;
	/** The visibility field's visible label — also the radiogroup's accessible name (label in name). */
	const whoCanSee = `Who can see /@${ws.handle}`;

	return (
		<div class="wsp" data-kind={ws.kind}>
			<div class="wsp__stack">

				<div class="wsp-band wsp-band--page wsp-band--tail" data-i={1}>
					<div class="wsp-band__inner wsp-settings">
						{/* #region Identity */}
						<section class="wsp-settings__section" aria-labelledby="wsp-settings-identity">
							<h2 class="wsp-settings__title" id="wsp-settings-identity">Identity</h2>
							<div class="wsp-settings__body">
								{view.identity.editable
									? (
										<FormControl
											class="wsp-settings__field"
											label="Display name"
											hint={`How the ${copy.noun} is named on /@${ws.handle} and across Projective.`}
											status={nameField.hintStatus.value}
											error={nameField.message.value ?? undefined}
										>
											{({ id, describedBy }) => (
												<InputText
													id={id}
													aria-describedby={describedBy}
													value={name}
													onValueChange={() => {
														nameRefusal.value = null;
														saveError.value = null;
													}}
													status={nameField.status.value}
													onFocus={nameField.handlers.onFocus}
													onBlur={nameField.handlers.onBlur}
													maxLength={WORKSPACE_NAME_MAX}
													autoComplete="off"
													block
												/>
											)}
										</FormControl>
									)
									: (
										<Fact
											label="Display name"
											value={ws.name}
											note={`Members who may edit the ${copy.noun}'s profile can rename it`}
										/>
									)}
								<Fact
									label="Handle"
									value={view.identity.handleText}
									note={view.identity.handleNote}
								/>
								{view.identity.editable && (
									<p class="wsp-settings__note">
										<MetaLine
											as="span"
											items={["Mark, banner and story are edited on the public profile"]}
										/>{" "}
										<Link href={`/@${ws.handle}/edit`}>Edit the profile</Link>
									</p>
								)}
								{saveError.value && (
									<InlineNotice
										class="wsp-settings__failure"
										assertive
										align="start"
										text={saveError.value}
									/>
								)}
							</div>
						</section>
						{/* #endregion */}

						{/* #region Visibility */}
						<section class="wsp-settings__section" aria-labelledby="wsp-settings-visibility">
							<h2 class="wsp-settings__title" id="wsp-settings-visibility">Visibility</h2>
							<div class="wsp-settings__body">
								{view.visibility.editable
									? (
										<FormControl
											class="wsp-settings__field"
											label={whoCanSee}
											hint={visibilityHint(visibility.value, ws.handle)}
										>
											{({ id, describedBy }) => (
												<SelectButton
													id={id}
													aria-label={whoCanSee}
													aria-describedby={describedBy}
													options={view.visibility.options}
													value={visibilityPick}
													onValueChange={() => {
														saveError.value = null;
													}}
												/>
											)}
										</FormControl>
									)
									: (
										<Fact
											label={whoCanSee}
											value={visibilityLabel}
											note={view.visibility.hint}
										/>
									)}
								{view.visibility.statusNote && (
									<MetaLine class="wsp-settings__note" items={[view.visibility.statusNote]} />
								)}
							</div>
						</section>
						{/* #endregion */}

						{/* #region Lifecycle */}
						<section class="wsp-settings__section" aria-labelledby="wsp-settings-lifecycle">
							<h2 class="wsp-settings__title" id="wsp-settings-lifecycle">Lifecycle</h2>
							<div class="wsp-settings__body">
								<div class="wsp-settings__status" ref={statusRef} tabIndex={-1}>
									<Tag
										value={view.lifecycle.tag.label}
										severity={view.lifecycle.tag.severity}
										variant="subtle"
										rounded
									/>
									<MetaLine as="span" items={view.lifecycle.facts} />
								</div>

								{control.kind === "archive" && (
									<div class="wsp-settings__action">
										<Button
											severity="danger"
											variant="text"
											label={control.label}
											loading={moving.value === "archive"}
											disabled={moving.value !== null}
											onClick={() => {
												confirmArchive.value = true;
											}}
										/>
										<MetaLine items={control.facts} />
									</div>
								)}

								{control.kind === "blocked" && (
									<Blockers lines={control.blockers} listRef={blockersRef} />
								)}

								{control.kind === "restore" && (
									<div class="wsp-settings__action">
										<Button
											label={control.label}
											loading={moving.value === "restore"}
											disabled={moving.value !== null}
											onClick={() => void move("restore", "restore")}
										/>
									</div>
								)}

								{control.kind === "none" && control.note && (
									<MetaLine class="wsp-settings__note" items={[control.note]} />
								)}

								{failed && (
									<div class="wsp-settings__refusal" ref={failureRef} tabIndex={-1}>
										<InlineNotice
											class="wsp-settings__failure"
											assertive
											align="start"
											text={failed}
										/>
									</div>
								)}
							</div>
						</section>
						{/* #endregion */}
					</div>
				</div>
			</div>

			{/* #region Overlays */}
			{control.kind === "archive" && (
				<ConfirmDialog
					visible={confirmArchive}
					header={control.confirm.header}
					message={control.confirm.message}
					acceptLabel={control.confirm.accept}
					rejectLabel={control.confirm.reject}
					acceptSeverity="danger"
					onAccept={() => void move("archive", "archived")}
				/>
			)}
			{/* #endregion */}
		</div>
	);
}

// #region Parts
/** A value this viewer cannot change here, said as text — never a disabled field. */
function Fact(props: { label: string; value: string; note: string }): JSX.Element {
	return (
		<dl class="wsp-settings__fact">
			<dt class="wsp-settings__factlabel">{props.label}</dt>
			<dd class="wsp-settings__factvalue">{props.value}</dd>
			<dd class="wsp-settings__factnote">
				<MetaLine as="span" items={[props.note]} />
			</dd>
		</dl>
	);
}

/**
 * The blockers that stand in for Archive — one InlineNotice each, with the link that clears it.
 * Focusable from script (`tabIndex={-1}`), so a refusal that put them in the button's place can move
 * focus onto them.
 */
function Blockers(
	props: { lines: readonly BlockerLine[]; listRef: Ref<HTMLUListElement> },
): JSX.Element {
	return (
		<ul
			class="wsp-settings__blockers"
			aria-label="What archiving waits on"
			ref={props.listRef}
			tabIndex={-1}
		>
			{props.lines.map((line) => (
				<li key={line.code}>
					<InlineNotice
						class="wsp-settings__blocker"
						align="start"
						icon={<Icon name="lock" size="sm" />}
					>
						{line.text} <Link href={line.link.href}>{line.link.label}</Link>
					</InlineNotice>
				</li>
			))}
		</ul>
	);
}
// #endregion
