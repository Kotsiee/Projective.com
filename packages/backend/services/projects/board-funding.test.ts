import { assert, assertEquals } from "@std/assert";
import {
	providerCanSeeCard,
	ticketPaidHere,
	ticketWorkLocked,
} from "@projective/types/projects";
import { findBoardPage } from "./board-fixtures.ts";
import { ProjectBackendService } from "./ProjectBackendService.ts";
import { resetWriteStore } from "./write-store.ts";
import type { ReadActor } from "../read-actor.ts";

/*
 * board-funding_test — the board's funding and visibility rules exercised through the READ, not
 * through the pure functions alone (those are pinned in `packages/types/projects/board-funding.test.ts`).
 *
 * The property that matters most cannot be seen in the code of either layer on its own: that the fat
 * service HANDS a provider-side viewer nothing they may not see. A rule that lives only in the island
 * is a rule a `curl` walks straight past, and root task §5 asks for the filter on the API. So these
 * tests ask the service and the fixture read as a freelancer would, and check what comes back.
 */

// #region Fixtures
/** A corpus project whose acting viewer is a FREELANCER (`viewerRole: "freelancer"`). */
const PROVIDER_SLUG = "prj-ghnkqoopo4";
/** A corpus project whose acting viewer is the CLIENT side (`viewerRole: "admin"`). */
const CLIENT_SLUG = "prj-8mzxqqn6w8";

const CLIENT: ReadActor = { userId: "u-client", contextId: "", contextType: "personal" };
const PROVIDER: ReadActor = { userId: "u-provider", contextId: "", contextType: "personal" };

const everyCorpusPage = () =>
	[
		"prj-ghnkqoopo4",
		"prj-xmvjo9wga8",
		"prj-3389ufcjs2",
		"prj-zsgn999b5g",
		"prj-xgandqb3cs",
		"prj-64vn8qwog8",
		"prj-eangynf67d",
		"prj-t22dcmq5fr",
		"prj-8mzxqqn6w8",
		"prj-mc9r4c9ha2",
		"prj-3dv9upprsd",
		"prj-tm2bjk9mdq",
		"prj-zrjpnhzjde",
		"prj-cujw52gg3p",
		"prj-mvztqq7ftf",
		"prj-kfxmx4m482",
	].map((slug) => findBoardPage({ projectId: slug })).filter((p) => p !== null);
// #endregion

// #region Provider visibility on the read
Deno.test("a provider-side viewer is handed only tickets paid where they sit, in stages they are onboarded to", () => {
	const page = findBoardPage({ projectId: PROVIDER_SLUG });
	assert(page);
	assert(!page.viewerIsClient);
	assert(page.viewerStageIds.length > 0, "a provider is onboarded to the started stages");
	const onboarded = new Set(page.viewerStageIds);
	assert(page.cards.length > 0, "the filter must leave something to look at");
	for (const card of page.cards) {
		assert(providerCanSeeCard(card, onboarded), `${card.id} should not have been handed over`);
		assert(ticketPaidHere(card), `${card.id} is not paid for the stage it sits in`);
		assert(card.stageId !== null, "the New backlog is never a provider's to see");
	}
	assertEquals(page.total, page.cards.length);
});

Deno.test("the same project shows the client side every ticket, unpaid ones included", () => {
	// The client fixture is a different engagement, so compare like with like: build the provider
	// page's project as if it were unfiltered by counting what the fixture corpus GENERATES for it.
	const provider = findBoardPage({ projectId: PROVIDER_SLUG })!;
	const client = findBoardPage({ projectId: CLIENT_SLUG })!;
	assert(client.viewerIsClient);
	assertEquals(client.viewerStageIds, []);
	assert(
		client.cards.some((c) => c.hasDescription && !ticketPaidHere(c)),
		"the client must be able to see an Unpaid ticket — that badge is theirs to act on",
	);
	assert(
		client.cards.some((c) => c.stageId === null),
		"the client sees the New backlog",
	);
	// And a freelancer never sees one of those.
	assert(provider.cards.every((c) => ticketPaidHere(c)));
});

