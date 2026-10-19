/**
 * board-fixtures — the boards the landing's work-board demos run on (`flows/LANDING.md` §4.1 hero
 * theatre, §4.4 Work board). Plain data, typed by `board-model.ts` and checked against the product's own
 * `@projective/types` shapes and `deriveFundingState` in `board-model.test.ts`, so the example stays
 * honest. No network, no randomness.
 */
import {
	approve,
	type BoardAction,
	type DemoBoardFixture,
	type DemoStage,
	pay,
	start,
} from "./board-model.ts";

// #region Hero theatre
/** The project's two stages, as each ticket prices them. */
const design = (priceMinor: number | null): DemoStage => ({
	id: "stage-design",
	name: "Design",
	priceMinor,
	chainReaction: true,
});
const launch = (priceMinor: number | null): DemoStage => ({
	id: "stage-launch",
	name: "Launch",
	priceMinor,
	chainReaction: true,
});

/**
 * The hero theatre's board "Website refresh" (§4.1), its Statuses view mid-way through: "Launch
 * emails" is a Draft (no price yet, so nothing can be paid or claimed); "Logo v2" needs £400 — a
 * claim was refused because the wallet is short; "Homepage design" is funded and under way; "Case
 * study" is in Review on its first stage; "Brand colours" is done and the team paid. The wallet
 * (£180) covers "Case study"'s next stage (£100) but not "Logo v2", so the header reads "1 task
 * needs £400 to start" (K8) and approving "Case study" moves it to its next stage, held from the
 * wallet (D1).
 */
export const HERO_BOARD: DemoBoardFixture = {
	title: "Website refresh",
	currency: "GBP",
	walletMinor: 18_000,
	cards: [
		{
			id: "launch-emails",
			title: "Launch emails",
			described: true,
			stages: [launch(null)],
			stageIndex: 0,
			status: "backlog",
			claimed: false,
			escrow: "none",
			needsFunding: false,
			assignee: null,
		},
		{
			id: "logo-v2",
			title: "Logo v2",
			described: true,
			stages: [design(40_000)],
			stageIndex: 0,
			status: "todo",
			claimed: false,
			escrow: "none",
			needsFunding: true,
			assignee: null,
		},
		{
			id: "homepage-design",
			title: "Homepage design",
			described: true,
			stages: [design(200_000)],
			stageIndex: 0,
			status: "in_progress",
			claimed: true,
			escrow: "held",
			needsFunding: false,
			assignee: { name: "Maya", avatar: "/test_images/profile_3.jpg" },
		},
		{
			id: "case-study",
			title: "Case study",
			described: true,
			stages: [design(15_000), launch(10_000)],
			stageIndex: 0,
			status: "in_review",
			claimed: true,
			escrow: "held",
			needsFunding: false,
			assignee: { name: "Theo", avatar: "/test_images/profile_4.jpg" },
		},
		{
			id: "brand-colours",
			title: "Brand colours",
			described: true,
			stages: [design(30_000)],
			stageIndex: 0,
			status: "completed",
			claimed: true,
			escrow: "released",
			needsFunding: false,
			assignee: { name: "Ines", avatar: "/test_images/profile_5.jpg" },
		},
	],
};

/**
 * The hero theatre's loop (§2.3 note 5): approve "Case study" — the team is paid, and the same task
 * moves to its next stage, paid for from the wallet.
 */
export const HERO_LOOP: readonly BoardAction[] = [approve("case-study")];
// #endregion

// #region Demo stage — Work board
/**
 * The demo stage's Work board (§4.4 Work board, §2.3 note 12's frame), one task per lane: "Launch
 * emails" is a Draft (no price yet); "Homepage design" waits in Ready on its £2,000 Design stage,
 * unclaimed and unpaid, with a £500 Launch stage after it; "Logo v2" is funded and under way;
 * "Case study" waits in Review for "Approve and pay"; "Brand colours" is done and the team paid.
 * The wallet (£600) is short of Homepage design's £2,000, so a freelancer's start is refused (K3),
 * and covers its £500 Launch stage once Design is approved (D1) — and Case study's £100 Launch
 * stage too, in either order. The freelancer who starts it is Noor: their start is the claim, so
 * once it goes through the card carries Noor's avatar in every work lane, as the product's does.
 */
export const DEMO_BOARD: DemoBoardFixture = {
	title: "Website refresh",
	currency: "GBP",
	walletMinor: 60_000,
	freelancer: { name: "Noor", avatar: "/test_images/profile_6.jpg" },
	cards: [
		{
			id: "launch-emails",
			title: "Launch emails",
			described: true,
			stages: [launch(null)],
			stageIndex: 0,
			status: "backlog",
			claimed: false,
			escrow: "none",
			needsFunding: false,
			assignee: null,
		},
		{
			id: "homepage-design",
			title: "Homepage design",
			described: true,
			stages: [design(200_000), launch(50_000)],
			stageIndex: 0,
			status: "todo",
			claimed: false,
			escrow: "none",
			needsFunding: false,
			assignee: null,
		},
		{
			id: "logo-v2",
			title: "Logo v2",
			described: true,
			stages: [design(40_000)],
			stageIndex: 0,
			status: "in_progress",
			claimed: true,
			escrow: "held",
			needsFunding: false,
			assignee: { name: "Maya", avatar: "/test_images/profile_3.jpg" },
		},
		{
			id: "case-study",
			title: "Case study",
			described: true,
			stages: [design(15_000), launch(10_000)],
			stageIndex: 0,
			status: "in_review",
			claimed: true,
			escrow: "held",
			needsFunding: false,
			assignee: { name: "Theo", avatar: "/test_images/profile_4.jpg" },
		},
		{
			id: "brand-colours",
			title: "Brand colours",
			described: true,
			stages: [design(30_000)],
			stageIndex: 0,
			status: "completed",
			claimed: true,
			escrow: "released",
			needsFunding: false,
			assignee: { name: "Ines", avatar: "/test_images/profile_5.jpg" },
		},
	],
};

/** The task the Work board's frames follow (§4.4 frames 1–6). */
export const DEMO_FOCUS_CARD = "homepage-design";

/**
 * The Work board's frame script (§4.4 frames 1–6), from {@link DEMO_BOARD}: the freelancer's start
 * is refused, the client pays, work starts and goes to Review, the client approves, and Chain
 * Reaction takes the same task to its next stage, paid for from the wallet.
 */
export const DEMO_SCRIPT: readonly BoardAction[] = [
	start(DEMO_FOCUS_CARD, "in_progress"),
	pay(DEMO_FOCUS_CARD),
	start(DEMO_FOCUS_CARD, "in_progress"),
	start(DEMO_FOCUS_CARD, "in_review"),
	approve(DEMO_FOCUS_CARD),
];
// #endregion
