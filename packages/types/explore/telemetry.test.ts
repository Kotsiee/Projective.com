import { assert, assertEquals } from "@std/assert";
import { DiscoveryEventBatchSchema } from "./telemetry.ts";

const view = {
	name: "discovery.view",
	itemId: "logo-design",
	itemType: "services",
	at: 1,
} as const;
const impression = {
	name: "discovery.impression",
	itemId: "logo-design",
	itemType: "services",
	at: 1,
} as const;

Deno.test("a listing page's batch is its one view", () => {
	const parsed = DiscoveryEventBatchSchema.safeParse({
		sessionId: "session-0001",
		surface: "view.entity",
		events: [view],
	});
	assert(parsed.success);
	assertEquals(parsed.data.events[0].name, "discovery.view");
});

Deno.test("a view is refused from a discovery surface", () => {
	const parsed = DiscoveryEventBatchSchema.safeParse({
		sessionId: "session-0001",
		surface: "explore.results",
		events: [impression, view],
	});
	assert(!parsed.success);
	assertEquals(parsed.error.issues[0].path, ["events", 1, "name"]);
});

Deno.test("a listing page sends nothing but one view", () => {
	for (const events of [[impression], [view, view]]) {
		const parsed = DiscoveryEventBatchSchema.safeParse({
			sessionId: "session-0001",
			surface: "view.entity",
			events,
		});
		assert(!parsed.success, JSON.stringify(events));
	}
});

Deno.test("a view names a service or a product, nothing else", () => {
	const parsed = DiscoveryEventBatchSchema.safeParse({
		sessionId: "session-0001",
		surface: "view.entity",
		events: [{ ...view, itemType: "projects" }],
	});
	assert(!parsed.success);
});
