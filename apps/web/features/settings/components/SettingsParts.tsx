import { createContext, type JSX } from "preact";
import type { ComponentChildren } from "preact";
import { useContext, useLayoutEffect } from "preact/hooks";
import { type Signal, useSignal } from "@preact/signals";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import { InlineNotice } from "@projective/ui/feedback";
import { anchorId, type SettingsSectionKey } from "../core/settings-registry.ts";
import { readStored, SessionKeys, writeStored } from "@web/utils/storage-keys.ts";

/**
 * SettingsParts — the few shapes every Settings section is built from (Decision #150), so the modal
 * and the console page draw the same section identically and a new section needs no new CSS.
 *
 * Structure follows the separation hierarchy (DESIGN_SYSTEM §B.4): a section is a column of BLOCKS
 * separated by spacing and one hairline; a block is a section-header-register title, a meta lede and
 * ROWS; a row is a label + description beside its control. Nothing is boxed — the only fills belong
 * to controls.
 */

// #region Synced field value
/**
 * A field's bound value that FOLLOWS `value`. `@projective/ui/fields` seed a raw `value` prop once and
 * never re-read it (`useControllable`), so a control whose value can change from outside — a revert
 * after a refused save, the account's copy adopted on load — must be handed a Signal. This one is
 * written by the control on input and re-synced here whenever the source of truth moves.
 */
export function useSynced<T>(value: T): Signal<T> {
	const sig = useSignal(value);
	useLayoutEffect(() => {
		if (!Object.is(sig.peek(), value)) sig.value = value;
	}, [value]);
	return sig;
}
// #endregion

// #region Drafts
function readDrafts(): Record<string, unknown> {
	try {
		const raw = readStored("session", SessionKeys.SETTINGS_DRAFTS);
		const parsed = raw ? JSON.parse(raw) : null;
		return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
	} catch {
		return {};
	}
}

function writeDraft(section: string, value: unknown | undefined): void {
	const drafts = readDrafts();
	if (value === undefined) delete drafts[section];
	else drafts[section] = value;
	writeStored("session", SessionKeys.SETTINGS_DRAFTS, JSON.stringify(drafts));
}

/**
 * A section's editable draft that survives the hop from the modal to the console page (and a reload):
 * every edit is mirrored to session storage, and a fresh mount adopts a stored draft over the server's
 * value. `dirty` says whether it differs from `initial`; `clear()` drops the stored copy (after a save
 * or a discard). Only for forms with an explicit Save — instant-apply controls have nothing to lose.
 */
export function useSectionDraft<T>(
	section: SettingsSectionKey,
	initial: T,
): { draft: Signal<T>; dirty: boolean; set: (next: T) => void; clear: (next?: T) => void } {
	const draft = useSignal<T>(initial);
	useLayoutEffect(() => {
		const stored = readDrafts()[section];
		if (stored !== undefined) draft.value = stored as T;
	}, []);
	const dirty = JSON.stringify(draft.value) !== JSON.stringify(initial);
	return {
		draft,
		dirty,
		set: (next: T) => {
			draft.value = next;
			writeDraft(section, JSON.stringify(next) === JSON.stringify(initial) ? undefined : next);
		},
		clear: (next?: T) => {
			writeDraft(section, undefined);
			if (next !== undefined) draft.value = next;
		},
	};
}
// #endregion

// #region Surface context
/** Where a section is drawn — headings and escalations differ, nothing else does. */
export interface SettingsSurface {
	mode: "modal" | "page";
}

export const SettingsSurfaceContext = createContext<SettingsSurface>({ mode: "page" });

/** The heading tags for a surface: the page owns `h1`; inside the modal, the dialog's `h2` does. */
function headingTags(mode: SettingsSurface["mode"]): { title: "h1" | "h3"; block: "h2" | "h4" } {
	return mode === "page" ? { title: "h1", block: "h2" } : { title: "h3", block: "h4" };
}
// #endregion

// #region Section head
/** A section's title and lede. */
export function SectionHead(
	props: { title: string; description: string; id?: string },
): JSX.Element {
	const { mode } = useContext(SettingsSurfaceContext);
	const Tag = headingTags(mode).title;
	return (
		<header class={`stg-head stg-head--${mode}`}>
			<Tag id={props.id} class="stg-head__title">{props.title}</Tag>
			<p class="stg-head__lede">{props.description}</p>
		</header>
	);
}
// #endregion

// #region Block
/** One block of a section — the unit a registry anchor points at. */
export function SettingsBlock(
	props: {
		anchor: string;
		title: string;
		description?: string;
		children: ComponentChildren;
		class?: string;
	},
): JSX.Element {
	const { mode } = useContext(SettingsSurfaceContext);
	const Tag = headingTags(mode).block;
	const titleId = `${anchorId(props.anchor)}-title`;
	return (
		<section
			class={`stg-block${props.class ? ` ${props.class}` : ""}`}
			id={anchorId(props.anchor)}
			aria-labelledby={titleId}
			data-anchor={props.anchor}
		>
			<div class="stg-block__head">
				<Tag id={titleId} class="stg-block__title">{props.title}</Tag>
				{props.description ? <p class="stg-block__lede">{props.description}</p> : null}
			</div>
			<div class="stg-block__body">{props.children}</div>
		</section>
	);
}
// #endregion

