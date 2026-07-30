import type { JSX } from "preact";
import { Avatar } from "@projective/ui/display";
import { Tooltip } from "@projective/ui/feedback";
import type { SplitStake } from "@projective/types/workspace";
import { PolicyAmount, STALE_NOTE } from "./PolicyAmount.tsx";
import { ClockGlyph, HoldGlyph, ReleaseGlyph } from "./policy-glyphs.tsx";

/**
 * SplitLegend — the record behind the split bar.
 *
 * The bar is the overview; this is the evidence. Every stake states its facts in **five independent
 * channels** — a tone swatch, the person, the printed share, the server-computed money that share
 * becomes, and the held mark — so nothing about the split depends on being able to compare widths. That
 * redundancy is what lets the rail itself contribute nothing to the accessibility tree: a screen-reader
 * user reads this list, a reader with a colour-vision deficiency reads the same list, and neither is
 * getting a reduced version of the truth.
 *
 * ### The money is never recomputed here
 * `projected` is the server's own figure for that stake. When the reader moves a share locally, that
 * figure is still priced against the share the server last stored — and the client may not re-derive it,
 * because splitting money on the client is exactly what the money rule forbids (root CLAUDE.md §12). So a
 * changed row keeps the server's figure, mutes it, marks it with a clock, and says why in a `Tooltip`,
 * rather than presenting a number that has quietly stopped being true. Saving re-prices every stake
 * server-side and the marks clear.
 *
 * ### Six grid cells, exactly
 * `.wsp-split__key` defines six tracks (swatch · avatar · name · share · amount · hold). A seventh child
 * would wrap onto a second row and break every row's alignment, which is why the stale mark lives INSIDE
 * the amount cell rather than beside it.
 */

// #region Props
export interface SplitLegendProps {
	/** The live stakes, in the same order the bar renders them, so tone slots line up. */
	stakes: readonly SplitStake[];
	/** What the whole release is worth, for the per-row consequence sentence. */
	releaseLabel?: string;
	/** Toggle a stake's hold. A held share stays in the vault instead of distributing automatically. */
	onToggleHold?: (memberId: string, held: boolean) => void;
	/** Published as the reader moves across rows, so the matching segment lifts in sympathy. */
	onHighlight?: (memberId: string | null) => void;
	/** Member ids whose share changed since the last save. */
	changedIds?: readonly string[];
	/** Read-only: a viewer without `manage_finances`, or a policy locked pending verification. */
	readOnly?: boolean;
}
// #endregion

// #region Helpers
/** The tone slot for a stake — must match {@link SplitBar}'s cycle, or swatch and segment disagree. */
function toneOf(index: number): number {
	return (index % 6) + 1;
}

/** One decimal place of percent from basis points. */
function pct(bp: number): string {
	return `${Math.round(bp / 10) / 10}%`;
}
// #endregion

// #region Component
/** The per-stake legend: swatch · person · share · projected money · hold. */
export function SplitLegend(props: SplitLegendProps): JSX.Element {
	const { stakes, readOnly = false } = props;
	const changed = new Set(props.changedIds ?? []);

	return (
		<ul class="wsp-split__legend" role="list">
			{stakes.map((stake, index) => {
				const stale = changed.has(stake.memberId);
				const share = pct(stake.shareBp);
				// The consequence, spelled out: a percentage is arithmetic, this is what actually happens.
				const consequence = stale
					? `${stake.name} takes ${share} of the next release. ${STALE_NOTE}`
					: `${stake.name} receives ${stake.projected.display} of the next release${
						props.releaseLabel ? ` of ${props.releaseLabel}` : ""
					}.`;
				const holdState = stake.held
					? "Held back from automatic distribution"
					: "Distributes automatically";

				return (
					<li
						class="wsp-split__key"
						key={stake.memberId}
						data-stake={toneOf(index)}
						data-held={stake.held ? "true" : "false"}
						onMouseEnter={() => props.onHighlight?.(stake.memberId)}
						onMouseLeave={() => props.onHighlight?.(null)}
						onFocusIn={() => props.onHighlight?.(stake.memberId)}
						onFocusOut={() => props.onHighlight?.(null)}
					>
						<span class="wsp-split__key-mark" aria-hidden="true" />
						<Avatar
							class="wsp-split__key-avatar"
							image={stake.avatar || undefined}
							label={stake.name}
							size="sm"
							shape="circle"
						/>
						<span class="wsp-split__key-name wsp-trunc">
							<a href={`/@${stake.handle}`}>{stake.name}</a>
						</span>
						<span class="wsp-split__key-share wsp-num">{share}</span>
						<span class="wsp-split__key-amount">
							<PolicyAmount
								value={stake.projected}
								size="key"
								stale={stale}
								srLabel={consequence}
							/>
							{stale && (
								<Tooltip content={STALE_NOTE} placement="top">
									<span class="wsp-split__key-stale" aria-hidden="true">{ClockGlyph}</span>
								</Tooltip>
							)}
						</span>
						{readOnly
							? (
								<Tooltip content={holdState} placement="top">
									<span class="wsp-split__key-hold" role="img" aria-label={holdState}>
										{stake.held ? HoldGlyph : ReleaseGlyph}
									</span>
								</Tooltip>
							)
							: (
								<Tooltip
									content={stake.held
										? `Release ${stake.name}'s share so it distributes automatically`
										: `Hold ${stake.name}'s share back — it stays in the vault instead of distributing, and is never reassigned to anybody else`}
									placement="top"
								>
									<button
										type="button"
										class="wsp-split__key-hold"
										aria-pressed={stake.held ? "true" : "false"}
										aria-label={stake.held
											? `Release ${stake.name}'s share`
											: `Hold ${stake.name}'s share`}
										onClick={() => props.onToggleHold?.(stake.memberId, !stake.held)}
									>
										{stake.held ? HoldGlyph : ReleaseGlyph}
									</button>
								</Tooltip>
							)}
					</li>
				);
			})}
		</ul>
	);
}
// #endregion
