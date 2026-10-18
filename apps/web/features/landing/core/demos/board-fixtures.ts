/**
 * board-fixtures — the boards the landing's work-board demos run on (`flows/LANDING.md` §4.1 hero
 * theatre). Plain data, typed by `board-model.ts` and checked against the product's own
 * `@projective/types` shapes and `deriveFundingState` in `board-model.test.ts`, so the example stays
 * honest. No network, no randomness.
 */
import { approve, type BoardAction, type DemoBoardFixture, type DemoStage } from "./board-model.ts";

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
