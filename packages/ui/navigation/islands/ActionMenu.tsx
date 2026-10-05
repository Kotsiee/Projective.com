import type { ComponentChildren, JSX, VNode } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import "../styles/action-menu.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { useId } from "../../hooks/useId.ts";
import { useFloating } from "../../hooks/useFloating.ts";
import type { BoundarySource, FloatingState } from "../../hooks/useFloating.ts";
import { useDismiss } from "../../hooks/useDismiss.ts";
import { pushEscapeLayer } from "../../hooks/escape-stack.ts";
import { registerOverlay } from "../../hooks/overlay-registry.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { BodyPortal } from "../../overlay/components/BodyPortal.tsx";
import type { PopoverTriggerApi } from "../../feedback/islands/Popover.tsx";
import type { Bindable } from "../../fields/types/mod.ts";
import type { MenuItem, Placement } from "../../types/mod.ts";
import { activate, edgeFocusable } from "../core/menu.ts";
import {
	appendTypeahead,
	closeFrom,
	escapeStep,
	type HoverDecision,
	isEmptyRow,
	isReadable,
	isSubmenu,
	type MenuPath,
	openSubmenu,
	type Point,
	resolveHover,
	resolveLevels,
	resolveMenuKey,
	submenuRows,
	type TypeaheadState,
	typeaheadTarget,
} from "../core/menu-tree.ts";
import {
	type ActionMenuRowHandlers,
	actionMenuRowId,
	ActionMenuRows,
} from "../components/ActionMenuRows.tsx";

// #region Props
/** Props for {@link ActionMenu}. */
export interface ActionMenuProps {
	/** Rows; any row with `items` cascades into a flyout submenu, to any depth. */
	model: MenuItem[];
	/** Render-prop for the trigger — the same contract as `Popover`. Attach `api.ref` to a native element. */
	trigger: (api: PopoverTriggerApi) => VNode;
	/** Accessible name of the root `role="menu"`. */
	"aria-label": string;
	/** Root panel placement; flips on overflow (default `bottom-end`). */
	placement?: Placement;
	/** Layout zones the root panel must stay clear of (forwarded to `useFloating`). */
	avoid?: readonly BoundarySource[];
	/** Controlled/uncontrolled open state. */
	open?: Bindable<boolean>;
	/** Fired whenever the open state changes. */
	onOpenChange?: (open: boolean) => void;
	/** Extra class(es) merged onto every panel (root and flyouts). */
	class?: string;
}
// #endregion

interface HoverState {
	trail: Point[];
	timer: ReturnType<typeof setTimeout> | undefined;
	pending: { depth: number; signature: string } | null;
	row: { depth: number; index: number } | null;
}

interface FlyoutProps {
	id: string;
	anchorId: string;
	rtl: boolean;
	zIndex: number;
	rootId: string;
	class?: string;
	onPointerMove: (e: JSX.TargetedPointerEvent<HTMLDivElement>) => void;
	onPointerDown: (e: JSX.TargetedPointerEvent<HTMLDivElement>) => void;
	onPointerEnter: (e: JSX.TargetedPointerEvent<HTMLDivElement>) => void;
	children: ComponentChildren;
}

function floatVars(floating: FloatingState | null, zIndex: number) {
	return styleVars({
		"--float-top": floating ? `${floating.top}px` : undefined,
		"--float-left": floating ? `${floating.left}px` : undefined,
		"--float-available-h": floating?.availableHeight != null
			? `${floating.availableHeight}px`
			: undefined,
		"--z-portal": String(zIndex),
	});
}

function ActionMenuFlyout(props: FlyoutProps): JSX.Element {
	const panelRef = useRef<HTMLDivElement>(null);
	const anchorRef = useRef<HTMLElement>(null);
	anchorRef.current = typeof document === "undefined"
		? null
		: document.getElementById(props.anchorId);

	const floating = useFloating({
		open: true,
		triggerRef: anchorRef,
		panelRef,
		placement: props.rtl ? "left-start" : "right-start",
		offset: 2,
	});

	useEffect(() => {
		if (typeof document === "undefined") return;
		return registerOverlay(props.id, {
			panel: () => panelRef.current,
			trigger: () => document.getElementById(props.anchorId),
		});
	}, [props.id, props.anchorId]);

	return (
		<BodyPortal>
			<div
				ref={panelRef}
				id={props.id}
				role="menu"
				aria-labelledby={props.anchorId}
				data-action-menu={props.rootId}
				class={cx("ui-action-menu", "ui-action-menu--sub", props.class)}
				style={floatVars(floating, props.zIndex)}
				onPointerMove={props.onPointerMove}
				onPointerDown={props.onPointerDown}
				onPointerEnter={props.onPointerEnter}
			>
				{props.children}
			</div>
		</BodyPortal>
	);
}

