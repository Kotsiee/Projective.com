import { define } from "@web/utils/state.ts";
import { readActor } from "@web/utils/api-session.ts";
import { apiSellerActor } from "@features/catalogue/core/seller-scope.ts";
import { SlotQuerySchema } from "@projective/types/scheduling";
import { BookingBackendService } from "@server/services/booking/BookingBackendService.ts";
import { invalidPayload, toBookingResponse } from "@features/view/core/respond.ts";
import { warmCatalog } from "@server/services/explore/live-catalog.ts";

/**
 * `GET /api/catalogue/simulate/slots?subjectId=&purpose=&timezone=&from=&days=&callType=` — the slot
 * grid the owner's buyer simulation (`/catalogue/[id]/simulate`, Decision #217 (j)) draws in its Book
 * modal. Same query and same answer shape as `GET /api/services/slots`, but the listing is read as its
 * signed-in OWNER (a draft included; anyone else's listing is a 404), because the public read cannot
 * see a listing that is not yet published. A read — it holds nothing.
 *
 * Thin: coerce the query into {@link SlotQuerySchema}, then delegate to the fat
 * {@link BookingBackendService.simulatedSlots}.
 */
export const handler = define.handlers({
	async GET(ctx) {
		await warmCatalog();
		const p = ctx.url.searchParams;
		const parsed = SlotQuerySchema.safeParse({
			subjectId: p.get("subjectId") ?? "",
			purpose: p.get("purpose") ?? "session",
			timezone: p.get("timezone") ?? undefined,
			from: p.get("from") ? Number(p.get("from")) : undefined,
			days: p.get("days") ? Number(p.get("days")) : undefined,
			callType: p.get("callType") ?? undefined,
		});
		if (!parsed.success) return invalidPayload(parsed.error);

		const actor = await apiSellerActor(ctx.url, readActor(ctx));
		if (actor instanceof Response) return actor;
		return toBookingResponse(await BookingBackendService.simulatedSlots(parsed.data, actor));
	},
});
