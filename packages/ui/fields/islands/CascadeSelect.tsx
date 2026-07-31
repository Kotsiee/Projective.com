import type { JSX } from "preact";
import { useMemo, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import "../styles/cascadeselect.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useControllable } from "../hooks/useControllable.ts";
import { useId } from "../hooks/useId.ts";
import { useFloating } from "../hooks/useFloating.ts";
import { useDismiss } from "../hooks/useDismiss.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { BodyPortal } from "../../overlay/components/BodyPortal.tsx";
import { ariaInvalid, fieldModifiers } from "../core/field.ts";
import type { BaseFieldProps, Bindable, ValueChange } from "../types/mod.ts";

// #region Types
/** A node in the {@link CascadeSelect} hierarchy — a branch has `children`, a leaf carries a `value`. */
export interface CascadeOption {
	/** Visible label. */
	label: string;
	/** Selection value (leaves). Falls back to `label` when omitted. */
	value?: string;
	/** Nested options — presence marks this a branch (flyout). */
	children?: CascadeOption[];
}

export interface CascadeSelectProps extends BaseFieldProps {
	/** The nested option groups. */
	options?: CascadeOption[];
	/** Selected leaf value — raw `string` or `Signal<string>`. */
	value?: Bindable<string>;
	/** Fired whenever the selection changes. */
	onValueChange?: ValueChange<string>;
	/** Trigger placeholder when nothing is selected. */
	placeholder?: string;
	class?: string;
}

interface ActivePos {
	col: number;
	idx: number;
}
// #endregion

/**
 * CascadeSelect — nested group selection rendered as cascading flyout columns (PrimeNG parity). The
 * trigger opens a panel; hovering or entering a branch reveals the next column, and selecting a leaf
 * commits its value and closes. Branch items expose `aria-haspopup`/`aria-expanded`; keyboard
 * traversal is ArrowUp/Down within a column, ArrowRight to enter a submenu, ArrowLeft to exit, and
 * Enter/Space to open a branch or select a leaf.
 *
 * The PANEL is projected into `document.body` via {@link BodyPortal} and claims a live stacking index
 * from {@link useOverlayStack}, so it escapes any ancestor that would clip it (`overflow: hidden`) or
 * re-base its `position: fixed` (`transform`/`filter`/`backdrop-filter`) — the trap a Dialog panel
 * sets. The trigger stays in place and the id-based ARIA wiring survives the move.
 */
export function CascadeSelect(props: CascadeSelectProps): JSX.Element {
	const {
		options = [],
		value,
		onValueChange,
		placeholder,
		id,
		name,
		disabled,
		readOnly,
		required,
		status = "default",
		size = "md",
		fluid,
		class: className,
		...aria
	} = props;

	const ctrl = useControllable<string>(value, "", onValueChange);
	const rootId = useId(id, "cascadeselect");
	const panelId = `${rootId}-panel`;

	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	const open = useMemo(() => signal(false), []);
	const path = useMemo(() => signal<CascadeOption[]>([]), []);
	const active = useMemo(() => signal<ActivePos>({ col: 0, idx: 0 }), []);

	const labelByValue = useMemo(() => {
		const map: Record<string, string> = {};
		const walk = (nodes: CascadeOption[]) => {
			for (const node of nodes) {
				if (!node.children?.length) map[node.value ?? node.label] = node.label;
				else walk(node.children);
			}
		};
		walk(options);
		return map;
	}, [options]);

	const stack = useOverlayStack({ active: open.value, layer: "popover" });
	const float = useFloating({
		open: open.value,
		triggerRef,
		panelRef,
		placement: "bottom-start",
		matchWidth: false,
	});
	useDismiss({ open: open.value, onDismiss: () => close(), panelRef, triggerRef });

	// #region Column model
	const columns: CascadeOption[][] = [options];
	for (const branch of path.value) {
		if (branch.children?.length) columns.push(branch.children);
	}
	const isBranch = (opt: CascadeOption): boolean => !!opt.children?.length;
	const valueOf = (opt: CascadeOption): string => opt.value ?? opt.label;
	// #endregion

	// #region Open / close
	const openPanel = () => {
		if (disabled || readOnly) return;
		path.value = [];
		active.value = { col: 0, idx: 0 };
		open.value = true;
		queueMicrotask(() => panelRef.current?.focus());
	};
	const close = () => {
		open.value = false;
		path.value = [];
	};
	const toggleOpen = () => (open.value ? close() : openPanel());
	// #endregion

	// #region Navigation helpers
	const truncateTo = (col: number) => {
		path.value = path.peek().slice(0, col);
	};
	const enterBranch = (col: number, branch: CascadeOption) => {
		path.value = [...path.peek().slice(0, col), branch];
		active.value = { col: col + 1, idx: 0 };
	};
	const commitLeaf = (opt: CascadeOption) => {
		ctrl.set(valueOf(opt));
		close();
		triggerRef.current?.focus();
	};
	const activateItem = (col: number, opt: CascadeOption) => {
		if (isBranch(opt)) enterBranch(col, opt);
		else commitLeaf(opt);
	};
	// #endregion

	// #region Keyboard
	const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
		const { col, idx } = active.value;
		const column = columns[col] ?? [];
		const item = column[idx];
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				truncateTo(col);
				active.value = { col, idx: Math.min(idx + 1, column.length - 1) };
				break;
			case "ArrowUp":
				e.preventDefault();
				truncateTo(col);
				active.value = { col, idx: Math.max(idx - 1, 0) };
				break;
			case "Home":
				e.preventDefault();
				truncateTo(col);
				active.value = { col, idx: 0 };
				break;
			case "End":
				e.preventDefault();
				truncateTo(col);
				active.value = { col, idx: column.length - 1 };
				break;
			case "ArrowRight":
				if (item && isBranch(item)) {
					e.preventDefault();
					enterBranch(col, item);
				}
				break;
			case "ArrowLeft":
				if (col > 0) {
					e.preventDefault();
					const parentBranch = path.peek()[col - 1];
					const parentCol = columns[col - 1] ?? [];
					const parentIdx = Math.max(0, parentCol.indexOf(parentBranch));
					truncateTo(col - 1);
					active.value = { col: col - 1, idx: parentIdx };
				}
				break;
			case "Enter":
			case " ":
				if (item) {
					e.preventDefault();
					activateItem(col, item);
				}
				break;
			case "Escape":
				e.preventDefault();
				close();
				triggerRef.current?.focus();
				break;
			case "Tab":
				close();
				break;
		}
	};
	// #endregion

	const selectedLabel = labelByValue[ctrl.signal.value] ?? "";
	const activePos = active.value;
	const activeDescId = `${panelId}-c${activePos.col}-i${activePos.idx}`;

	return (
		<div class={cx("ui-cascadeselect", fluid && "ui-cascadeselect--fluid", className)}>
			<button
				ref={triggerRef}
				type="button"
				id={rootId}
				name={name}
				class={cx(
					"ui-field",
					"ui-cascadeselect__trigger",
					...fieldModifiers("ui-field", {
						size,
						status,
						fluid,
						disabled,
						readOnly,
						open: open.value,
					}),
				)}
				disabled={disabled}
				aria-haspopup="tree"
				aria-expanded={open.value}
				aria-controls={panelId}
				aria-invalid={ariaInvalid(status)}
				aria-required={required || undefined}
				onClick={toggleOpen}
				{...aria}
			>
				<span
					class={cx(
						"ui-cascadeselect__value",
						!selectedLabel && "ui-cascadeselect__value--placeholder",
					)}
				>
					{selectedLabel || placeholder || " "}
				</span>
				<span class="ui-cascadeselect__arrow" aria-hidden="true" />
			</button>

			{open.value && (
				<BodyPortal>
					<div
						ref={panelRef}
						id={panelId}
						role="tree"
						tabIndex={0}
						aria-activedescendant={activeDescId}
						class="ui-cascadeselect__panel"
						data-placement={float?.placement}
						style={styleVars({
							"--cs-top": float ? `${float.top}px` : undefined,
							"--cs-left": float ? `${float.left}px` : undefined,
							"--z-portal": String(stack.zIndex),
						})}
						onKeyDown={onKeyDown}
					>
						{columns.map((column, col) => (
							<div key={col} role="group" class="ui-cascadeselect__column">
								{column.map((opt, idx) => {
									const branch = isBranch(opt);
									const isActive = activePos.col === col && activePos.idx === idx;
									const expanded = branch && path.value[col] === opt;
									return (
										<div
											key={valueOf(opt)}
											id={`${panelId}-c${col}-i${idx}`}
											role="treeitem"
											aria-level={col + 1}
											aria-haspopup={branch || undefined}
											aria-expanded={branch ? expanded : undefined}
											aria-selected={!branch && ctrl.signal.value === valueOf(opt)}
											class={cx(
												"ui-cascadeselect__item",
												branch && "ui-cascadeselect__item--branch",
												isActive && "ui-cascadeselect__item--active",
												expanded && "ui-cascadeselect__item--expanded",
											)}
											onPointerEnter={() => {
												active.value = { col, idx };
												if (branch) enterBranch(col, opt);
												else truncateTo(col);
											}}
											onClick={() => {
												active.value = { col, idx };
												activateItem(col, opt);
											}}
										>
											<span class="ui-cascadeselect__item-label">{opt.label}</span>
											{branch && <span class="ui-cascadeselect__item-caret" aria-hidden="true" />}
										</div>
									);
								})}
							</div>
						))}
					</div>
				</BodyPortal>
			)}
		</div>
	);
}
