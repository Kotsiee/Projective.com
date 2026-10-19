import { assert, assertEquals, assertNotEquals, assertStrictEquals } from "@std/assert";
import {
	type BusinessSpendPolicy,
	presetCapabilities,
	type SpendLimit,
	type SpendRequest,
	type WorkspaceMember,
} from "@projective/types/workspace";
import {
	APPROVERS_PICKER_ID,
	ceilingOf,
	decidedLine,
	decideNotice,
	DRAFT_NOTE,
	draftOf,
	draftPatch,
	envelopeLine,
	envelopeSummary,
	fixedHint,
	gapNotice,
	grantView,
	hasPickable,
	holderNames,
	isDirty,
	limitAnchorOf,
	limitsPatch,
	mergeGrant,
	meterOf,
	patchSignature,
	pendingLine,
	planNotice,
	PREVIEW_FAILED,
	PRICING_NOTE,
	queueControlId,
	rebaseDraft,
	requestRows,
	rowFace,
	rowView,
	SAVE_FAILED,
	saveRefusal,
	settledNote,
	type SpendDraft,
	spendLimitAnchor,
	spendLimitHref,
	thresholdDefault,
	thresholdLine,
} from "./spend-model.ts";
import { PLANS_UNAVAILABLE } from "./refusal-copy.ts";

/**
 * The Spend module's pure half (BU2, Decision #246): the draft saves only what moved and only for the
 * rows the server said the viewer may change; a drafted row draws the server's price of the draft or
 * nothing — never a stored figure patched in place; and the queue, pickers and notices render from the
 * server's flags.
 */

