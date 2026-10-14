import { assert, assertEquals } from "@std/assert";
import {
	EditSection,
	formArchetypeOf,
	type ListingDetail,
	ListingDetailSchema,
	type ListingOffer,
	sectionsFor,
	ServiceType,
	UpdateListingInputSchema,
} from "@projective/types/catalogue";
import { buildPatch, diffFields, SECTION_FIELDS } from "./workspace-model.ts";
import {
	deliveryLabel,
	newMilestone,
	newTeamRole,
	offerEditorFor,
	sanitiseOffer,
	switchSessionFormat,
} from "./offer-model.ts";
import { withAskedPrice, withRevisionsDeclared } from "./pricing-model.ts";

const T0 = "2026-10-14T09:00:00.000Z";

const OFFERS: Readonly<Record<ListingOffer["archetype"], ListingOffer>> = {
	product: {
		archetype: "product",
		format: "template",
		licence: "commercial",
		attributionRequired: true,
		attachments: [{ name: "Kit", label: "ZIP archive", extension: ".zip", bytes: 2048 }],
	},
	one_off: {
		archetype: "one_off",
		milestones: [newMilestone(1, "Milestone")],
		turnaroundDays: 7,
		scope: ["Two logo concepts", ""],
		teamRoles: [newTeamRole(1)],
	},
	pipeline: {
		archetype: "pipeline",
		stages: [
			{ ...newMilestone(1, "Stage"), priceCents: 40_000, deliverables: ["Brief", ""] },
			{ ...newMilestone(2, "Stage"), startTrigger: "fixed_offset", lagDays: 3 },
		],
		teamRoles: [],
	},
	session: { archetype: "session", minutes: 45, count: 2, meetingProvider: "zoom" },
	cohort: {
		archetype: "cohort",
		minutes: 90,
		count: 1,
		meetingProvider: null,
		maxSeatsPerCohort: 20,
		continuousEnrollment: true,
	},
};

const SERVICE_OF: Readonly<Record<ListingOffer["archetype"], ServiceType | null>> = {
	product: null,
	one_off: "One-Off",
	pipeline: "Pipeline",
	session: "Session",
	cohort: "Group Session",
};

function listingFor(archetype: ListingOffer["archetype"], offer: ListingOffer): ListingDetail {
	return ListingDetailSchema.parse({
		id: archetype === "product" ? "prd-23456789ab" : "svc-23456789ab",
		ownerId: "maris",
		kind: archetype === "product" ? "product" : "service",
		serviceType: SERVICE_OF[archetype],
		title: "Listing",
		category: "",
		status: "draft",
		currency: "GBP",
		cover: null,
		price: { mode: "quote", display: "Set a price" },
		metrics: {
			views: 0,
			orders: 0,
			revenue: 0,
			revenueLabel: "£0",
			avgRating: 0,
			ratingCount: 0,
			trend: [],
		},
		updatedAt: T0,
		updatedLabel: "Edited today",
		promoted: false,
		needsAttention: false,
		owner: { handle: "maris", name: "Maris Okafor", avatar: "", kind: "freelancer" },
		description: "",
		descriptionText: "",
		media: [],
		skills: [],
		tags: [],
		pricing: {
			amount: 0,
			ticketPrice: null,
			sessionPrice: null,
			seatsPerSession: null,
			freeRevisions: null,
			extraRevisionPrice: null,
		},
		delivery: "",
		createCategory: null,
		offer,
		seo: { seoTitle: "", seoDescription: "" },
		availabilityBinding: null,
		collections: [],
	});
}

function blank(archetype: ListingOffer["archetype"]): ListingOffer {
	switch (archetype) {
		case "product":
			return {
				archetype,
				format: "download",
				licence: "personal",
				attributionRequired: false,
				attachments: [],
			};
		case "one_off":
			return { archetype, milestones: [], turnaroundDays: null, scope: [], teamRoles: [] };
		case "pipeline":
			return { archetype, stages: [], teamRoles: [] };
		case "session":
			return { archetype, minutes: 60, count: 1, meetingProvider: null };
		case "cohort":
			return switchSessionFormat({
				archetype: "session",
				minutes: 60,
				count: 1,
				meetingProvider: null,
			}, "cohort");
	}
}

Deno.test("every archetype renders its matrix sections and its own offer form", () => {
	const rows: [ServiceType | null, string[], boolean][] = [
		[null, ["media", "basics", "offer", "pricing", "seo"], false],
		["One-Off", ["media", "basics", "offer", "pricing", "questions", "seo"], false],
		["Direct Deliverable", ["media", "basics", "offer", "pricing", "questions", "seo"], true],
		["Pipeline", ["media", "basics", "offer", "pricing", "questions", "seo"], false],
		["Session", ["media", "basics", "offer", "pricing", "availability", "questions", "seo"], false],
		[
			"Group Session",
			["media", "basics", "offer", "pricing", "availability", "questions", "seo"],
			false,
		],
	];
	for (const [serviceType, sections, withTeam] of rows) {
		const kind = serviceType ? "service" : "product";
		const archetype = formArchetypeOf(kind, serviceType);
		assertEquals([...sectionsFor(archetype, serviceType)], sections, String(serviceType));
		for (const section of sections) assert(EditSection.safeParse(section).success);
		assertEquals(offerEditorFor(kind, serviceType, OFFERS[archetype]), { archetype, withTeam });
	}
});

Deno.test("a stale offer shape waits for the delivery-model save instead of showing the old form", () => {
	assertEquals(offerEditorFor("service", "Session", OFFERS.one_off), null);
	assertEquals(offerEditorFor("service", "Group Session", OFFERS.session), null);
});

Deno.test("each offer editor's edit becomes one valid offer section patch", () => {
	for (const archetype of Object.keys(OFFERS) as ListingOffer["archetype"][]) {
		const saved = listingFor(archetype, blank(archetype));
		const offer = sanitiseOffer(OFFERS[archetype]);
		const label = deliveryLabel(offer);
		const draft: ListingDetail = { ...saved, offer, delivery: label ?? saved.delivery };
		const fields = diffFields(saved, draft);
		const patch = buildPatch(draft, fields, saved.updatedAt);
		const parsed = UpdateListingInputSchema.safeParse(patch);
		assert(parsed.success, `${archetype}: ${JSON.stringify(parsed.error?.issues)}`);
		assertEquals(patch.offer, offer, archetype);
		assertEquals(
			Object.keys(patch).sort(),
			["delivery", "expectedUpdatedAt", "id", "offer"],
			archetype,
		);
		assertEquals(patch.delivery, label ?? "", archetype);
		for (const key of SECTION_FIELDS.offer) assert(key in patch, `${archetype} sends ${key}`);
	}
});

Deno.test("the price and revision fields patch the pricing section alone", () => {
	const saved = listingFor("one_off", blank("one_off"));
	const priced = withRevisionsDeclared(withAskedPrice(saved.pricing, "amount", 1200), true);
	const draft: ListingDetail = { ...saved, pricing: priced };
	const patch = buildPatch(draft, diffFields(saved, draft), saved.updatedAt);
	assert(UpdateListingInputSchema.safeParse(patch).success);
	assertEquals(Object.keys(patch).sort(), ["expectedUpdatedAt", "id", "pricing"]);
	assertEquals([patch.pricing?.amount, patch.pricing?.freeRevisions], [1200, 2]);
});
