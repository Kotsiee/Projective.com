import type { ComponentChildren, JSX, RefObject } from "preact";
import type { Signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Tooltip } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { EditAnchor } from "../../core/owner-edit.ts";
import { setBlockDirty } from "../../core/owner-store.ts";

/**
 * OwnerBlock — the owner's in-place editing idiom on `/[handle]` (Decision #439). A block reads exactly
 * as a visitor's does; its pencil ({@link OwnerEditButton}, tier 4, revealed on hover or focus under
 * `(hover: hover)`, always on touch) swaps the content for its form ({@link BlockForm}) in the same
 * place, and Save or Cancel swaps it back. Nothing is edited by accident: a block changes only after
 * the pencil and an explicit Save. A visitor's page carries none of this markup.
 */

// #region Pencil
export interface OwnerEditButtonProps {
	/** What it edits, as the control reads after "Edit" — e.g. `your skills`. */
	label: string;
	onClick: () => void;
	buttonRef?: RefObject<HTMLButtonElement>;
	/** `aria-controls` — the block the editor opens in. */
	controls?: string;
}

/** The owner's pencil: icon-only, neutral outlined, named by its tooltip and its accessible name. */
export function OwnerEditButton(
	{ label, onClick, buttonRef, controls }: OwnerEditButtonProps,
): JSX.Element {
	const name = `Edit ${label}`;
	return (
		<Tooltip content={name} density="compact">
			<button
				type="button"
				ref={buttonRef}
				class="ui-button ui-button--neutral ui-button--outlined ui-button--size-sm ui-button--icon-only ui-hit pf-owneredit"
				aria-label={name}
				aria-controls={controls}
				onClick={onClick}
			>
				<span class="ui-button__icon" aria-hidden="true">
					<Icon name="edit" size="sm" />
				</span>
			</button>
		</Tooltip>
	);
}
// #endregion

// #region Form
export interface BlockFormProps {
	/** The form's accessible name, e.g. "Edit your skills". */
	label: string;
	/** Who the unsaved-edit guard counts this form as. */
	guardId: string;
	dirty: boolean;
	busy: boolean;
	/** A refusal or status line, read out politely. */
	message?: string;
	onSave: () => void;
	onCancel: () => void;
	/** A secondary control at the start of the bar (e.g. "Display settings"). */
	aside?: ComponentChildren;
	saveLabel?: string;
	children: ComponentChildren;
}

const FIRST_FIELD =
	"input:not([type='hidden']):not([disabled]), textarea:not([disabled]), [role='combobox']";

/**
 * BlockForm — one block's editor: its fields, then a bar with the status line, Cancel and Save.
 * Focus moves to the first field on open; Escape cancels and Ctrl ⁄ ⌘ + S saves from any field.
 * Save stays enabled while busy (`aria-busy`, guarded) so focus is never dropped by a disabled button.
 */
export function BlockForm(props: BlockFormProps): JSX.Element {
	const root = useRef<HTMLFormElement>(null);

	useEffect(() => {
		const id = setTimeout(() => {
			const field = root.current?.querySelector<HTMLElement>(FIRST_FIELD);
			if (field && root.current?.contains(document.activeElement) !== true) field.focus();
		}, 0);
		return () => clearTimeout(id);
	}, []);

	useEffect(() => {
		setBlockDirty(props.guardId, props.dirty);
	}, [props.dirty, props.guardId]);
	useEffect(() => () => setBlockDirty(props.guardId, false), [props.guardId]);

	function save(): void {
		if (props.busy || !props.dirty) return;
		props.onSave();
	}

	return (
		<form
			ref={root}
			class="pf-inline"
			aria-label={props.label}
			aria-busy={props.busy ? "true" : undefined}
			noValidate
			onSubmit={(e) => {
				e.preventDefault();
				save();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape" && !e.defaultPrevented) {
					e.preventDefault();
					props.onCancel();
				} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
					e.preventDefault();
					save();
				}
			}}
		>
			<div class="pf-inline__fields">{props.children}</div>
			<div class="pf-inline__bar">
				<p class="pf-inline__status" role="status" aria-live="polite">{props.message ?? ""}</p>
				<div class="pf-inline__actions">
					{props.aside}
					<Button variant="text" class="pf-edit__ghost" onClick={props.onCancel}>Cancel</Button>
					<Button
						type="submit"
						class="pf-edit__save"
						aria-busy={props.busy ? "true" : undefined}
						disabled={!props.dirty}
					>
						{props.busy ? "Saving…" : props.saveLabel ?? "Save"}
					</Button>
				</div>
			</div>
		</form>
	);
}
// #endregion

// #region Block
export interface InlineEditBlockProps {
	anchor: EditAnchor;
	/** The block's heading, as a visitor reads it ("Skills"); omit for a block that has none. */
	title?: string;
	/** What the pencil names after "Edit" — "your skills". */
	label: string;
	editing: Signal<boolean>;
	/** The visitor's content, or `null` when a visitor would see no block here. */
	view: ComponentChildren | null;
	/** One line, in place of an empty view: what visitors see once it is filled. */
	stub: string;
	/** The editor, mounted only while editing. */
	editor: () => ComponentChildren;
	class?: string;
}

/**
 * InlineEditBlock — the shell every editable block shares: the heading with the pencil at its end
 * (or, headless, the content beside it), the content or a one-line stub, and the editor in their
 * place while open. Closing returns focus to the pencil.
 */
export function InlineEditBlock(props: InlineEditBlockProps): JSX.Element {
	const pencil = useRef<HTMLButtonElement>(null);
	const wasEditing = useRef(false);
	const editing = props.editing.value;

	useEffect(() => {
		if (wasEditing.current && !editing) {
			const id = setTimeout(() => pencil.current?.focus(), 0);
			wasEditing.current = false;
			return () => clearTimeout(id);
		}
		wasEditing.current = editing;
	}, [editing]);

	const open = () => (props.editing.value = true);
	const button = !editing && (
		<OwnerEditButton
			label={props.label}
			onClick={open}
			buttonRef={pencil}
			controls={props.anchor}
		/>
	);
	const body = editing
		? props.editor()
		: props.view ?? <p class="pf-ownerstub__note">{props.stub}</p>;

	return (
		<div
			id={props.anchor}
			class={`pf-ownerblock${props.class ? ` ${props.class}` : ""}`}
			data-editing={editing ? "true" : undefined}
		>
			{props.title
				? (
					<>
						<div class="pf-ownerhead">
							<h2 class="pf-h">{props.title}</h2>
							{button}
						</div>
						{body}
					</>
				)
				: (
					<div class="pf-ownerblock__row">
						<div class="pf-ownerblock__content">{body}</div>
						{button}
					</div>
				)}
		</div>
	);
}
// #endregion