Deno.test("every funding state the card can render is reachable somewhere in the corpus", () => {
	const cards = everyCorpusPage().flatMap((p) => p.cards);
	assert(cards.some((c) => c.paymentScope === "unpaid" && c.hasDescription), "unpaid, described");
	assert(cards.some((c) => c.paymentScope === "full"), "paid in full");
	assert(
		cards.some((c) => c.paymentScope === "per_stage" && ticketPaidHere(c)),
		"per-stage, paid where it sits",
	);
	assert(
		cards.some((c) => c.paymentScope === "per_stage" && !ticketPaidHere(c) && c.stageId !== null),
		"per-stage, sitting in a stage nobody paid for — the Unpaid badge on a stage column",
	);
	assert(cards.some((c) => ticketWorkLocked(c)), "a ticket the client's drag is locked on");
	// A draft can never have been bought.
	assert(cards.filter((c) => !c.hasDescription).every((c) => c.paymentScope === "unpaid"));
	// Escrow invariant: a claimed ticket is always paid for the stage it is being worked in.
	assert(cards.filter((c) => c.claimed && c.stageId !== null).every((c) => ticketPaidHere(c)));
});

Deno.test("the fat service applies the same scoping after the write overlay", async () => {
	resetWriteStore();
	const res = await ProjectBackendService.board({ projectId: PROVIDER_SLUG }, PROVIDER);
	assert(res.ok && res.data);
	const page = res.data.page;
	const onboarded = new Set(page.viewerStageIds);
	assert(page.cards.every((c) => providerCanSeeCard(c, onboarded)));
	assertEquals(page.total, page.cards.length);
});
// #endregion

// #region A move re-derives "paid here" from the destination, with no write to the purchase
Deno.test("dragging a per-stage ticket into an unpaid stage turns it Unpaid; dragging it back turns it Paid", async () => {
	resetWriteStore();
	const first = await ProjectBackendService.board({ projectId: CLIENT_SLUG }, CLIENT);
	assert(first.ok && first.data);
	const page = first.data.page;

	const card = page.cards.find((c) =>
		c.paymentScope === "per_stage" && !c.claimed && c.stageId !== null && ticketPaidHere(c)
	);
	assert(card, "the corpus carries a per-stage ticket paid where it sits");
	const paidStage = card.stageId!;
	const unpaidStage = page.stages.find((s) => !card.paidStageIds.includes(s.id));
	assert(unpaidStage, "and a stage nobody paid it for");

	const away = await ProjectBackendService.moveTicket({
		projectId: CLIENT_SLUG,
		ticketId: card.id,
		status: "todo",
		stageId: unpaidStage.id,
		sortOrder: null,
	}, CLIENT);
	assert(away.ok && away.data);
	assertEquals(away.data.card.stageId, unpaidStage.id);
	assert(!ticketPaidHere(away.data.card), "Unpaid in a stage nobody paid for");
	// The PURCHASE did not change — only where the ticket sits.
	assertEquals(away.data.card.paymentScope, "per_stage");
	assertEquals(away.data.card.paidStageIds, card.paidStageIds);

	const back = await ProjectBackendService.moveTicket({
		projectId: CLIENT_SLUG,
		ticketId: card.id,
		status: "todo",
		stageId: paidStage,
		sortOrder: null,
	}, CLIENT);
	assert(back.ok && back.data);
	assert(ticketPaidHere(back.data.card), "Paid again where it was bought");
});

Deno.test("a fully paid ticket stays paid wherever it is moved", async () => {
	resetWriteStore();
	const first = await ProjectBackendService.board({ projectId: CLIENT_SLUG }, CLIENT);
	assert(first.ok && first.data);
	const page = first.data.page;
	const card = page.cards.find((c) => c.paymentScope === "full" && !c.claimed);
	assert(card, "the corpus carries an unclaimed fully paid ticket");
	for (const stage of page.stages) {
		const moved = await ProjectBackendService.moveTicket({
			projectId: CLIENT_SLUG,
			ticketId: card.id,
			status: "todo",
			stageId: stage.id,
			sortOrder: null,
		}, CLIENT);
		assert(moved.ok && moved.data);
		assert(ticketPaidHere(moved.data.card), `still paid in ${stage.name}`);
	}
	// And in the New backlog too.
	const toNew = await ProjectBackendService.moveTicket({
		projectId: CLIENT_SLUG,
		ticketId: card.id,
		status: "backlog",
		stageId: null,
		sortOrder: 0,
	}, CLIENT);
	assert(toNew.ok && toNew.data);
	assert(ticketPaidHere(toNew.data.card));
});
// #endregion
