import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import "../styles/wallet.css";
import { ZoomSlider } from "@projective/ui/fields";
import { WalletIcon } from "../components/wallet-glyphs.tsx";
import {
	restoreZoom,
	setZoom,
	viewMode,
	zoom,
	ZOOM_CENTER,
	ZOOM_MAX,
	ZOOM_MIN,
	ZOOM_SEGMENTS,
	ZOOM_STEP,
} from "../core/view-state.ts";

/**
 * WalletViewControlRig — the middle-nav FOOTER band on `/wallet/transactions`: a leading (non-interactive)
 * mode glyph + the {@link ZoomSlider} driving the shared ledger zoom signal (compact list ⇄ comfortable ⇄
 * card grid; crossing the centre marker transitions the view — no toggle button). Dumb; the ledger body
 * reads the same `zoom` signal (cross-island coordination). Mirrors the Catalogue/Files rig.
 */
export default function WalletViewControlRig(): JSX.Element {
	useEffect(() => restoreZoom(), []);
	return (
		<div class="wallet-rig">
			<span class="wallet-rig__mode" data-mode={viewMode.value} aria-hidden="true">
				<WalletIcon name={viewMode.value === "grid" ? "overview" : "ledger"} size={16} />
			</span>
			<ZoomSlider
				value={zoom}
				onValueChange={setZoom}
				min={ZOOM_MIN}
				max={ZOOM_MAX}
				step={ZOOM_STEP}
				segments={ZOOM_SEGMENTS}
				center={ZOOM_CENTER}
				size="sm"
				aria-label="Ledger view zoom"
			/>
		</div>
	);
}
