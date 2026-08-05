import type { JSX } from "preact";
import { useRef } from "preact/hooks";
import { FileCard } from "@web/features/projects/components/FileCard.tsx";
import "@web/features/projects/styles/file-card.css";
import "../styles/files-hub.css";
import { type AssetItem, sourceLabel, visibilityLabel } from "../types/file-types.ts";
import { SourceMark, VisibilityMark } from "./file-hub-glyphs.tsx";
import { LinkCard } from "./LinkCard.tsx";

/**
 * AssetCard — one grid cell in the `/files` hub.
 *
 * A **thin adapter**, never a fork: the cell itself is the shared {@link FileCard} rendered verbatim,
 * and this component adds only the three facts the hub introduces and a channel attachment never had —
 * the storage SOURCE the asset came from, its privacy SCOPE, and (for a stored web link) the origin's
 * favicon. Re-drawing the card to add them would have produced a second thumbnail geometry, and the
 * shared grid's `rowHeight` formula (`cellWidth + 62 + gap`) is written against the ONE meta height
 * that `.fx-card__meta` and `.subm-card__meta` both hold at exactly 62px. A forked card breaks folders
 * and files sharing a single grid.
 *
 * A `link` asset is delegated to {@link LinkCard} rather than squeezed into the file cell: a link has
 * no bytes, no extension and no thumbnail, so a file card would render three empty affordances and a
 * generic glyph where the origin's identity belongs.
 *
 * ## The interaction model, and why the wrapper owns it
 *
 * `FileCard` is a `<button>` whose one callback carries no event, so the modifier keys a file manager
 * needs (`Ctrl`/`Cmd` to toggle, `Shift` to extend) are not reachable through it. Rather than widen a
 * shared component's contract for one consumer, the wrapper records the modifiers in the CAPTURE phase
 * — which runs on an ancestor BEFORE the target's own handler — and the card's callback then reads
 * them. `e.detail === 0` identifies a KEYBOARD activation (no pointer click count), which is what lets
 * Enter/Space stay a plain select instead of inheriting whatever modifier was last held.
 *
 * Double click opens the universal preview; middle click opens the raw asset in a new tab. Both are
 * bound on the wrapper because a `<button>` reports neither through its click handler.
 *
 * Dumb: no data access, no state. Selection lives in `files-state`, owned by the hub body.
 */

/** What a pointer or key press asked for, resolved from the modifiers held at the moment of the click. */
export interface AssetActivation {
	/** `Ctrl`/`Cmd` — toggle this one asset in or out of the selection. */
	toggle: boolean;
	/** `Shift` — extend the selection from the anchor across the current visual order. */
	range: boolean;
}

export interface AssetCardProps {
	asset: AssetItem;
	/** Whether this asset is in the current selection — drives the selected treatment. */
	selected?: boolean;
	/** A single click (or Enter/Space), carrying the modifiers that were held. */
	onSelect: (asset: AssetItem, activation: AssetActivation) => void;
	/** A double click — open the universal preview. */
	onPreview: (asset: AssetItem) => void;
	/** A middle click — open the raw asset in a new tab. */
	onOpenRaw: (asset: AssetItem) => void;
}

const NO_MODIFIERS: AssetActivation = { toggle: false, range: false };

export function AssetCard(props: AssetCardProps): JSX.Element {
	const { asset, selected = false, onSelect, onPreview, onOpenRaw } = props;

	// Written in the capture phase, read by the card's own click handler a moment later. A ref rather
	// than a signal: this never needs to re-render anything, and a signal write here would repaint the
	// whole grid on every pointer press.
	const modifiers = useRef<AssetActivation>(NO_MODIFIERS);

	function captureModifiers(e: JSX.TargetedMouseEvent<HTMLDivElement>): void {
		// `detail === 0` is a keyboard-driven click; a stale modifier from an earlier pointer press must
		// not leak into it, so it resolves to a plain select.
		modifiers.current = e.detail === 0
			? NO_MODIFIERS
			: { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey };
	}

	function onAux(e: JSX.TargetedMouseEvent<HTMLDivElement>): void {
		if (e.button !== 1) return;
		// Middle-press otherwise starts the browser's autoscroll, which fights the workspace's own
		// Ctrl+wheel density gesture.
		e.preventDefault();
		onOpenRaw(asset);
	}

	const scope = visibilityLabel(asset.visibility);
	const source = sourceLabel(asset.source);

	return (
		<div
			class="fh-asset"
			data-selected={selected || undefined}
			data-source={asset.source}
			onClickCapture={captureModifiers}
			onDblClick={() => onPreview(asset)}
			onAuxClick={onAux}
		>
			{asset.source === "link" && asset.link
				? (
					<LinkCard
						asset={asset}
						link={asset.link}
						onOpen={() => onSelect(asset, modifiers.current)}
					/>
				)
				: <FileCard file={asset} onOpen={() => onSelect(asset, modifiers.current)} />}

			{
				/* The overlay marks are decorative: every fact they carry is already in the card button's
				   own `aria-label` prefix below, so a screen reader hears it once rather than twice. */
			}
			<span class="fh-asset__flags" aria-hidden="true">
				{asset.source !== "supabase"
					? (
						<span class="fh-asset__flag fh-asset__flag--source">
							<SourceMark source={asset.source} size={13} />
						</span>
					)
					: null}
				<span class="fh-asset__flag fh-asset__flag--scope" data-scope={asset.visibility}>
					<VisibilityMark visibility={asset.visibility} />
				</span>
			</span>

			{/* The two facts the marks encode, announced once, in text, to assistive technology. */}
			<span class="ui-visually-hidden">{`${source}. ${scope}.`}</span>
		</div>
	);
}
