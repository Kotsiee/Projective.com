import type { SchedulerPricing } from "@ui/calendar/islands/availability-scheduler/types.ts";
import { DISPLAY_CURRENCIES } from "@projective/types/finance";
import { PAID_CALLS_LIVE, type ScheduleSettings } from "@projective/types/scheduling";

/**
 * The rule editor's price field (Decision #408), or `undefined` while paid calls are off
 * ({@link PAID_CALLS_LIVE}, Decision #343 ruling C1), which keeps the field off the page. A rule is
 * priced in the call settings' currency — the platform base until one is set — and a rule without a
 * price of its own inherits their fee.
 */
export function schedulerPricing(
	schedule: Pick<ScheduleSettings, "callFee"> | null,
	live: boolean = PAID_CALLS_LIVE,
): SchedulerPricing | undefined {
	if (!live) return undefined;
	const fee = schedule?.callFee ?? null;
	return { currency: fee?.currency ?? DISPLAY_CURRENCIES[0].code, inherited: fee };
}