// #region Fixtures
const money = (minor: number) => ({
	minor,
	currency: "USD",
	display: `US$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
	origin: null,
});

function limit(memberId: string, extra: Partial<SpendLimit> = {}): SpendLimit {
	return {
		memberId,
		handle: memberId,
		name: memberId,
		avatar: "",
		canSpend: true,
		limitMinor: null,
		limit: null,
		period: "monthly",
		spentMinor: 0,
		spent: money(0),
		remainingMinor: null,
		remaining: null,
		usedFraction: 0,
		perTransactionMinor: null,
		perTransaction: null,
		...extra,
	};
}

/** Ren: may spend, no ceiling, 120.00 spent this month. */
const unlimited = limit("m-ren", { spentMinor: 12_000, spent: money(12_000) });

/** Hannah: a 25 000.00 monthly cap, 10 000.00 per purchase, 8 000.00 spent. */
const hannah = limit("m-hannah", {
	limitMinor: 2_500_000,
	limit: money(2_500_000),
	spentMinor: 800_000,
	spent: money(800_000),
	remainingMinor: 1_700_000,
	remaining: money(1_700_000),
	usedFraction: 0.32,
	perTransactionMinor: 1_000_000,
	perTransaction: money(1_000_000),
});

const owner = limit("m-priya");

function policy(extra: Partial<BusinessSpendPolicy> = {}): BusinessSpendPolicy {
	return {
		currency: "USD",
		approvalThresholdMinor: 500_000,
		approvalThreshold: money(500_000),
		platformThresholdMinor: null,
		platformThreshold: null,
		editableMemberIds: ["m-hannah", "m-ren"],
		approverGap: false,
		limitsPlanGated: false,
		approverIds: ["m-priya", "m-hannah"],
		approverHandles: [],
		limits: [owner, hannah, unlimited],
		readsAllEnvelopes: true,
		contributorIds: ["m-priya"],
		contributorHandles: [],
		entries: [],
		approvals: { pending: [], decided: [] },
		verification: "verified",
		verificationPrompt: null,
		...extra,
	};
}

function member(id: string, name: string, rolePreset: WorkspaceMember["rolePreset"]) {
	return { id, name, rolePreset, state: "active" as const };
}

const members = [
	member("m-priya", "Priya Raman", "owner"),
	member("m-hannah", "Hannah Cole", "admin"),
	member("m-ren", "Ren Koda", "member"),
];

function request(id: string, memberId: string, extra: Partial<SpendRequest> = {}): SpendRequest {
	return {
		id,
		memberId,
		handle: memberId,
		name: memberId,
		avatar: "",
		amount: money(1_200_000),
		reason: "Stage",
		state: "pending",
		raisedAt: "Today",
		approvers: ["Priya Raman"],
		decidedBy: null,
		decidedAt: null,
		expiresLabel: "Expires 24 Oct",
		ref: null,
		consumed: false,
		...extra,
	};
}
// #endregion

// #region BD2 — spent is never a ceiling
Deno.test("BD2: giving an unlimited member a ceiling never draws what they spent as the ceiling", () => {
	// Ren may spend with no ceiling and has spent US$120.00; the editor drafts a US$500.00 ceiling.
	const draft = {
		canSpend: true,
		limitMinor: 50_000,
		perTransactionMinor: null,
		period: "monthly" as const,
	};
	const signature = patchSignature([{ memberId: "m-ren", limitMinor: 50_000 }]);
	const spent = unlimited.spent.display;
	const texts = (facts: ReturnType<typeof rowFace>["facts"]) =>
		facts.map((f) => typeof f === "string" ? f : f.text);

	// Before the preview answers, and when it fails: no figure at all — no ceiling, no meter.
	for (const failed of [false, true]) {
		const face = rowFace(rowView(unlimited, draft, null, signature), failed);
		assertEquals(texts(face.facts), [failed ? PREVIEW_FAILED : PRICING_NOTE, DRAFT_NOTE]);
		assertStrictEquals(face.meter, null);
		assert(texts(face.facts).every((t) => !t.includes(spent)), "spent drawn while pricing");
	}

	// A preview of ANOTHER draft is not this draft's price: still no figure.
	const other = rowView(
		unlimited,
		draft,
		{ signature: "[]", limits: { "m-ren": unlimited } },
		signature,
	);
	assertStrictEquals(rowFace(other, false).meter, null);

	// Priced: the server's ceiling, never the spent figure, behind the "Not saved yet" marker.
	const priced = limit("m-ren", {
		limitMinor: 50_000,
		limit: money(50_000),
		spentMinor: 12_000,
		spent: money(12_000),
		remainingMinor: 38_000,
		remaining: money(38_000),
		usedFraction: 0.24,
	});
	const face = rowFace(
		rowView(unlimited, draft, { signature, limits: { "m-ren": priced } }, signature),
		false,
	);
	assertEquals(face.facts, [DRAFT_NOTE, { text: "US$500.00 / month", tabular: true }]);
	assertNotEquals(face.facts[1], { text: `${spent} / month`, tabular: true });
	assertEquals([face.meter?.percent, face.meter?.severity], [24, "secondary"]);
});

Deno.test("rowFace: a saved row draws its envelope and its meter, unmarked", () => {
	const face = rowFace({ shown: hannah, draft: false, pricing: false }, false);
	assertEquals(face.facts, envelopeLine(hannah));
	assertEquals(face.meter, meterOf(hannah));
	assertEquals(rowFace({ shown: unlimited, draft: false, pricing: false }, true).facts, [
		"No ceiling",
	]);
});

Deno.test("rowView: a drafted row draws the server's price of THAT draft, or nothing yet", () => {
	const draft = {
		canSpend: true,
		limitMinor: 50_000,
		perTransactionMinor: null,
		period: "monthly" as const,
	};
	const signature = patchSignature([{ memberId: "m-ren", limitMinor: 50_000 }]);

	const pricing = rowView(unlimited, draft, null, signature);
	assertEquals([pricing.shown, pricing.draft, pricing.pricing], [null, true, true]);

	const priced = limit("m-ren", {
		limitMinor: 50_000,
		limit: money(50_000),
		spentMinor: 12_000,
		spent: money(12_000),
		usedFraction: 0.24,
	});
	const stale = rowView(
		unlimited,
		draft,
		{ signature: "[]", limits: { "m-ren": priced } },
		signature,
	);
	assertStrictEquals(stale.shown, null, "a preview of a different draft is not this draft's price");

	const fresh = rowView(unlimited, draft, { signature, limits: { "m-ren": priced } }, signature);
	assertEquals([fresh.draft, fresh.pricing], [true, false]);
	assertEquals(ceilingOf(fresh.shown!)?.display, "US$500.00");
	assertNotEquals(envelopeLine(fresh.shown!)[0], { text: "US$120.00 / month", tabular: true });
	assertEquals(meterOf(fresh.shown!)?.percent, 24);

	const untouched = rowView(unlimited, { ...draft, limitMinor: null }, null, signature);
	assertEquals([untouched.shown, untouched.draft], [unlimited, false]);
});
// #endregion

// #region The draft's one save
Deno.test("draftPatch: nothing changed → null; a toggle sends only canSpend, for that row only", () => {
	const saved = policy();
	const draft = draftOf(saved);
	assertStrictEquals(draftPatch("b", saved, draft), null);
	assert(!isDirty(saved, draft));

	const toggled: SpendDraft = {
		...draft,
		limits: { ...draft.limits, "m-ren": { ...draft.limits["m-ren"], canSpend: false } },
	};
	assertEquals(draftPatch("b", saved, toggled), {
		workspaceId: "b",
		currency: "USD",
		limits: [{ memberId: "m-ren", canSpend: false }],
	});
	assert(isDirty(saved, toggled));
});

Deno.test("draftPatch: the owner's, the viewer's own and any row the server did not offer are never sent", () => {
	const saved = policy({ editableMemberIds: ["m-ren"] });
	const draft = draftOf(saved);
	const edited: SpendDraft = {
		...draft,
		limits: {
			"m-priya": { ...draft.limits["m-priya"], canSpend: false },
			"m-hannah": { ...draft.limits["m-hannah"], limitMinor: 1 },
			"m-ren": { ...draft.limits["m-ren"], period: "weekly" },
		},
	};
	assertEquals(limitsPatch(saved, edited), [{ memberId: "m-ren", period: "weekly" }]);
});

Deno.test("draftPatch: an unchanged threshold and unchanged grant sets never travel; changed ones do, whole", () => {
	const saved = policy();
	const draft = draftOf(saved);
	assertStrictEquals(
		draftPatch("b", saved, { ...draft, approverIds: ["m-hannah", "m-priya"] }),
		null,
	);
	assertEquals(draftPatch("b", saved, { ...draft, thresholdMinor: null }), {
		workspaceId: "b",
		currency: "USD",
		approvalThresholdMinor: null,
	});
	assertEquals(
		draftPatch("b", saved, { ...draft, approverIds: ["m-priya", "m-hannah", "m-ren"] })
			?.approverIds,
		["m-priya", "m-hannah", "m-ren"],
	);
});
// #endregion

Deno.test("rebaseDraft: a decision re-reads the rows the reader had not touched; their edits stay", () => {
	const before = policy();
	const after = policy({
		limits: [owner, { ...hannah, spentMinor: 1_200_000, usedFraction: 0.48 }, unlimited],
		approverIds: ["m-priya", "m-hannah"],
	});
	const draft = draftOf(before);
	const edited: SpendDraft = {
		...draft,
		thresholdMinor: 600_000,
		limits: { ...draft.limits, "m-ren": { ...draft.limits["m-ren"], limitMinor: 50_000 } },
	};
	const next = rebaseDraft(draftOf(before), after, edited);
	assertEquals(next.thresholdMinor, 600_000);
	assertEquals(next.limits["m-ren"].limitMinor, 50_000);
	assertEquals(next.limits["m-hannah"], draftOf(after).limits["m-hannah"]);
	assertEquals(draftPatch("b", after, next)?.limits, [{ memberId: "m-ren", limitMinor: 50_000 }]);
	assertStrictEquals(draftPatch("b", after, rebaseDraft(draftOf(before), after, draft)), null);
});

Deno.test("rebaseDraft: a save's answer replaces what was sent; what was typed while it flew stays", () => {
	const before = policy();
	const sent: SpendDraft = {
		...draftOf(before),
		thresholdMinor: 600_000,
		limits: {
			...draftOf(before).limits,
			"m-ren": { ...draftOf(before).limits["m-ren"], limitMinor: 50_000 },
		},
	};
	// The save landed: the threshold and Ren's ceiling are stored.
	const after = policy({
		approvalThresholdMinor: 600_000,
		approvalThreshold: money(600_000),
		limits: [owner, hannah, { ...unlimited, limitMinor: 50_000, limit: money(50_000) }],
	});
	// While it was on its way the reader ticked Ren as an approver and halved Hannah's per purchase.
	const typed: SpendDraft = {
		...sent,
		approverIds: [...sent.approverIds, "m-ren"],
		limits: {
			...sent.limits,
			"m-hannah": { ...sent.limits["m-hannah"], perTransactionMinor: 500_000 },
		},
	};
	const next = rebaseDraft(sent, after, typed);
	assertEquals(next.thresholdMinor, 600_000);
	assertEquals(next.limits["m-ren"], draftOf(after).limits["m-ren"]);
	assertEquals(draftPatch("b", after, next), {
		workspaceId: "b",
		currency: "USD",
		approverIds: ["m-priya", "m-hannah", "m-ren"],
		limits: [{ memberId: "m-hannah", perTransactionMinor: 500_000 }],
	});
	// Nothing typed in flight: the save leaves the editor clean.
	assertStrictEquals(draftPatch("b", after, rebaseDraft(sent, after, sent)), null);
});

// #region A row's words and meter
Deno.test("envelopeLine: spending off · a ceiling per period with its per-purchase cap · no ceiling", () => {
	assertEquals(envelopeLine({ ...hannah, canSpend: false }), ["Spending off"]);
	assertEquals(envelopeLine(hannah), [
		{ text: "US$25,000.00 / month", tabular: true },
		{ text: "US$10,000.00 per purchase", tabular: true },
	]);
	assertEquals(envelopeLine({ ...hannah, period: "weekly", perTransaction: null }), [
		{ text: "US$25,000.00 / week", tabular: true },
	]);
	assertEquals(envelopeLine({ ...hannah, period: "total", perTransaction: null })[0], {
		text: "US$25,000.00 in total",
		tabular: true,
	});
	assertEquals(envelopeLine(unlimited), ["No ceiling"]);
});

Deno.test("meterOf: the server's fraction as a percentage; amber from four-fifths; none without a ceiling", () => {
	assertEquals(meterOf(hannah), {
		percent: 32,
		severity: "primary",
		caption: [
			{ text: "US$8,000.00 spent", tabular: true },
			{ text: "US$17,000.00 left", tabular: true },
		],
	});
	assertEquals(meterOf({ ...hannah, usedFraction: 0.8 })?.severity, "warning");
	assertStrictEquals(meterOf(unlimited), null);
	assertStrictEquals(meterOf({ ...hannah, canSpend: false }), null);
});
// #endregion

// #region The grant pickers
Deno.test("grantView: the owner's picker offers the rows the server offered; the owner is fixed", () => {
	const saved = policy();
	const view = grantView(members, saved, saved.approverIds, "approve_spend", {
		memberId: "m-priya",
		capabilities: presetCapabilities("owner", "business"),
	});
	assertEquals(view.options.map((o) => [o.value, o.disabled ?? false]), [
		["m-hannah", false],
		["m-ren", false],
	]);
	assertEquals(view.value, ["m-hannah"]);
	assertEquals(view.fixed, ["you (owner)"]);
	assertEquals(fixedHint(view.fixed, "approve_spend"), "Also approving: you (owner).");
});

Deno.test("grantView: an admin sees the owner and herself fixed; nobody is granted what she lacks", () => {
	const saved = policy({ editableMemberIds: ["m-ren"] });
	const view = grantView(members, saved, saved.contributorIds, "contribute_funds", {
		memberId: "m-hannah",
		capabilities: ["manage_finances"],
	});
	assertEquals(view.options, [{
		value: "m-ren",
		label: "Ren Koda",
		disabled: true,
		description: "You can't give a permission you don't hold",
	}]);
	assertEquals(view.fixed, ["Priya Raman (owner)"]);
	assertEquals(
		grantView(members, saved, saved.approverIds, "approve_spend", {
			memberId: "m-hannah",
			capabilities: ["approve_spend"],
		}).fixed,
		["Priya Raman (owner)", "you"],
	);
});

Deno.test("holderNames: the owner first and marked, the reader as You", () => {
	assertEquals(holderNames(members, ["m-hannah", "m-priya"], "m-hannah"), [
		"Priya Raman (owner)",
		"You",
	]);
	assertEquals(holderNames(members, ["m-priya"], "m-priya"), ["You (owner)"]);
});

Deno.test("mergeGrant: picks replace only the rows the picker shows", () => {
	assertEquals(mergeGrant(["m-priya", "m-hannah"], ["m-ren"], ["m-ren"]), [
		"m-priya",
		"m-hannah",
		"m-ren",
	]);
	assertEquals(mergeGrant(["m-priya", "m-ren"], ["m-ren"], []), ["m-priya"]);
});
// #endregion

// #region The queue
Deno.test("requestRows: the first decidable row is tier 3, the rest tier 4; one's own row offers Withdraw", () => {
	const rows = requestRows(
		[request("r1", "m-viewer"), request("r2", "m-hannah"), request("r3", "m-ren")],
		{ memberId: "m-viewer", canDecide: true },
	);
	assertEquals(rows.map((r) => [r.request.id, r.action, r.approveTier, r.own]), [
		["r1", "withdraw", "neutral", true],
		["r2", "decide", "primary", false],
		["r3", "decide", "neutral", false],
	]);
	assertEquals(
		requestRows([request("r2", "m-hannah")], { memberId: "m-x", canDecide: false })[0].action,
		"none",
	);
});

Deno.test("pendingLine / decidedLine: raised, expiry, who it waits on; each terminal state worded", () => {
	assertEquals(pendingLine(request("r", "m")), [
		"Today",
		"Expires 24 Oct",
		"Waiting on Priya Raman",
	]);
	const decided = (state: SpendRequest["state"], extra: Partial<SpendRequest> = {}) =>
		decidedLine(request("r", "m", { state, decidedAt: "Yesterday", ...extra }));
	assertEquals(decided("approved", { decidedBy: "Priya Raman", consumed: true }), [
		"Approved by Priya Raman",
		"Yesterday",
		"Used",
	]);
	assertEquals(decided("declined", { decidedBy: "Priya Raman" }), [
		"Declined by Priya Raman",
		"Yesterday",
	]);
	assertEquals(decided("withdrawn"), ["Withdrawn", "Yesterday"]);
	assertEquals(decided("expired"), ["Expired"]);
});

Deno.test("settledNote: the announcement is the state the re-read left the request in", () => {
	const after = (state: SpendRequest["state"]) =>
		policy({ approvals: { pending: [], decided: [request("r1", "m-ren", { state })] } });
	assertEquals(settledNote(after("withdrawn"), "r1", "withdraw"), "Request withdrawn.");
	assertEquals(settledNote(after("approved"), "r1", "approve"), "Approved.");
	assertEquals(settledNote(after("declined"), "r1", "decline"), "Declined.");
	// A request that lapsed while the page was open: both doors mark it expired and answer success.
	assertEquals(
		settledNote(after("expired"), "r1", "withdraw"),
		"That request had already expired.",
	);
	assertEquals(settledNote(after("expired"), "r1", "approve"), "That request had already expired.");
	// A re-read that does not carry the row falls back to the act.
	assertEquals(settledNote(policy(), "r1", "decline"), "Declined.");
	assertEquals(settledNote(null, "r1", "withdraw"), "Request withdrawn.");
});
// #endregion

// #region Notices
Deno.test("decideNotice: an approver on an unverified business is sent to Verification — if it admits them", () => {
	const base = {
		kind: "business" as const,
		handle: "atlaslabs",
		business: "Atlas Labs",
		canDecide: false,
		kybStatus: "pending",
	};
	const owner = decideNotice({ ...base, capabilities: presetCapabilities("owner", "business") });
	assertEquals(owner?.link, {
		label: "See verification",
		href: "/businesses/atlaslabs/verification",
	});
	// The approver form: what waits for them is deciding, never the payer's "You can pay".
	assertEquals(
		owner?.sentence,
		"Atlas Labs' verification is still in review. You can decide spend requests once it clears.",
	);
	assertStrictEquals(owner?.meta, null);
	assertStrictEquals(owner?.ask, null);

	const approver = decideNotice({ ...base, capabilities: ["approve_spend"] });
	assertStrictEquals(approver?.link, null);
	assertEquals(approver?.ask, "Ask the owner to verify the business.");

	assertStrictEquals(decideNotice({ ...base, capabilities: ["spend_funds"] }), null);
	assertStrictEquals(
		decideNotice({ ...base, canDecide: true, capabilities: ["approve_spend"] }),
		null,
	);
});

Deno.test("gapNotice: editors only, linked to the approvers picker when it has anybody in it", () => {
	const notice = gapNotice({
		approverGap: true,
		editPolicy: true,
		viewerIsOwner: true,
		pickable: true,
	});
	assertEquals(notice?.link, { label: "Choose approvers", href: `#${APPROVERS_PICKER_ID}` });
	assert(notice?.sentence.startsWith("Nobody besides you"));
	assertStrictEquals(
		gapNotice({ approverGap: true, editPolicy: false, viewerIsOwner: false, pickable: true }),
		null,
	);
	assertStrictEquals(
		gapNotice({ approverGap: false, editPolicy: true, viewerIsOwner: true, pickable: true }),
		null,
	);
	assertStrictEquals(
		gapNotice({ approverGap: true, editPolicy: true, viewerIsOwner: false, pickable: false })?.link,
		null,
	);
});

