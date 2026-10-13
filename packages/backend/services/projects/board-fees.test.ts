import { assert, assertEquals } from "@std/assert";
import { PLATFORM_FEE_BP, platformFeeFor } from "@projective/types/finance";
import { allProjects } from "./fixtures.ts";
import { findBoardPage } from "./board-fixtures.ts";

Deno.test("fixture release fees derive from the SSOT rate and truncate like the release", () => {
	let checked = 0;
	for (const project of allProjects()) {
		const page = findBoardPage({ projectId: project.slug });
		if (!page) continue;
		for (const card of page.cards) {
			const fee = card.payments.find((p) => p.kind === "fee");
			const release = card.payments.find((p) => p.kind === "release");
			if (!fee || !release) continue;
			const total = release.amountCents - fee.amountCents;
			assertEquals(-fee.amountCents, platformFeeFor(total, PLATFORM_FEE_BP), card.id);
			assertEquals(fee.label, `Platform fee (${PLATFORM_FEE_BP / 100}%)`);
			checked++;
		}
	}
	assert(checked > 0, "no completed fixture ticket carries a fee row");
});
