import type { SchedulePage } from "@projective/types/scheduling";

/**
 * A schedule page as a restricted (13–17) viewer receives it: nothing on it books — no slot opens the
 * booking flow and no call offer rides along (Decision #208: no commerce, no scheduling with others).
 *
 * Applied on BOTH ways a schedule page arrives — the SSR route (`/[handle]/availability`,
 * `/view/[entity]/schedule`, `/[handle]/view/[item]/schedule`) and the island's refetch through
 * `/api/scheduling/{availability,schedule}` — so a refresh never hands back what the first paint
 * withheld. The database refuses a minor's request on its own (`org.fn_assert_adult`); this keeps the
 * page from offering one.
 */
export function restrictBooking<T extends SchedulePage | null | undefined>(
	page: T,
	restricted: boolean,
): T {
	if (!page || !restricted) return page;
	const { callOffer: _withheld, ...rest } = page;
	return { ...rest, viewerCanBook: false } as T;
}