Deno.test("hasPickable: a picker whose every row is disabled is no place to send the reader", () => {
	const saved = policy({ editableMemberIds: ["m-ren"], approverIds: ["m-priya"] });
	// An editor without approve_spend, over a member who does not hold it either: one disabled row.
	const locked = grantView(members, saved, saved.approverIds, "approve_spend", {
		memberId: "m-hannah",
		capabilities: ["manage_finances"],
	});
	assertEquals(locked.options.length, 1);
	assertEquals(hasPickable(locked), false);
	const notice = gapNotice({
		approverGap: true,
		editPolicy: true,
		viewerIsOwner: false,
		pickable: hasPickable(locked),
	});
	assertStrictEquals(notice?.link, null, "no 'Choose approvers' into a list that cannot change");
	assertEquals(notice?.ask, "Invite a member who can approve spending.");
	const open = grantView(members, saved, saved.approverIds, "approve_spend", {
		memberId: "m-hannah",
		capabilities: ["manage_finances", "approve_spend"],
	});
	assertEquals(hasPickable(open), true);
});

Deno.test("saveRefusal: a refused save is said beside what it concerns, never only under the queue", () => {
	const threshold = { approvalThresholdMinor: 0 };
	const both = { approvalThresholdMinor: 100, approverIds: ["m-priya"] };
	const limits = {
		limits: [{ memberId: "m-hannah", canSpend: false }, { memberId: "m-ren", limitMinor: 9 }],
	};
	// A field-keyed error goes to its field…
	assertEquals(
		saveRefusal(both, {
			message: "Check the highlighted fields.",
			errors: { approverIds: "Pick a member." },
		}),
		{ section: "grants", field: "approvers", memberId: null, text: "Pick a member." },
	);
	assertEquals(
		saveRefusal(threshold, { errors: { approvalThresholdMinor: "Too small." } }),
		{ section: "threshold", field: "threshold", memberId: null, text: "Too small." },
	);
	// …a limits row's to Member limits, naming the row by the patch's own index.
	assertEquals(
		saveRefusal(limits, { errors: { "limits.1.limitMinor": "That amount is too large." } }),
		{ section: "limits", field: null, memberId: "m-ren", text: "That amount is too large." },
	);
	assertEquals(
		saveRefusal(limits, {
			message: "A period is weekly.",
			errors: { limits: "A period is weekly." },
		}),
		{ section: "limits", field: null, memberId: null, text: "A period is weekly." },
	);
	// A refusal naming no field goes to the first section the save changed, in page order.
	assertEquals(
		saveRefusal(both, { message: "You cannot change that for this member." }),
		{
			section: "threshold",
			field: null,
			memberId: null,
			text: "You cannot change that for this member.",
		},
	);
	assertEquals(saveRefusal({ contributorIds: [] }, {}).section, "grants");
	assertEquals(saveRefusal(limits, {}).text, SAVE_FAILED);
	// An error keyed to nothing on this form beats the route's "Check the highlighted fields."
	assertEquals(
		saveRefusal(limits, {
			message: "Check the highlighted fields.",
			errors: { currency: "Pick a currency." },
		}).text,
		"Pick a currency.",
	);
});

