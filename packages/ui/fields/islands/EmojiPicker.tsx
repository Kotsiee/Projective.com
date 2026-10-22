/// <reference lib="dom" />
import type { JSX, RefObject, VNode } from "preact";
import { useRef } from "preact/hooks";
import "../styles/emoji-picker.css";
import { cx } from "../../core/cx.ts";
import { Popover, type PopoverTriggerApi } from "../../feedback/islands/Popover.tsx";
import { EmojiPickerPanel } from "../components/EmojiPickerPanel.tsx";
import type { EmojiEntry } from "../core/emoji-data.ts";
import type { BoundarySource, Side } from "../../hooks/useFloating.ts";
import type { Placement } from "../../types/mod.ts";
import type { Bindable } from "../types/mod.ts";

/** Props for {@link EmojiPicker}. */
export interface EmojiPickerProps {
	/** Controlled/uncontrolled open state. */
	open?: Bindable<boolean>;
	/** Render-prop for the trigger; wire `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls`. */
	trigger: (api: PopoverTriggerApi) => VNode;
	/** Insert one emoji. The picker stays open so several can be picked in a row. */
	onSelect: (entry: EmojiEntry) => void;
	/**
	 * The picker closed from the keyboard (Escape, or Backspace on an empty search) and the host
	 * should take focus back, typically into its message field at the saved caret.
	 */
	onReturnFocus?: () => void;
	/** Fired whenever the open state changes — capture the host field's selection on `true`. */
	onOpenChange?: (open: boolean) => void;
	/** Preferred side/alignment; flips on overflow (default `top-end`). */
	placement?: Placement;
	/** Layout zones the panel must never cover (see `PopoverProps.avoid`). */
	avoid?: readonly BoundarySource[];
	/** Viewport edges the panel may overflow (see `PopoverProps.allowOverflow`). */
	allowOverflow?: readonly Side[];
	/** The panel's root, for a host that scopes a shortcut to "focus is in the picker". */
	panelRef?: RefObject<HTMLDivElement>;
	/** Extra class(es) merged onto the popover panel. */
	class?: string;
}

/**
 * EmojiPicker — an anchored, non-modal popover for inserting emoji into a field: a search field
 * (lexical, fuzzy and feeling-word search over CLDR labels, tags, GitHub shortcodes and emoticons),
 * a category bar (scrolls to a section while browsing, filters while searching) and a scrolling
 * emoji grid with a 2D roving tabindex. Picking does not close it; Escape, an outside press or the
 * trigger does. Focus starts in the search field on a precise pointer, and on the panel itself on
 * touch so opening does not raise the on-screen keyboard over the grid.
 *
 * The dataset (`emojibase-data`) is fetched on first open from `EMOJIBASE_VENDOR`, which the
 * host must serve; it is never bundled. The picker owns no caret: the host records its field's
 * selection on open and inserts each {@link EmojiEntry.emoji} it receives at that position.
 *
 * @example
 * ```tsx
 * <EmojiPicker
 *   open={open}
 *   onOpenChange={(o) => o && field.saveCaret()}
 *   onSelect={(e) => field.insertAtCaret(e.emoji)}
 *   onReturnFocus={() => field.focusAtCaret()}
 *   trigger={(api) => <button ref={api.ref} aria-haspopup="dialog" … onClick={api.toggle} />}
 * />
 * ```
 */
export function EmojiPicker(props: EmojiPickerProps): JSX.Element {
	const {
		open,
		trigger,
		onSelect,
		onReturnFocus,
		onOpenChange,
		placement = "top-end",
		avoid,
		allowOverflow,
		panelRef,
		class: className,
	} = props;
	const searchRef = useRef<HTMLInputElement>(null);
	const ownRootRef = useRef<HTMLDivElement>(null);
	const rootRef = panelRef ?? ownRootRef;
	const finePointer = typeof globalThis.matchMedia === "function" &&
		globalThis.matchMedia("(pointer: fine)").matches;
	const closeRef = useRef<() => void>(() => {});

	return (
		<Popover
			open={open}
			label="Emoji picker"
			placement={placement}
			avoid={avoid}
			allowOverflow={allowOverflow}
			closeOnEscape={false}
			restoreFocus={false}
			initialFocusRef={finePointer ? searchRef : rootRef}
			initialFocusSelf={!finePointer}
			onOpenChange={onOpenChange}
			class={cx("ui-emoji-picker-pop", className)}
			trigger={(api) => {
				closeRef.current = api.close;
				return trigger(api);
			}}
		>
			<EmojiPickerPanel
				rootRef={rootRef}
				searchRef={searchRef}
				onSelect={onSelect}
				onReturn={() => {
					closeRef.current();
					onReturnFocus?.();
				}}
			/>
		</Popover>
	);
}
