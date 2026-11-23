import { assertEquals } from "@std/assert";
import { subPageRedirect } from "./sub-page-route.ts";

const service = (serviceType: "Session" | "Group Session" | "One-Off" | "Pipeline") => ({
	id: "svc-23456789ab",
	kind: "service" as const,
	serviceType,
});
const product = { id: "prd-23456789ab", kind: "product" as const, serviceType: null };

Deno.test("the session plan serves a Session and a Group Session, and sends the rest to Offer", () => {
	assertEquals(subPageRedirect(service("Session"), "plan"), null);
	assertEquals(subPageRedirect(service("Group Session"), "plan"), null);
	assertEquals(
		subPageRedirect(service("One-Off"), "plan"),
		"/catalogue/svc-23456789ab?section=offer",
	);
	assertEquals(
		subPageRedirect(service("Pipeline"), "plan", "north-loop"),
		"/teams/north-loop/catalogue/svc-23456789ab?section=offer",
	);
});

Deno.test("buyer questions serve every service and send a product to its workspace", () => {
	assertEquals(subPageRedirect(service("One-Off"), "questions"), null);
	assertEquals(subPageRedirect(service("Group Session"), "questions"), null);
	assertEquals(subPageRedirect(product, "questions"), "/catalogue/prd-23456789ab");
	assertEquals(subPageRedirect(product, "plan"), "/catalogue/prd-23456789ab?section=offer");
});
