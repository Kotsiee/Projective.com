import { signal } from "@preact/signals";
import type { CatalogueKind, ServiceType } from "../types/catalogue-types.ts";

/**
 * catalogue-state — the cross-island signals that let the lane's `＋ New` split-button AND the console's
 * empty-state CTA open the SAME create modal (mounted once in the lane), seeding its kind + delivery
 * model. The documented footer↔body / lane↔modal coordination pattern (module-level signals).
 */

/** Whether the Create-Listing modal is open. */
export const createModalOpen = signal<boolean>(false);
/** The kind the modal opens seeded to (Product / Service). */
export const createSeedKind = signal<CatalogueKind>("service");
/** The delivery model the modal opens seeded to (services only). */
export const createSeedModel = signal<ServiceType>("One-Off");

/** Open the Create-Listing modal, optionally seeding the kind + delivery model. */
export function openCreate(kind?: CatalogueKind, model?: ServiceType): void {
	if (kind) createSeedKind.value = kind;
	if (model) createSeedModel.value = model;
	createModalOpen.value = true;
}

/** The analytics window the KPI strip reports over — driven by the lane footer's period selector. */
export type AnalyticsPeriod = "7d" | "30d" | "90d";
export const analyticsPeriod = signal<AnalyticsPeriod>("30d");
