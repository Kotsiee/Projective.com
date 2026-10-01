import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import { useSignalEffect } from "@preact/signals";
import "../styles/middle-nav-panel.css";
import { styleVars } from "../../core/style.ts";
import { useSplitter, type UseSplitterOptions } from "../hooks/useSplitter.ts";

export interface MiddleNavPanelProps
	extends Pick<UseSplitterOptions, "min" | "max" | "initial" | "storageKey" | "step"> {
	/** The panel content — a context/inspector surface that owns its own sections. */
	children?: ComponentChildren;
	/**
	 * Whether the panel stands docked in the frame. Closed, it renders nothing visible and the frame
	 * gives its column back to the canvas (`middle-nav.css` keys the seam off `data-open`).
	 */
	open?: boolean;
	/** Accessible name of the resize handle. */
	handleLabel?: string;
	/**
	 * Drag-to-close: called when the handle is released more than {@link collapseDistance} past `min`
	 * (the panel dims while a release would close it). The owner sets its open state false, so the
	 * control that opens the panel reads as inactive again. Omit it and the drag simply clamps at `min`.
	 */
	onCollapse?: () => void;
	/** How far past `min` (px) a drag must travel before releasing closes the panel. Default 80. */
	collapseDistance?: number;
	/**
	 * Mirror the live width onto an ANCESTOR as this custom property (default `--shell-panel-w` on the
	 * closest `.ui-middle-nav`). The canvas's viewport-fixed surface sits beside the panel, outside its
	 * subtree, and can only stop at the panel's leading edge by reading the width from an ancestor —
	 * the same gap {@link MiddleNavSplitter}'s `publishWidthVar` closes for the lane.
	 */
	publishWidthVar?: string;
	/** Ancestor selector to publish {@link publishWidthVar} onto. */
	publishWidthSelector?: string;
}

/**
 * MiddleNavPanel — the drag-resizable right panel of the middle-nav frame (DESIGN_SYSTEM.md Part D.2,
 * §D.4). The lane's mirror: it spans the frame's full height beside the header, canvas and footer
 * bands, carries its handle on its LEADING edge (so the drag inverts), clamps to `min`/`max`, and
 * persists its width when given a `storageKey`. Given `onCollapse`, dragging well past `min` and
 * releasing closes it rather than resizing it. Its body is its own scroll container, independent of
 * the window scroll the canvas flows in.
 *
 * Interactive — hydrate it in the app via a `features/<group>/islands/` wrapper.
 */
export function MiddleNavPanel(props: MiddleNavPanelProps): JSX.Element {
	const {
		children,
		open = true,
		handleLabel = "Resize panel",
		publishWidthVar = "--shell-panel-w",
		publishWidthSelector = ".ui-middle-nav",
		min = 280,
		max = 560,
		initial = 320,
		onCollapse,
		collapseDistance = 80,
		...opts
	} = props;
	const {
		width,
		dragging,
		collapsePending,
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onPointerCancel,
		onKeyDown,
	} = useSplitter({
		...opts,
		min,
		max,
		initial,
		edge: "start",
		// The panel has no icon rail — it is open at a readable width or closed outright.
		collapseBelow: 0,
		compactMax: 0,
		releaseCollapseAt: min - collapseDistance,
		onReleaseCollapse: onCollapse,
	});
	const rootRef = useRef<HTMLDivElement>(null);

	useSignalEffect(() => {
		const px = `${width.value}px`;
		if (!publishWidthVar || typeof document === "undefined") return;
		const target = rootRef.current?.closest(publishWidthSelector) as HTMLElement | null;
		target?.style.setProperty(publishWidthVar, px);
	});

	return (
		<div
			ref={rootRef}
			class="ui-midnav-panel"
			data-open={open ? "true" : "false"}
			data-dragging={dragging.value ? "true" : undefined}
			data-collapse-pending={collapsePending.value ? "true" : undefined}
			style={styleVars({ "--shell-panel-w": `${width.value}px` })}
		>
			<div
				class="ui-midnav-panel__handle"
				role="separator"
				aria-orientation="vertical"
				aria-label={handleLabel}
				aria-valuenow={width.value}
				aria-valuemin={min}
				aria-valuemax={max}
				tabIndex={0}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerCancel}
				onKeyDown={onKeyDown}
			/>
			<div class="ui-midnav-panel__body">{children}</div>
		</div>
	);
}
