import type { JSX, VNode } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/sort-control.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useFloating } from "../../hooks/useFloating.ts";
import { useDismiss } from "../../hooks/useDismiss.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import type { Bindable, FieldSize } from "../types/mod.ts";

/**
 * SortControl — the dedicated sorting module: a sort-PROPERTY dropdown and the ascending/descending
 * DIRECTION toggle inside ONE compound block (never two loose controls). Borderless in the resting
 * state — no outline until hover (a faint surface tint) or focus (a soft ring) — with a tight,
 * compact enterprise footprint. Both value + direction are signal-first (`Bindable`): pass a `Signal`
 * to share state with a table's header sort so the toolbar and the columns stay one source of truth.
 *
 * The property menu is a `role="listbox"` positioned by `useFloating` (viewport-flipping) and closed
 * by `useDismiss` (outside pointer / Escape). Every control carries an `aria-label`; the direction
 * toggle announces its next action. Dumb island: no data access.
 */
export type SortDirection = "asc" | "desc";

export interface SortOption {
	value: string;
	label: string;
	/** Optional leading glyph for the option row + trigger. */
	icon?: VNode;
}

export interface SortControlProps {
	/** The sort properties to choose between. */
	options: SortOption[];
	/** Selected sort key (raw = uncontrolled; `Signal` = controlled). */
	value?: Bindable<string>;
	onValueChange?: (value: string) => void;
	/** Sort direction (raw = uncontrolled; `Signal` = controlled). */
	direction?: Bindable<SortDirection>;
	onDirectionChange?: (dir: SortDirection) => void;
	size?: FieldSize;
	/** Prefix shown before the property label on the trigger (default "Sort"). */
	label?: string;
	class?: string;
	"aria-label"?: string;
}

const ChevronGlyph = (
	<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
		<path
			d="M4 6l4 4 4-4"
			stroke="currentColor"
			stroke-width="1.6"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
);

/** A single arrow whose direction flips with the sort direction (up = asc, down = desc). */
function DirGlyph({ dir }: { dir: SortDirection }): JSX.Element {
	return (
		<svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
			<path
				d="M8 3v10"
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
			/>
			<path
				d={dir === "asc" ? "M4.5 6.5L8 3l3.5 3.5" : "M4.5 9.5L8 13l3.5-3.5"}
				stroke="currentColor"
				stroke-width="1.6"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	);
}

const CheckGlyph = (
	<svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
		<path
			d="M3 8.5l3 3 7-7"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
);

export function SortControl(props: SortControlProps): JSX.Element {
	const {
		options,
		value,
		onValueChange,
		direction,
		onDirectionChange,
		size = "sm",
		label = "Sort",
		class: className,
		"aria-label": ariaLabel,
	} = props;

	const val = useControllable<string>(value, options[0]?.value ?? "", onValueChange);
	const dir = useControllable<SortDirection>(direction, "asc", onDirectionChange);
	const open = useSignal(false);

	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	// The menu carries `.ui-anchored`, whose z-index resolves to the popover BASE unless a claim writes
	// `--z-portal` — so an unclaimed menu opened from inside a modal painted underneath it. The claim
	// fixes the paint order and hands the menu Escape ownership over the surface beneath.
	const stack = useOverlayStack({ active: open.value, layer: "popover" });
	const float = useFloating({
		open: open.value,
		triggerRef,
		panelRef: menuRef,
		placement: "bottom-start",
		offset: 6,
	});
	useDismiss({
		open: open.value,
		enabled: stack.isTop,
		onDismiss: () => (open.value = false),
		panelRef: menuRef,
		triggerRef,
	});

	const active = options.find((o) => o.value === val.signal.value) ?? options[0];

	const choose = (v: string) => {
		val.set(v);
		open.value = false;
		triggerRef.current?.focus();
	};

	// APG listbox keyboard model: on open move focus to the selected (or first) option; Arrow/Home/End
	// rove focus between options (they are real buttons, so Enter/Space already select + Escape/outside
	// close via useDismiss). Reading `open.value` here re-runs the effect on the open→close flip.
	const optionEls = () =>
		Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(".ui-sort__option") ?? []);
	useEffect(() => {
		if (!open.value) return;
		const els = optionEls();
		if (els.length === 0) return;
		const sel = options.findIndex((o) => o.value === val.signal.value);
		els[sel >= 0 ? sel : 0]?.focus();
	}, [open.value]);

	const onMenuKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const els = optionEls();
		if (els.length === 0) return;
		const cur = els.indexOf(document.activeElement as HTMLButtonElement);
		let next = -1;
		if (e.key === "ArrowDown") next = cur < 0 ? 0 : Math.min(els.length - 1, cur + 1);
		else if (e.key === "ArrowUp") next = cur < 0 ? els.length - 1 : Math.max(0, cur - 1);
		else if (e.key === "Home") next = 0;
		else if (e.key === "End") next = els.length - 1;
		else return;
		e.preventDefault();
		els[next]?.focus();
	};

	return (
		<div class={cx("ui-sort", `ui-sort--size-${size}`, className)}>
			<button
				ref={triggerRef}
				type="button"
				class="ui-sort__trigger"
				aria-haspopup="listbox"
				aria-expanded={open.value}
				aria-label={ariaLabel ?? `${label} by ${active?.label ?? ""}`}
				onClick={() => (open.value = !open.value)}
			>
				<span class="ui-sort__label">{label}</span>
				<span class="ui-sort__value">
					{active?.icon
						? <span class="ui-sort__value-icon" aria-hidden="true">{active.icon}</span>
						: null}
					{active?.label}
				</span>
				<span
					class="ui-sort__chevron"
					data-open={open.value ? "true" : undefined}
					aria-hidden="true"
				>
					{ChevronGlyph}
				</span>
			</button>

			<button
				type="button"
				class="ui-sort__dir"
				aria-label={dir.signal.value === "asc"
					? "Ascending — switch to descending"
					: "Descending — switch to ascending"}
				aria-pressed={dir.signal.value === "desc"}
				onClick={() => dir.set(dir.signal.value === "asc" ? "desc" : "asc")}
			>
				<DirGlyph dir={dir.signal.value} />
			</button>

			{open.value
				? (
					<div
						ref={menuRef}
						class="ui-sort__menu ui-anchored"
						role="listbox"
						aria-label={`${label} property`}
						onKeyDown={onMenuKeyDown}
						style={styleVars({
							"--float-top": float ? `${float.top}px` : undefined,
							"--float-left": float ? `${float.left}px` : undefined,
							"--z-portal": String(stack.zIndex),
						})}
					>
						{options.map((opt) => {
							const selected = opt.value === val.signal.value;
							return (
								<button
									key={opt.value}
									type="button"
									class="ui-sort__option"
									role="option"
									aria-selected={selected}
									data-selected={selected ? "true" : undefined}
									onClick={() => choose(opt.value)}
								>
									{opt.icon
										? <span class="ui-sort__option-icon" aria-hidden="true">{opt.icon}</span>
										: null}
									<span class="ui-sort__option-label">{opt.label}</span>
									<span class="ui-sort__option-check" aria-hidden="true">
										{selected ? CheckGlyph : null}
									</span>
								</button>
							);
						})}
					</div>
				)
				: null}
		</div>
	);
}
