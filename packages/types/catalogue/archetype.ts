import { z } from "zod";
import { ServiceType } from "../explore/items.ts";
import type { CatalogueKind } from "./catalogue.ts";

/**
 * catalogue.archetype — which edit FORM a listing gets.
 *
 * The delivery-model enum is never forked (Decision #217(a)): `marketplace.service_delivery_model`
 * keeps its five members, and the workspace maps them onto five form archetypes the same way the
 * `/view` page's `resolveArchetype()` maps them onto its bodies. Direct Deliverable shares the
 * One-Off form and adds a Team-roles block; Group Session is the cohort form.
 */

// #region Delivery model slug
/** The database spelling of a {@link ServiceType} (`marketplace.service_delivery_model`). */
export const DeliveryModel = z.enum([
	"pipeline",
	"one_off",
	"direct_deliverable",
	"session",
	"group_session",
]);
export type DeliveryModel = z.infer<typeof DeliveryModel>;

const DELIVERY_MODEL_OF: Record<ServiceType, DeliveryModel> = {
	"Pipeline": "pipeline",
	"One-Off": "one_off",
	"Direct Deliverable": "direct_deliverable",
	"Session": "session",
	"Group Session": "group_session",
};

const SERVICE_TYPE_OF: Record<DeliveryModel, ServiceType> = {
	pipeline: "Pipeline",
	one_off: "One-Off",
	direct_deliverable: "Direct Deliverable",
	session: "Session",
	group_session: "Group Session",
};

/** The URL- and database-safe slug for a delivery model. */
export function deliveryModelOf(serviceType: ServiceType): DeliveryModel {
	return DELIVERY_MODEL_OF[serviceType];
}

/** The {@link ServiceType} a delivery-model slug names. */
export function serviceTypeOf(model: DeliveryModel): ServiceType {
	return SERVICE_TYPE_OF[model];
}
// #endregion

// #region Form archetype
/** The five edit forms the item workspace renders (plan §4.3). */
export const FormArchetype = z.enum(["product", "pipeline", "one_off", "session", "cohort"]);
export type FormArchetype = z.infer<typeof FormArchetype>;

const FORM_OF_SERVICE: Record<ServiceType, FormArchetype> = {
	"Pipeline": "pipeline",
	"One-Off": "one_off",
	"Direct Deliverable": "one_off",
	"Session": "session",
	"Group Session": "cohort",
};

/**
 * The form a listing is edited with. Total: a service whose delivery model is not yet known edits as
 * a One-Off, matching `resolveArchetype()`'s fallback.
 */
export function formArchetypeOf(
	kind: CatalogueKind,
	serviceType: ServiceType | null,
): FormArchetype {
	if (kind === "product") return "product";
	return serviceType ? FORM_OF_SERVICE[serviceType] : "one_off";
}

/** Whether the listing's offer carries a team (Direct Deliverable, and every Pipeline stage). */
export function hasTeamRoles(serviceType: ServiceType | null): boolean {
	return serviceType === "Direct Deliverable" || serviceType === "Pipeline";
}
// #endregion

// #region Edit sections
/** The workspace Edit tab's sections, in page order (the `?section=` anchor). */
export const EditSection = z.enum([
	"media",
	"basics",
	"offer",
	"pricing",
	"availability",
	"questions",
	"seo",
]);
export type EditSection = z.infer<typeof EditSection>;

const PRODUCT_SECTIONS: readonly EditSection[] = ["media", "basics", "offer", "pricing", "seo"];
const DELIVERY_SECTIONS: readonly EditSection[] = [
	"media",
	"basics",
	"offer",
	"pricing",
	"questions",
	"seo",
];
const SESSION_SECTIONS: readonly EditSection[] = [
	"media",
	"basics",
	"offer",
	"pricing",
	"availability",
	"questions",
	"seo",
];

/**
 * The sections an archetype's Edit tab renders, per the plan §4.3 matrix. Buyer questions are a
 * service concern and availability a booked-time concern; Team roles live inside `offer`, so
 * `serviceType` never adds a section — {@link hasTeamRoles} decides that block.
 */
export function sectionsFor(
	archetype: FormArchetype,
	_serviceType: ServiceType | null,
): readonly EditSection[] {
	switch (archetype) {
		case "product":
			return PRODUCT_SECTIONS;
		case "session":
		case "cohort":
			return SESSION_SECTIONS;
		default:
			return DELIVERY_SECTIONS;
	}
}
// #endregion
