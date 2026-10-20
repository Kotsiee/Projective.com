import type { JSX } from "preact";
import { DEFAULT_AVATAR_URL } from "@projective/types/user";
import LandingBackground from "@features/landing/islands/LandingBackground.island.tsx";
import HeroSearch from "@features/landing/islands/HeroSearch.island.tsx";
import FeatureDemoDialog from "@features/landing/islands/FeatureDemoDialog.island.tsx";
import { FINAL_SEARCH_SUFFIX, FINAL_TITLE_ID } from "@features/landing/components/FinalCta.tsx";
import {
	FeaturesPageView,
	type FeaturesPageViewProps,
} from "@features/landing/components/FeaturesPageView.tsx";
import { BoardPicture } from "@features/landing/components/demos/BoardPicture.tsx";
import { BookingPoster } from "@features/landing/components/demos/BookingPicture.tsx";
import { PaymentsPoster } from "@features/landing/components/demos/PaymentsPicture.tsx";
import {
	BOARD_LANES,
	createBoard,
	scriptFrames,
} from "@features/landing/core/demos/board-model.ts";
import { DEMO_BOARD } from "@features/landing/core/demos/board-fixtures.ts";
import { featureDemoEntries } from "@features/landing/core/feature-dialog.ts";

export { featuresPageMeta } from "@features/landing/core/features-seo.ts";

// #region Page
/** What the thin route reads for the page. */
export interface FeaturesPageProps extends Omit<FeaturesPageViewProps, "islands" | "viewer"> {
	/**
	 * The platform fee in basis points (`PublicMetricsService` `platformFeeBp`), or `null` when the
	 * read failed — then every fee clause in the stills and the demos drops (`flows/LANDING.md` §4).
	 */
	feeBp: number | null;
	/** The final search's data (`ExploreBackendService.landingHero`) and the viewer facts. */
	hero: {
		terms: string[];
		trending: string[];
		viewer: FeaturesPageViewProps["viewer"];
	};
}

/**
 * FeaturesPage — the page controller of `/features` (`flows/LANDING.md` §2.5, §2.6, §4.12; work order
 * L5), rendered inside LandingShell's `<main>`. It builds the page's island-bearing parts and hands
 * them to {@link FeaturesPageView}:
 *
 *   - each chapter's picture, every one a real component over L3's fixtures: Find & hire shows the
 *     Booking demo's opening picture — a live session's times on both clocks — ({@link
 *     BookingPoster}, beside "Services & sessions"), Run the work the Work board's real
 *     `@projective/ui` kanban held still ({@link BoardPicture}, the demo stage's own poster frame),
 *     Money the Payment protection demo's opening picture ({@link PaymentsPoster}). Trust has no real
 *     capture of the verification flow yet and Coming soon has nothing to show, so both print their
 *     rows beside their head, never a placeholder in a product window (Decision #302 (C), §8);
 *   - the "Try it" dialog ({@link FeatureDemoDialog}), handed the server's fee and the four rows with
 *     a demo;
 *   - the final call to action's background and its search — the page's only search, so it takes the
 *     `/` shortcut (Decision #282 FLAG (a), §2.6 note 7), with no typewriter, its landmark named by the
 *     section's h2.
 */
export function FeaturesPage({ feeBp, hero, ...view }: FeaturesPageProps): JSX.Element {
	const board = createBoard(DEMO_BOARD, { feeBp });
	const [still] = scriptFrames(board, []);
	return (
		<FeaturesPageView
			{...view}
			viewer={hero.viewer}
			islands={{
				dialog: <FeatureDemoDialog feeBp={feeBp} entries={featureDemoEntries()} />,
				stills: {
					"find-and-hire": <BookingPoster />,
					"run-the-work": (
						<BoardPicture
							frame={still}
							title={board.title}
							walletMinor={board.walletMinor}
							currency={board.currency}
							lane={BOARD_LANES.indexOf("todo")}
						/>
					),
					"money": <PaymentsPoster feeBp={feeBp} />,
				},
				finalBackground: <LandingBackground variant="final" />,
				finalSearch: (
					<HeroSearch
						idSuffix={FINAL_SEARCH_SUFFIX}
						slashFocus
						typewriter={false}
						terms={hero.terms}
						trending={hero.trending}
						avatarFallback={DEFAULT_AVATAR_URL}
						landmarkLabelledBy={FINAL_TITLE_ID}
					/>
				),
			}}
		/>
	);
}
// #endregion