// #region Row
/**
 * A label + description beside a control. The control is passed already labelled — pass `labelId` /
 * `descId` through to its `aria-labelledby` / `aria-describedby` so it is named by the visible text.
 */
export function SettingsRow(
	props: {
		label: string;
		description?: ComponentChildren;
		control: ComponentChildren;
		labelId?: string;
		descId?: string;
		locked?: boolean;
		class?: string;
	},
): JSX.Element {
	return (
		<div
			class={`stg-row${props.locked ? " stg-row--locked" : ""}${
				props.class ? ` ${props.class}` : ""
			}`}
		>
			<div class="stg-row__text">
				<span id={props.labelId} class="stg-row__label">
					{props.locked
						? <Icon name="lock" size="xs" aria-hidden="true" class="stg-row__lock" />
						: null}
					{props.label}
				</span>
				{props.description
					? <span id={props.descId} class="stg-row__desc">{props.description}</span>
					: null}
			</div>
			<div class="stg-row__control">{props.control}</div>
		</div>
	);
}
// #endregion

// #region Status
/** The state of a section's last write. */
export interface SaveState {
	tone: "idle" | "busy" | "saved" | "device" | "error";
	text: string;
}

export const IDLE: SaveState = { tone: "idle", text: "" };

/**
 * A polite live region that says what the last change did — "Saved", "Saved on this device only",
 * or the server's sentence. Always mounted (empty when idle) so assistive tech hears every update.
 */
export function SaveStatus(props: { state: SaveState; class?: string }): JSX.Element {
	const { tone, text } = props.state;
	return (
		<p
			class={`stg-status stg-status--${tone}${props.class ? ` ${props.class}` : ""}`}
			role={tone === "error" ? "alert" : "status"}
			aria-live={tone === "error" ? "assertive" : "polite"}
		>
			{tone === "saved" ? <Icon name="check" size="xs" aria-hidden="true" /> : null}
			{tone === "error" || tone === "device"
				? <Icon name="warning" size="xs" aria-hidden="true" />
				: null}
			{text}
		</p>
	);
}
// #endregion

// #region Action footer
/**
 * The action footer of a form section — the last stop of the keyboard order (search → tree → fields
 * → footer). It pins to the bottom of the scrolling pane so Save can never scroll out of view
 * (DESIGN_SYSTEM §B.10.8), and states whether there is anything to save.
 */
export function FormFooter(
	props: {
		dirty: boolean;
		busy: boolean;
		onSave: () => void;
		onDiscard: () => void;
		saveLabel?: string;
		state: SaveState;
	},
): JSX.Element {
	return (
		<div class="stg-footer" role="group" aria-label="Save changes">
			<SaveStatus state={props.state} class="stg-footer__status" />
			<span class="stg-footer__dirty">{props.dirty ? "Unsaved changes" : ""}</span>
			<Button
				variant="text"
				severity="secondary"
				label="Discard"
				disabled={!props.dirty || props.busy}
				onClick={props.onDiscard}
			/>
			<Button
				label={props.saveLabel ?? "Save changes"}
				loading={props.busy}
				disabled={!props.dirty}
				onClick={props.onSave}
			/>
		</div>
	);
}
// #endregion

// #region Escalation
/**
 * The page-only safeguard: in the modal, a section too large for it shows its status and ONE
 * high-visibility way into the console. Never hidden, never disabled — always an escalation.
 */
export function EscalationNotice(
	props: {
		text: string;
		actionLabel: string;
		onEscalate: () => void;
		children?: ComponentChildren;
	},
): JSX.Element {
	return (
		<div class="stg-escalate">
			<InlineNotice align="start" text={props.text} icon={<Icon name="info" size="sm" />} />
			{props.children}
			<Button
				class="stg-escalate__go"
				label={props.actionLabel}
				icon={<Icon name="arrow-right" size="sm" />}
				iconPos="right"
				onClick={props.onEscalate}
			/>
		</div>
	);
}

/** A plain link out of settings to the surface that owns a setting. */
export function OutLink(props: { href: string; children: ComponentChildren }): JSX.Element {
	return (
		<a class="stg-outlink" href={props.href}>
			{props.children}
			<Icon name="arrow-right" size="xs" aria-hidden="true" />
		</a>
	);
}

/** One section a handler can take the person to, with what triggered it. */
export interface EscalateTarget {
	section: SettingsSectionKey;
	anchor?: string | null;
}
// #endregion
