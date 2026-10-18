import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { ELIGIBILITY_BLOCK_REASONS, ELIGIBILITY_NOTICES } from "@projective/types/finance";
import { APPLY_AS_SELF, applyAsDefault, eligibilityRefusal, showsRefusal } from "./apply-as.ts";

/**
 * The apply modal's two pure rules (Teams work order C5): the default applicant while acting as a team
 * (Decision #154 flag (c)), and B2's eligibility refusals stated as the modal's notice.
 */

const TEAM = "6a4f2d0e-0c5b-4c11-9a52-1f3b7c9d0e21";
const OTHER = "0b7e3c11-5d2a-4f6e-8a1c-2e9f4b6d7a30";

// #region Default applicant
Deno.test("apply as: acting as a team the viewer may bind defaults to that team", () => {
	assertStrictEquals(
		applyAsDefault({ actingTeamId: TEAM, offeredTeamIds: [OTHER, TEAM], canBindSeat: true }),
		TEAM,
	);
});

Deno.test("apply as: anything short of a bindable, offered acting team stays on Yourself", () => {
	const cases = [
		{ actingTeamId: null, offeredTeamIds: [TEAM], canBindSeat: true },
		{ actingTeamId: TEAM, offeredTeamIds: [TEAM], canBindSeat: false },
		{ actingTeamId: TEAM, offeredTeamIds: [TEAM], canBindSeat: null },
		// An archived (or otherwise unlisted) team is not in the picker, so it is never the default.
		{ actingTeamId: TEAM, offeredTeamIds: [OTHER], canBindSeat: true },
		{ actingTeamId: TEAM, offeredTeamIds: [], canBindSeat: true },
	];
	for (const input of cases) {
		assertStrictEquals(applyAsDefault(input), APPLY_AS_SELF, JSON.stringify(input));
	}
});
// #endregion

// #region Eligibility refusals
Deno.test("refusal: a pre-flight 422 tagged with an eligibility reason becomes the notice", () => {
	for (const reason of ELIGIBILITY_BLOCK_REASONS) {
		const refusal = eligibilityRefusal({
			ok: false,
			message: ELIGIBILITY_NOTICES[reason],
			errors: { allowance: reason },
			details: { blockReason: reason },
		});
		assertEquals(refusal, { reason, text: ELIGIBILITY_NOTICES[reason] });
	}
	// The tag alone is enough; the shared sentence stands in for a missing message.
	assertEquals(eligibilityRefusal({ ok: false, details: { blockReason: "team_too_small" } }), {
		reason: "team_too_small",
		text: ELIGIBILITY_NOTICES.team_too_small,
	});
});

Deno.test("refusal: the door's own untagged sentence is recognised word for word", () => {
	assertEquals(
		eligibilityRefusal({
			ok: false,
			message: ELIGIBILITY_NOTICES.missing_permission,
			errors: { stageId: "not_permitted" },
		})?.reason,
		"missing_permission",
	);
	assertEquals(
		eligibilityRefusal({
			ok: false,
			message: ELIGIBILITY_NOTICES.team_too_small,
			errors: { stageId: "refused" },
		})?.reason,
		"team_too_small",
	);
});

Deno.test("refusal: success, a meter and any other failure are not eligibility notices", () => {
	assertStrictEquals(eligibilityRefusal({ ok: true }), null);
	assertStrictEquals(
		eligibilityRefusal({
			ok: false,
			message: "Weekly proposal allowance reached (50/50).",
			errors: { allowance: "weekly_exhausted" },
		}),
		null,
	);
	assertStrictEquals(
		eligibilityRefusal({ ok: false, message: "You already have a pending application here." }),
		null,
	);
});

Deno.test("refusal: not drawn twice when the re-read allowance already states it", () => {
	const refusal = { reason: "team_not_active" as const, text: ELIGIBILITY_NOTICES.team_not_active };
	assert(showsRefusal(refusal, undefined));
	assert(showsRefusal(refusal, "team_too_small"));
	assert(!showsRefusal(refusal, "team_not_active"));
	assert(!showsRefusal(null, undefined));
});
// #endregion

// #region The modal wires both rules
/*
 * The island cannot be rendered under `deno test` (its ui imports pull CSS), so this reads its source:
 * the default goes through `applyAsDefault`, a pick is never overridden, and an eligibility refusal is
 * an InlineNotice rather than the error line.
 */
const MODAL = Deno.readTextFileSync(
	new URL("../islands/ProjectApplyModal.island.tsx", import.meta.url),
).replaceAll("\r\n", "\n");

Deno.test("apply modal: the default applicant is applyAsDefault's, and only until the reader picks", () => {
	assert(/applicant\.value = choice;/.test(MODAL));
	assert(/const choice = applyAsDefault\(\{/.test(MODAL));
	assert(/canBindSeat: res\.status\?\.canBindSeat \?\? null/.test(MODAL));
	assert(/if \(!picked\.peek\(\)\)/.test(MODAL), "the default checks the reader has not picked");
	assert(/onValueChange=\{\(v\) => \{\s*picked\.value = true;/.test(MODAL), "a pick is recorded");
	assert(!/useSignal<string>\(actingTeamId \?\? SELF\)/.test(MODAL), "no blind preselect");
});

Deno.test("apply modal: an eligibility refusal renders as the modal's InlineNotice", () => {
	assert(/const eligibility = eligibilityRefusal\(res\);/.test(MODAL));
	assert(
		/showsRefusal\(refusal\.value, status\?\.blockReason\)[\s\S]*?<InlineNotice\b/.test(MODAL),
	);
});
// #endregion
