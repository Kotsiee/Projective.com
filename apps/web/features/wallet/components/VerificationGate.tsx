import type { JSX } from "preact";
import { cx } from "@ui/core/cx.ts";
import { GateGlyph } from "../core/glyphs.tsx";
import type { WalletVerification } from "../types/wallet-types.ts";

/**
 * VerificationGate — the nudge that explains why a money path is locked.
 *
 * The distinction this component encodes is the one the whole surface turns on: a CAPABILITY the
 * viewer will never hold is removed, but a VERIFICATION step they can still complete is shown,
 * locked, with the way forward attached. Removing it hides the path; locking it teaches the path.
 *
 * It uses `GateGlyph` — the only lock permitted anywhere on this surface, because it marks a
 * process step the viewer can finish, never money they hold.
 */
export interface VerificationGateProps {
	verification: WalletVerification;
	/** `band` is the hero's full-width strip; `inline` is the compact deep-page variant. */
	tone?: "band" | "inline";
}

export function VerificationGate(props: VerificationGateProps): JSX.Element | null {
	const v = props.verification;
	if (!v.prompt) return null;

	return (
		<div
			class={cx("wlt-locked", props.tone === "inline" && "wlt-locked--inline")}
			role="status"
		>
			<span class="wlt-locked__glyph" aria-hidden="true">{GateGlyph}</span>
			<p class="wlt-locked__text">{v.prompt}</p>
			{v.href && (
				<a class="wlt-locked__link" href={v.href}>
					Finish verification
				</a>
			)}
		</div>
	);
}
