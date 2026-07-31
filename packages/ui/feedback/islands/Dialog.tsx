import type { ComponentChildren, JSX, RefObject, VNode } from "preact";
import { useRef, useState } from "preact/hooks";
import "../styles/dialog.css";
import { cx } from "../../core/cx.ts";
import { styleVars } from "../../core/style.ts";
import { Portal } from "../../overlay/components/Portal.tsx";
import { Backdrop } from "../../overlay/islands/Backdrop.tsx";
import { usePresence } from "../../overlay/core/usePresence.ts";
import { useControllable } from "../../hooks/useControllable.ts";
import { useOverlayStack } from "../../hooks/useOverlayStack.ts";
import { useFocusTrap } from "../../hooks/useFocusTrap.ts";
import { useDismiss } from "../../hooks/useDismiss.ts";
import { useIsMobile } from "../../hooks/useMediaQuery.ts";
import { useId } from "../../hooks/useId.ts";
import type { OverlayPosition } from "../../types/mod.ts";
import type { Bindable } from "../../fields/types/mod.ts";
import { Icon } from "../../icons/mod.ts";

// #region Props
/** Render context handed to the header/footer template render-props. */
export interface DialogTemplateContext {
	/** Imperatively close the dialog. */
	close: () => void;
	/** Whether the dialog is currently maximized. */
	maximized: boolean;
}

/** Props for {@link Dialog}. */
export interface DialogProps {
	/** Visibility — raw boolean (uncontrolled) or `Signal<boolean>` (controlled). */
	visible: Bindable<boolean>;
	/** Header content — plain title string or a full node. */
	header?: string | VNode;
	/** Footer content (typically actions). */
	footer?: VNode;
	/** Render-prop overriding the header region entirely. */
	headerTemplate?: (ctx: DialogTemplateContext) => VNode;
	/** Render-prop overriding the footer region entirely. */
	footerTemplate?: (ctx: DialogTemplateContext) => VNode;
	/** Nine-point position within the viewport (default `center`). */
	position?: OverlayPosition;
	/** Render a backdrop + trap focus + block interaction beneath (default `true`). */
	modal?: boolean;
	/**
	 * ARIA role (default `"dialog"`). Destructive confirmations pass `"alertdialog"` so assistive tech
	 * announces the prompt with the urgency its consequence warrants.
	 */
	role?: "dialog" | "alertdialog";
	/** Clicking the backdrop closes the dialog (default `true` when modal). */
	dismissableMask?: boolean;
	/** Show the header close (×) button (default `true`). */
	closable?: boolean;
	/** Allow dragging the dialog by its header. */
	draggable?: boolean;
	/** Allow resizing via the bottom-end grip. */
	resizable?: boolean;
	/** Show a maximize/restore toggle in the header. */
	maximizable?: boolean;
	/** Lock body scroll while open (default `true`). */
	blockScroll?: boolean;
	/** Close on Escape when top-most (default `true`). */
	closeOnEscape?: boolean;
	/** Fixed inline size (CSS length, e.g. `"32rem"`). */
	width?: string;
	/** Fixed block size (CSS length). */
	height?: string;
	/**
	 * Element (or scope) that takes focus on open, instead of the first tabbable — which is otherwise
	 * the header's × button, since the header precedes the body in DOM order.
	 */
	initialFocusRef?: RefObject<HTMLElement>;
	/** Fired whenever visibility changes. */
	onVisibleChange?: (visible: boolean) => void;
	/** Extra class(es) merged onto the panel. */
	class?: string;
	/** Dialog body. */
	children?: ComponentChildren;
}
// #endregion

/**
 * Dialog — a modal (or non-modal) surface centred or pinned to one of nine positions, built on the
 * shared overlay pattern: {@link Portal} layer, {@link Backdrop}, managed z-index + scroll-lock
 * ({@link useOverlayStack}), focus trap ({@link useFocusTrap}), and Escape/outside dismissal
 * ({@link useDismiss}, top-most only). Supports draggable/resizable/maximizable chrome and optional
 * header/footer templates. `role="dialog"`, `aria-modal`, and `aria-labelledby` wire the header as the
 * accessible name. Below `--bp-md` a positioned dialog docks as a bottom sheet. Enter/exit transitions
 * use token durations and collapse under reduced motion.
 */
