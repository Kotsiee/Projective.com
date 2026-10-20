import type { JSX } from "preact";
import type { DemoId } from "@features/landing/core/demos/demo-contract.ts";
import {
	BOARD_LANES,
	createBoard,
	scriptFrames,
} from "@features/landing/core/demos/board-model.ts";
import { DEMO_BOARD } from "@features/landing/core/demos/board-fixtures.ts";
import { DEMO_SECTION_ID } from "@features/landing/core/demo-stage.ts";
import DemoHost from "@features/landing/islands/DemoHost.island.tsx";
import { BoardPicture } from "@features/landing/components/demos/BoardPicture.tsx";
import { PaymentsPoster } from "@features/landing/components/demos/PaymentsPicture.tsx";
import { BookingPoster } from "@features/landing/components/demos/BookingPicture.tsx";
import { TeamPayPoster } from "@features/landing/components/demos/TeamPayPicture.tsx";
import { DEMO_TITLE_ID, DemoStageHeader } from "@features/landing/components/DemoStageView.tsx";

// #region Component
/** Props for {@link DemoStage}. */
export interface DemoStageProps {
	/** The tab the URL asks for (`?demo=`, read by the thin controller; default `board`). */
	demo: DemoId;
	/**
	 * The platform fee in basis points from the server (`PublicMetricsService` `platformFeeBp`), or
	 * `null` when it is unavailable — then every fee clause drops (`flows/LANDING.md` §4).
	 */
	feeBp: number | null;
	/**
	 * Link to `/features` beside the tabs ("See everything Projective does", work order L5). `/`
	 * turns it on; off, no link renders — a stage shown on `/features` itself would lead nowhere new.
	 */
	features?: boolean;
}

/**
 * DemoStage — the landing's "see it work" section, `#demo` (`flows/LANDING.md` §2.1 notes 10–13,
 * §2.2 notes 11–12, §2.3 notes 11–12, §4.4; work order L3).
 *
 * The server renders all of it: the section header and h2 ({@link DemoStageHeader}), the stage
 * note and the role note, then the DemoHost island's tabs and panels with every tab's crawlable
 * description and poster — each a still of its demo's opening picture over the demo's own
 * fixture, drawn by the demo's own parts and held still: the Work board's real `@projective/ui`
 * kanban ({@link BoardPicture}, handed to the island as its children), Payment protection's stages
 * and money ({@link PaymentsPoster}), Booking's times on both clocks ({@link BookingPoster}) and
 * Team pay's rows to the penny ({@link TeamPayPoster}), each handed over as a JSX prop. The island
 * opens tabs in place and loads only the open tab's demo once the stage nears the viewport.
 */
export default function DemoStage({ demo, feeBp, features = false }: DemoStageProps): JSX.Element {
	const board = createBoard(DEMO_BOARD, { feeBp });
	const [still] = scriptFrames(board, []);
	return (
		<section id={DEMO_SECTION_ID} class="lp-demo" aria-labelledby={DEMO_TITLE_ID}>
			<div class="lp-demo__inner">
				<DemoStageHeader />
				<DemoHost
					initial={demo}
					feeBp={feeBp}
					features={features}
					paymentsPoster={<PaymentsPoster feeBp={feeBp} />}
					bookingPoster={<BookingPoster />}
					splitsPoster={<TeamPayPoster feeBp={feeBp} />}
				>
					<BoardPicture
						frame={still}
						title={board.title}
						walletMinor={board.walletMinor}
						currency={board.currency}
						lane={BOARD_LANES.indexOf("todo")}
					/>
				</DemoHost>
			</div>
		</section>
	);
}
// #endregion