/**
 * ActionMenu — the kebab/action menu primitive: a trigger render-prop opening a portalled
 * `role="menu"` whose parent rows cascade into flyout submenus to any depth.
 *
 * Every panel (root and each flyout) renders through `BodyPortal`, so a menu opened inside a card, a
 * scroll container or the sticky lane is never clipped. Flyouts sit `right-start` (`left-start` in
 * RTL), flip when there is no room and clamp into the viewport. Each flyout registers as owned by its
 * parent row, so presses inside any flyout are inside the menu and an outside press closes the tree.
 *
 * Keyboard: Up/Down/Home/End rove (disabled rows included, so their reason is readable), typeahead
 * jumps, Right/Enter/Space open a submenu onto its first row, Left closes one level, Escape closes
 * one level and at the root returns focus to the trigger, Tab closes everything. Escape is taken
 * through the shared escape stack, so only the top overlay ever sees it. Mouse hover opens submenus
 * with aim tolerance; touch taps toggle them. A terminal row runs its `command`, closes the tree and
 * returns focus to the trigger.
 *
 * @example
 * ```tsx
 * <ActionMenu
 *   aria-label={`Actions for ${name}`}
 *   model={[
 *     { label: "Invite to stage", icon: "user-plus", emptyLabel: "No open stages",
 *       items: stages.map((s) => ({ label: s.name, command: () => invite(s.id) })) },
 *     { separator: true },
 *     { label: "Remove", icon: "trash", danger: true, command: remove },
 *   ]}
 *   trigger={(api) => (
 *     <button ref={api.ref as RefObject<HTMLButtonElement>} aria-haspopup="menu"
 *       aria-expanded={api.expanded} aria-controls={api.panelId} onClick={api.toggle}>…</button>
 *   )}
 * />
 * ```
 */