export function Dialog(props: DialogProps): JSX.Element | null {
	const {
		visible,
		header,
		footer,
		headerTemplate,
		footerTemplate,
		position = "center",
		modal = true,
		role = "dialog",
		dismissableMask = true,
		closable = true,
		draggable = false,
		resizable = false,
		maximizable = false,
		blockScroll = true,
		closeOnEscape = true,
		width,
		height,
		initialFocusRef,
		onVisibleChange,
		class: className,
		children,
	} = props;

	const ctrl = useControllable<boolean>(visible, false, onVisibleChange);
	const isOpen = ctrl.signal.value;
	const { mounted, state } = usePresence(isOpen);

	const panelRef = useRef<HTMLDivElement>(null);
	const rootId = useId(undefined, "dialog");
	const titleId = `${rootId}-title`;
	const bodyId = `${rootId}-body`;

	const isMobile = useIsMobile();
	const asSheet = isMobile && position !== "center";

	const stack = useOverlayStack({
		active: mounted,
		lockScroll: blockScroll && modal,
		layer: "modal",
	});
	const close = () => ctrl.set(false);

	useFocusTrap({
		active: mounted && modal,
		containerRef: panelRef,
		initialFocusRef,
		inertBackground: modal,
	});
	useDismiss({
		open: mounted,
		enabled: stack.isTop,
		onDismiss: close,
		panelRef,
		closeOnEscape,
		closeOnOutside: false,
	});

	// #region Maximize / drag / resize
	const [maximized, setMaximized] = useState(false);
	const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
	const [size, setSize] = useState<{ w: number; h: number } | null>(null);
	const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
	const grip = useRef<{ px: number; py: number; w: number; h: number } | null>(null);

	const canDrag = draggable && !maximized && !asSheet;
	const canResize = resizable && !maximized && !asSheet;

	const onHeaderPointerDown = (e: JSX.TargetedPointerEvent<HTMLElement>) => {
		if (!canDrag || (e.target as HTMLElement).closest(".ui-dialog__action")) return;
		const base = offset ?? { x: 0, y: 0 };
		drag.current = { px: e.clientX, py: e.clientY, ox: base.x, oy: base.y };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	};
	const onHeaderPointerMove = (e: JSX.TargetedPointerEvent<HTMLElement>) => {
		if (!drag.current) return;
		setOffset({
			x: drag.current.ox + (e.clientX - drag.current.px),
			y: drag.current.oy + (e.clientY - drag.current.py),
		});
	};
	const endDrag = () => (drag.current = null);

	const onGripPointerDown = (e: JSX.TargetedPointerEvent<HTMLElement>) => {
		if (!canResize) return;
		e.stopPropagation();
		const rect = panelRef.current?.getBoundingClientRect();
		grip.current = { px: e.clientX, py: e.clientY, w: rect?.width ?? 0, h: rect?.height ?? 0 };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	};
	const onGripPointerMove = (e: JSX.TargetedPointerEvent<HTMLElement>) => {
		if (!grip.current) return;
		setSize({
			w: Math.max(160, grip.current.w + (e.clientX - grip.current.px)),
			h: Math.max(120, grip.current.h + (e.clientY - grip.current.py)),
		});
	};
	const endGrip = () => (grip.current = null);

	const toggleMaximize = () => {
		setMaximized((m) => !m);
		setOffset(null);
		setSize(null);
	};
	// #endregion

	if (!mounted) return null;

	const ctx: DialogTemplateContext = { close, maximized };
	const hasHeader = header !== undefined || headerTemplate || closable || maximizable;

	const sizeVars = styleVars({
		"--dlg-w": maximized ? undefined : (size ? `${size.w}px` : width),
		"--dlg-h": maximized ? undefined : (size ? `${size.h}px` : height),
		"--dlg-x": offset ? `${offset.x}px` : undefined,
		"--dlg-y": offset ? `${offset.y}px` : undefined,
	});

	return (
		<Portal zIndex={stack.zIndex}>
			{modal && (
				<Backdrop visible={state === "open"} onClick={dismissableMask ? close : undefined} />
			)}
			<div
				class={cx(
					"ui-dialog",
					`ui-dialog--pos-${position}`,
					asSheet && "ui-dialog--sheet",
					maximized && "ui-dialog--maximized",
					!modal && "ui-dialog--modeless",
				)}
			>
				<div
					ref={panelRef}
					role={role}
					aria-modal={modal || undefined}
					aria-labelledby={hasHeader && (header !== undefined || headerTemplate)
						? titleId
						: undefined}
					aria-describedby={bodyId}
					data-state={state}
					class={cx("ui-dialog__panel", (offset || size) && "ui-dialog__panel--free", className)}
					style={sizeVars}
					tabIndex={-1}
				>
					{headerTemplate
						? (
							// Carries `titleId` so `aria-labelledby` resolves to the region's own text. A
							// template renders no `<h2 id={titleId}>`, so pointing at one would dangle and
							// leave the dialog with no accessible name at all.
							<div
								id={titleId}
								class="ui-dialog__header"
								onPointerDown={onHeaderPointerDown}
								onPointerMove={onHeaderPointerMove}
								onPointerUp={endDrag}
							>
								{headerTemplate(ctx)}
							</div>
						)
						: hasHeader && (
							<div
								class={cx("ui-dialog__header", canDrag && "ui-dialog__header--draggable")}
								onPointerDown={onHeaderPointerDown}
								onPointerMove={onHeaderPointerMove}
								onPointerUp={endDrag}
							>
								{header !== undefined && <h2 id={titleId} class="ui-dialog__title">{header}</h2>}
								<div class="ui-dialog__actions">
									{maximizable && (
										<button
											type="button"
											class="ui-dialog__action"
											aria-label={maximized ? "Restore" : "Maximize"}
											aria-pressed={maximized}
											onClick={toggleMaximize}
										>
											<Icon name={maximized ? "collapse" : "expand"} />
										</button>
									)}
									{closable && (
										<button
											type="button"
											class="ui-dialog__action ui-dialog__close"
											aria-label="Close"
											onClick={close}
										>
											<Icon name="close" />
										</button>
									)}
								</div>
							</div>
						)}

					<div id={bodyId} class="ui-dialog__body">{children}</div>

					{footerTemplate
						? <div class="ui-dialog__footer">{footerTemplate(ctx)}</div>
						: footer !== undefined && <div class="ui-dialog__footer">{footer}</div>}

					{canResize && (
						<span
							class="ui-dialog__grip"
							aria-hidden="true"
							onPointerDown={onGripPointerDown}
							onPointerMove={onGripPointerMove}
							onPointerUp={endGrip}
						/>
					)}
				</div>
			</div>
		</Portal>
	);
}