Deno.test("queueControlId: one id per request and act, so a refusal can hand focus back", () => {
	assertEquals(queueControlId("r-1", "approve"), "wsp-request-r-1-approve");
	assertNotEquals(queueControlId("r-1", "approve"), queueControlId("r-1", "decline"));
	assertNotEquals(queueControlId("r-1", "withdraw"), queueControlId("r-2", "withdraw"));
});

Deno.test("planNotice: Business Pro, worded by the refusal map, with no plans link to a dead end", () => {
	const base = { gated: true, editPolicy: true, business: "Helia Finance" };
	const notice = planNotice({ ...base, viewerIsOwner: true });
	assertEquals(notice?.sentence, "That's part of Business Pro, which Helia Finance isn't on.");
	assertEquals(notice?.meta, "Changing plans isn't available yet.");
	assertStrictEquals(notice?.link, null);
	assertEquals(
		planNotice({ ...base, viewerIsOwner: false })?.meta,
		"Ask the owner about upgrading to Business Pro.",
	);
	assertStrictEquals(planNotice({ ...base, gated: false, viewerIsOwner: true }), null);
	// A reader who may not edit the policy (a plain member, an approve-only role) is not refused.
	assertStrictEquals(planNotice({ ...base, editPolicy: false, viewerIsOwner: false }), null);
});