export function ActionMenu(props: ActionMenuProps): JSX.Element {
	const {
		model,
		trigger,
		placement = "bottom-end",
		avoid,
		open,
		onOpenChange,
		class: className,
	} = props;
	const ariaLabel = props["aria-label"];

	const ctrl = useControllable<boolean>(open, false, onOpenChange);
	const isOpen = ctrl.signal.value;
	const path = useSignal<MenuPath>([]);
	const rootId = useId(undefined, "action-menu");
	const triggerRef = useRef<HTMLElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const hover = useRef<HoverState>({ trail: [], timer: undefined, pending: null, row: null });
	const typeahead = useRef<TypeaheadState>({ buffer: "", at: 0 });
	const pointerType = useRef<string>("mouse");

	const tree = resolveLevels(model, path.value);
	const levelId = (depth: number, p: MenuPath = tree.path): string =>
		depth === 0 ? `${rootId}-menu` : `${rootId}-sub-${p.slice(0, depth).join("-")}`;
	const rowEl = (depth: number, index: number): HTMLElement | null =>
		typeof document === "undefined"
			? null
			: document.getElementById(actionMenuRowId(levelId(depth, path.peek()), index));
	const rtl = isOpen && typeof getComputedStyle === "function" && triggerRef.current
		? getComputedStyle(triggerRef.current).direction === "rtl"
		: false;

	const stack = useOverlayStack({ active: isOpen, layer: "popover" });
	const floating = useFloating({ open: isOpen, triggerRef, panelRef, placement, avoid });

	// #region Open / close
	const clearHover = () => {
		const h = hover.current;
		if (h.timer !== undefined) clearTimeout(h.timer);
		h.timer = undefined;
		h.pending = null;
	};

	const closeAll = (restoreFocus: boolean) => {
		clearHover();
		hover.current.row = null;
		if (path.peek().length > 0) path.value = [];
		if (ctrl.get()) ctrl.set(false);
		if (restoreFocus) triggerRef.current?.focus();
	};

	const setPath = (next: MenuPath) => {
		path.value = next;
	};

	const withinTree = (node: Element | null): boolean =>
		!!node?.closest?.(`[data-action-menu="${rootId}"]`);

	const focusLater = (depth: number, index: number) => {
		if (index < 0) return;
		setTimeout(() => {
			const active = document.activeElement;
			const free = !active || active === document.body || active === triggerRef.current ||
				withinTree(active);
			if (free) rowEl(depth, index)?.focus();
		}, 0);
	};

	const onEscape = () => {
		const step = escapeStep(tree.path);
		if (step.type === "close-all") {
			closeAll(true);
			return;
		}
		clearHover();
		setPath(step.path);
		rowEl(step.focus.depth, step.focus.index)?.focus();
	};

	useDismiss({
		open: isOpen,
		enabled: stack.isTop,
		onDismiss: () => closeAll(false),
		panelRef,
		triggerRef,
		closeOnEscape: false,
	});

	const live = useRef({ isTop: stack.isTop, onEscape });
	live.current = { isTop: stack.isTop, onEscape };

	useEffect(() => {
		if (!isOpen) return;
		return pushEscapeLayer({
			enabled: () => live.current.isTop,
			closeOnEscape: () => true,
			dismiss: () => live.current.onEscape(),
		});
	}, [isOpen]);

	useEffect(() => {
		if (!isOpen) {
			clearHover();
			hover.current.row = null;
			if (path.peek().length > 0) path.value = [];
			return;
		}
		typeahead.current = { buffer: "", at: 0 };
		focusLater(0, edgeFocusable(resolveLevels(model, []).levels[0], "first", isReadable));
	}, [isOpen]);

	useEffect(() => () => clearHover(), []);
	// #endregion

	// #region Activation
	const openChild = (depth: number, index: number, focusChild: boolean) => {
		const item = tree.levels[depth]?.[index];
		if (!item) return;
		clearHover();
		setPath(openSubmenu(tree.path, depth, index));
		if (focusChild) focusLater(depth + 1, edgeFocusable(submenuRows(item), "first", isReadable));
	};

	const runCommand = (item: MenuItem, event: Event) => {
		closeAll(true);
		activate(item, event);
	};
	// #endregion

	// #region Keyboard
	const handlersFor = (depth: number): ActionMenuRowHandlers => ({
		onKeyDown: (e, index) => {
			if (e.key === "Escape") return;
			const items = tree.levels[depth] ?? [];
			const action = resolveMenuKey({
				key: e.key,
				items,
				index,
				depth,
				rtl,
				modifier: e.ctrlKey || e.metaKey || e.altKey,
			});
			if (action.type === "none") return;
			if (action.type === "tab") {
				closeAll(true);
				return;
			}
			e.preventDefault();
			switch (action.type) {
				case "focus":
					if (tree.path.length > depth) setPath(closeFrom(tree.path, depth));
					rowEl(depth, action.index)?.focus();
					break;
				case "open":
					openChild(depth, action.index, true);
					break;
				case "activate": {
					const item = items[action.index];
					if (item.url) rowEl(depth, action.index)?.click();
					else runCommand(item, e);
					break;
				}
				case "close-level": {
					const parent = tree.path[depth - 1];
					setPath(closeFrom(tree.path, depth - 1));
					rowEl(depth - 1, parent)?.focus();
					break;
				}
				case "close-all":
					closeAll(true);
					break;
				case "typeahead": {
					typeahead.current = appendTypeahead(typeahead.current, action.char, Date.now());
					const target = typeaheadTarget(items, index, typeahead.current.buffer);
					if (target < 0) break;
					if (tree.path.length > depth) setPath(closeFrom(tree.path, depth));
					rowEl(depth, target)?.focus();
					break;
				}
			}
		},
		onKeyUp: (e) => {
			if (e.key === " ") e.preventDefault();
		},
		onClick: (e, index) => {
			const item = tree.levels[depth]?.[index];
			if (!item) return;
			if (item.disabled || isEmptyRow(item)) {
				e.preventDefault();
				return;
			}
			if (isSubmenu(item)) {
				e.preventDefault();
				const touch = pointerType.current !== "mouse";
				if (touch && tree.path[depth] === index) {
					clearHover();
					setPath(closeFrom(tree.path, depth));
				} else {
					openChild(depth, index, false);
				}
				return;
			}
			if (item.url) {
				closeAll(true);
				return;
			}
			runCommand(item, e);
		},
	});
	// #endregion

	// #region Hover intent
	const flyoutBox = (depth: number) => {
		if (tree.path.length <= depth) return null;
		return document.getElementById(levelId(depth + 1))?.getBoundingClientRect() ?? null;
	};

	const commit = (decision: HoverDecision, depth: number) => {
		if (decision.type === "open") setPath(openSubmenu(tree.path, depth, decision.index));
		else if (decision.type === "close") setPath(closeFrom(tree.path, depth));
	};

	const settle = () => {
		const h = hover.current;
		h.timer = undefined;
		h.pending = null;
		const row = h.row;
		if (!row) return;
		const current = resolveLevels(model, path.peek());
		const item = current.levels[row.depth]?.[row.index];
		if (!item) return;
		const last = h.trail[h.trail.length - 1];
		const decision = resolveHover({
			index: row.index,
			item,
			openIndex: current.path[row.depth] ?? -1,
			submenu: null,
			trail: last ? [last] : [],
		});
		const next = decision.type === "open"
			? openSubmenu(current.path, row.depth, decision.index)
			: decision.type === "close"
			? closeFrom(current.path, row.depth)
			: null;
		if (next) path.value = next;
		const active = document.activeElement;
		if (!active || active === document.body || withinTree(active)) {
			document.getElementById(actionMenuRowId(levelId(row.depth, current.path), row.index))
				?.focus({ preventScroll: true });
		}
	};

	const hoverRow = (depth: number, index: number) => {
		const item = tree.levels[depth]?.[index];
		if (!item) return;
		const h = hover.current;
		const sameRow = h.row?.depth === depth && h.row?.index === index;
		h.row = { depth, index };
		const decision = resolveHover({
			index,
			item,
			openIndex: tree.path[depth] ?? -1,
			submenu: flyoutBox(depth),
			trail: h.trail,
		});
		if (decision.type !== "defer" && !sameRow) rowEl(depth, index)?.focus({ preventScroll: true });
		if (decision.type === "idle") {
			clearHover();
			return;
		}
		const signature = decision.type === "open" ? `open:${decision.index}` : decision.type;
		if (
			decision.type !== "defer" && h.pending?.depth === depth && h.pending.signature === signature
		) {
			return;
		}
		clearHover();
		h.pending = { depth, signature };
		h.timer = setTimeout(() => {
			if (decision.type === "defer") {
				settle();
				return;
			}
			h.timer = undefined;
			h.pending = null;
			commit(decision, depth);
		}, decision.delay);
	};

	const panelHandlers = (depth: number) => ({
		onPointerMove: (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
			pointerType.current = e.pointerType;
			if (e.pointerType !== "mouse") return;
			const trail = hover.current.trail;
			trail.push({ x: e.clientX, y: e.clientY });
			if (trail.length > 4) trail.shift();
			const row = e.target instanceof Element
				? e.target.closest<HTMLElement>("[data-index]")
				: null;
			if (!row || !e.currentTarget.contains(row)) return;
			hoverRow(depth, Number(row.dataset.index));
		},
		onPointerDown: (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
			pointerType.current = e.pointerType;
		},
		onPointerEnter: (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
			const pending = hover.current.pending;
			if (e.pointerType === "mouse" && pending && pending.depth < depth) clearHover();
		},
	});
	// #endregion

	const api: PopoverTriggerApi = {
		ref: triggerRef,
		toggle: () => (ctrl.get() ? closeAll(false) : ctrl.set(true)),
		open: () => ctrl.set(true),
		close: () => closeAll(false),
		expanded: isOpen,
		panelId: levelId(0),
	};

	const rowsFor = (depth: number) => {
		const openIndex = tree.path[depth] ?? -1;
		return (
			<ActionMenuRows
				items={tree.levels[depth]}
				levelId={levelId(depth)}
				openIndex={openIndex}
				flyoutId={openIndex >= 0 ? levelId(depth + 1) : null}
				handlers={handlersFor(depth)}
			/>
		);
	};

	return (
		<>
			{trigger(api)}
			{isOpen && (
				<BodyPortal>
					<div
						ref={panelRef}
						id={levelId(0)}
						role="menu"
						aria-label={ariaLabel}
						data-action-menu={rootId}
						class={cx("ui-action-menu", className)}
						style={floatVars(floating, stack.zIndex)}
						{...panelHandlers(0)}
					>
						{rowsFor(0)}
					</div>
				</BodyPortal>
			)}
			{isOpen && tree.path.map((index, d) => {
				const depth = d + 1;
				const id = levelId(depth);
				return (
					<ActionMenuFlyout
						key={id}
						id={id}
						anchorId={actionMenuRowId(levelId(d), index)}
						rtl={rtl}
						zIndex={stack.zIndex + depth}
						rootId={rootId}
						class={className}
						{...panelHandlers(depth)}
					>
						{rowsFor(depth)}
					</ActionMenuFlyout>
				);
			})}
		</>
	);
}
