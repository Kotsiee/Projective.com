/**
 * hero-search.test — the calls to action per viewer.
 */
import { assertEquals } from "@std/assert";
import { explorePath } from "@features/marketing/core/megamenu-data.ts";
import { GUEST_VIEWER, heroCtas, heroViewerOf } from "./hero-search.ts";

Deno.test("hero-search: the calls to action follow the viewer table", () => {
	const hire = { label: "Hire a team", href: explorePath("teams") };
	assertEquals(heroCtas(GUEST_VIEWER), {
		hire,
		offer: { label: "Offer your skills", href: "/join?intent=freelancer" },
	});
	const client = heroViewerOf(true, { isFreelancer: false, restricted: false });
	assertEquals(heroCtas(client).offer, { label: "Offer your skills", href: "/become-partner" });
	const freelancer = heroViewerOf(true, { isFreelancer: true, restricted: false });
	assertEquals(heroCtas(freelancer).offer, { label: "Find work", href: explorePath("projects") });
	const minor = heroViewerOf(true, { isFreelancer: false, restricted: true });
	assertEquals(heroCtas(minor), { hire, offer: null });
	assertEquals(heroCtas(heroViewerOf(true, { isFreelancer: true, restricted: true })).offer, null);
	assertEquals(heroViewerOf(false, { isFreelancer: true, restricted: true }), GUEST_VIEWER);
	assertEquals(heroViewerOf(true, null), GUEST_VIEWER);
});
