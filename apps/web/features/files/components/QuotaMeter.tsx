import type { JSX } from "preact";
import "../styles/files-hub.css";
import { formatMib, quotaState, type StorageQuota } from "../types/file-types.ts";

/**
 * QuotaMeter — the owner's storage allowance, as a figure and a band.
 *
 * Every number it prints is SERVER-computed (`usedMib` · `remainingMib` · `pct`, and the band via the
 * SSOT's `quotaState`). Nothing here subtracts, divides or totals, for the same reason `/wallet` never
 * lets the client do money arithmetic: two figures derived on opposite sides of the wire eventually
 * disagree, and the one a person acts on is whichever they happened to read.
 *
 * ## Three deliberate positions
 *
 * **Unlimited is `limitMib === null`, and it renders no track at all.** Not a full bar, not a bar at
 * 0%: a share of an unbounded whole is not a meaningful quantity, and drawing one invents a ceiling
 * the plan does not have.
 *
 * **A fact and a consequence are different sentences.** Enforcement ships fail-open behind
 * `security.platform_params.storage_quota_enforced`, so while `enforced` is false the cap METERS and
 * warns but refuses nothing. "You are over your allowance" is true either way; "the next upload will
 * be refused" is only true once a human flips the parameter, and asserting it early trains people to
 * ignore the meter.
 *
 * **The bar is not the message.** The band is carried by the printed percentage, the used/limit
 * figures and a state word as well as by tone, so it survives a colour-blindness overlay — and the
 * fill width is never transitioned, because motion may decorate `transform`/`opacity` but must never
 * animate a property that ENCODES data (a frozen animation clock left `/wallet`'s meter at zero width
 * for a funded wallet, Decision #60).
 *
 * Dumb: no data access. Rendered by the hub body and, when the lane wants it, by the lane.
 */
export interface QuotaMeterProps {
	/** The resolved allowance, or `null` for a scope that consumes none (a mount, a share). */
	quota: StorageQuota | null;
	/** Compact presentation for a collapsed rail — the track plus the figure, no caption. */
	compact?: boolean;
	class?: string;
}

/** The one-word state, printed beside the figures so the band is never carried by tone alone. */
function bandWord(state: ReturnType<typeof quotaState>): string {
	switch (state) {
		case "empty":
			return "Empty";
		case "healthy":
			return "Plenty of room";
		case "warning":
			return "Filling up";
		case "critical":
			return "Nearly full";
		case "exceeded":
			return "Over your allowance";
	}
}

export function QuotaMeter(
	{ quota, compact = false, class: className }: QuotaMeterProps,
): JSX.Element | null {
	if (!quota) return null;

	const state = quotaState(quota);
	const unlimited = quota.limitMib === null;
	const used = formatMib(quota.usedMib);

	if (unlimited) {
		return (
			<div class={`fh-quota fh-quota--unlimited${className ? ` ${className}` : ""}`}>
				<p class="fh-quota__figure">
					<span class="fh-quota__used">{used}</span>
					<span class="fh-quota__of">stored</span>
				</p>
				{compact ? null : (
					<p class="fh-quota__caption">
						{quota.tierLabel} · no storage limit
					</p>
				)}
			</div>
		);
	}

	const limit = formatMib(quota.limitMib ?? 0);
	const remaining = quota.remainingMib === null ? null : formatMib(Math.max(0, quota.remainingMib));
	const pct = Math.round(quota.pct);

	return (
		<div
			class={`fh-quota${className ? ` ${className}` : ""}`}
			data-band={state}
			data-enforced={quota.enforced || undefined}
		>
			<p class="fh-quota__figure">
				<span class="fh-quota__used">{used}</span>
				<span class="fh-quota__of">{`of ${limit}`}</span>
				<span class="fh-quota__pct">{`${pct}%`}</span>
			</p>

			{
				/* The track is decorative — every fact it encodes is printed above and below it — so it is
				   hidden from assistive technology rather than announced as a second, vaguer copy. */
			}
			<div class="fh-quota__track" aria-hidden="true" style={`--fh-quota-pct:${pct}`}>
				<span class="fh-quota__fill" />
			</div>

			{compact ? null : (
				<p class="fh-quota__caption">
					<span class="fh-quota__band">{bandWord(state)}</span>
					{remaining !== null && state !== "exceeded"
						? <span class="fh-quota__left">{`${remaining} left`}</span>
						: null}
					<span class="fh-quota__tier">{quota.tierLabel}</span>
				</p>
			)}

			{state === "exceeded" && !compact
				? (
					<p class="fh-quota__note" role="status">
						{quota.enforced
							? "New uploads will be refused until you free up space or upgrade."
							: "Uploads still work for now — this is a heads-up, not a block."}
					</p>
				)
				: null}
		</div>
	);
}
