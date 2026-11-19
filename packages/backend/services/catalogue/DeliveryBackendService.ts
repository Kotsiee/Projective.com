import type { PurchaseList } from "@projective/types/catalogue";
import type { ServiceResult } from "../ServiceResult.ts";
import type { ReadActor } from "../read-actor.ts";
import type { StreamedAsset } from "../media/stream.ts";
import { type DeliveryRequest, listPurchases, streamDelivery } from "./delivery.ts";

/**
 * DeliveryBackendService — what a buyer receives for a product they paid for (Decision #488;
 * ASSET_DELIVERY_ARCHITECTURE.md §11).
 *
 * The fat half of two surfaces: `GET|HEAD /api/downloads/[entitlement]/[fileId]`, which streams one
 * file of a purchase through the app after an entitlement gate read under the caller's own JWT, and
 * the purchases view (`/files?source=purchases`). The publish-side copy into `originals` is reached
 * from the catalogue write path (`materialisePublished`), not from here.
 */
export class DeliveryBackendService {
	/**
	 * Stream one file of a purchase to its holder. Every refusal is a bodiless 404; 429 past the
	 * per-identity window; 503 (with `details.retryAfterSeconds`) while the version's copy lands or when
	 * storage is unreachable. A body streamed to its last byte is recorded as a delivery (ruling A8).
	 */
	static async stream(
		actor: ReadActor,
		entitlementSlug: string,
		fileId: string,
		request: DeliveryRequest,
	): Promise<ServiceResult<StreamedAsset>> {
		return await streamDelivery(actor, entitlementSlug, fileId, request);
	}

	/** Every purchase the acting account holds, newest first. */
	static async purchases(actor: ReadActor): Promise<ServiceResult<PurchaseList>> {
		return await listPurchases(actor);
	}
}
