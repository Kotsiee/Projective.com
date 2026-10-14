import { assertEquals } from "@std/assert";
import { formArchetypeOf } from "@projective/types/catalogue";
import {
	type EntityView,
	type ServiceType,
	ServiceType as ServiceTypeEnum,
	type ServiceViewExtra,
} from "@projective/types/explore";
import { resolveArchetype } from "@features/view/core/entity-archetype.ts";

/**
 * The catalogue edits a listing with the form `formArchetypeOf` picks, and `/view` sells it with the
 * body `resolveArchetype` picks. If the two disagree, the seller edits one shape and the buyer is
 * offered another, so every delivery model is pinned through both paths `resolveArchetype` takes.
 */

const VIEW_MODEL: Record<ServiceType, ServiceViewExtra["model"]> = {
	"Pipeline": "pipeline",
	"One-Off": "one-off",
	"Direct Deliverable": "direct",
	"Session": "session",
	"Group Session": "group-session",
};

function rawView(serviceType: ServiceType): EntityView {
	return { item: { type: "services", serviceType } } as EntityView;
}

function composedView(serviceType: ServiceType): EntityView {
	return {
		item: { type: "services", serviceType },
		service: { model: VIEW_MODEL[serviceType] },
	} as EntityView;
}

Deno.test("formArchetypeOf agrees with resolveArchetype for every ServiceType", () => {
	for (const type of ServiceTypeEnum.options) {
		const form = formArchetypeOf("service", type);
		assertEquals(resolveArchetype(rawView(type)), form, `${type} (raw)`);
		assertEquals(resolveArchetype(composedView(type)), form, `${type} (composed)`);
	}
});

Deno.test("formArchetypeOf agrees with resolveArchetype for a product", () => {
	const view = { item: { type: "products" } } as EntityView;
	assertEquals(resolveArchetype(view), formArchetypeOf("product", null));
});