Deno.test("threshold: what an empty field means, and the read-only line", () => {
	assertEquals(thresholdDefault(policy()), ["Empty means no threshold"]);
	assertEquals(thresholdDefault(policy({ platformThreshold: money(1_000_000) })), [
		"Empty uses the platform's default",
		{ text: "US$10,000.00", tabular: true },
	]);
	assertEquals(thresholdLine(policy()), [{ text: "US$5,000.00", tabular: true }]);
	assertEquals(
		thresholdLine(policy({ approvalThreshold: null, platformThreshold: money(1_000_000) })),
		[{ text: "US$10,000.00", tabular: true }, "the platform's default"],
	);
	assertEquals(thresholdLine(policy({ approvalThreshold: null })), ["No threshold"]);
});
// #endregion

// #region The Members drawer's deep link (BU7)
Deno.test("a member's limits row is addressable: #limit-<handle>, landed on from Members", () => {
	assertEquals(spendLimitAnchor("hannahcole"), "limit-hannahcole");
	assertEquals(spendLimitAnchor("@hannahcole"), "limit-hannahcole");
	assertEquals(
		spendLimitHref("heliafinance", "hannahcole"),
		"/businesses/heliafinance/spend#limit-hannahcole",
	);
	// A username may hold `.` or `_`; the fragment keeps them and decodes back to the row's id.
	const dotted = spendLimitHref("heliafinance", "ravi.k").split("#")[1];
	assertEquals(limitAnchorOf(dotted), "limit-ravi.k");
	assertEquals(limitAnchorOf("#limit-hannahcole"), "limit-hannahcole");
	assertEquals(limitAnchorOf("#limit-r%C3%A9my"), "limit-rémy");
	assertStrictEquals(limitAnchorOf("#approvers"), null);
	assertStrictEquals(limitAnchorOf(""), null);
	assertStrictEquals(limitAnchorOf("#limit-%E0%A4%A"), null, "a fragment that does not decode");
});

Deno.test("envelopeSummary: the envelope's first fact — the ceiling and its window, or the state", () => {
	assertEquals(envelopeSummary(hannah), { text: "US$25,000.00 / month", tabular: true });
	assertEquals(envelopeSummary(unlimited), "No ceiling");
	assertEquals(envelopeSummary({ ...hannah, canSpend: false }), "Spending off");
	assertEquals(envelopeSummary(hannah), envelopeLine(hannah)[0]);
});

Deno.test("planNotice: the owner's meta is the refusal map's one PLANS_UNAVAILABLE line", () => {
	const notice = planNotice({
		gated: true,
		editPolicy: true,
		business: "Helia Finance",
		viewerIsOwner: true,
	});
	assertEquals(notice?.meta, PLANS_UNAVAILABLE);
});
// #endregion
