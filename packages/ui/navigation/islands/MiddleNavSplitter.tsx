import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";
import { useSignalEffect } from "@preact/signals";
import "../styles/splitter.css";
import { styleVars } from "../../core/style.ts";
import { useSplitter, type UseSplitterOptions } from "../hooks/useSplitter.ts";

export interface MiddleNavSplitterProps extends UseSplitterOptions {
	/** The lane content (comms lists, filters, channels). */
	children?: ComponentChildren;
	/**
	 * Opt-in: mirror the live lane width onto an ANCESTOR element as a CSS custom property, so layout
	 * OUTSIDE the splitter subtree can track it live. The width var is set inline on `.ui-splitter`
	 * (this element) and therefore only inherits DOWN — a sibling/ancestor frame (e.g. the shell's
	 * nested-frame seam, which sits inline-start-adjacent to the lane) cannot otherwise read the dragged
	 * value. Publishing it to the closest {@link publishWidthSelector} ancestor closes that gap. Off by
	 * default — the package stays portable and DOM-side-effect-free unless a consumer asks for it.
	 */
	publishWidthVar?: string;
	/** Ancestor selector to publish {@link publishWidthVar} onto (default the closest `.ui-app-shell`). */
	publishWidthSelector?: string;
}

/**
 * MiddleNavSplitter — drag-resizable wrapper for the Blue lane (DESIGN_SYSTEM.md Part D.2). Sets the
 * lane width via `--shell-lane-w` and exposes a density `data-mode` (collapsed → compact → full) so
 * the lane can reflow between icon-only, icon-matrix, and master-detail layouts.
 *
 * Interactive — hydrate it in the app via a `features/<group>/islands/` wrapper.
 */
export function MiddleNavSplitter(props: MiddleNavSplitterProps): JSX.Element {
	const { children, publishWidthVar, publishWidthSelector = ".ui-app-shell", ...opts } = props;
	// Persistence is opt-in: the consuming app passes a `storageKey` (its registered storage-keys
	// dictionary value) so the package stays portable and never hardcodes an app key literal.
	const { width, mode, dragging, onPointerDown, onPointerMove, onPointerUp } = useSplitter(opts);
	const rootRef = useRef<HTMLDivElement>(null);

	// Opt-in width hoist: republish the live width onto the closest matching ancestor whenever it
	// changes, so a frame outside this subtree can position against the lane edge (client-only — effects
	// don't run during SSR, so the first paint falls back to the inherited `--shell-lane-w` default).
	useSignalEffect(() => {
		const px = `${width.value}px`;
		if (!publishWidthVar || typeof document === "undefined") return;
		const target = rootRef.current?.closest(publishWidthSelector) as HTMLElement | null;
		target?.style.setProperty(publishWidthVar, px);
	});

	return (
		<div
			ref={rootRef}
			class="ui-splitter"
			data-mode={mode.value}
			data-dragging={dragging.value ? "true" : undefined}
			style={styleVars({ "--shell-lane-w": `${width.value}px` })}
		>
			<div class="ui-splitter__body">{children}</div>
			<div
				class="ui-splitter__handle"
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize navigation lane"
				tabIndex={0}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
			/>
		</div>
	);
}
