import { computed, signal } from "@preact/signals";
import { formatMoney } from "@projective/types/finance";
import type { EntityView } from "@projective/types/explore";
import type { ServiceBookingFormat, ServiceBookingOffer } from "@projective/types/services";
import { headlinePriceFor } from "./view-pricing.ts";
import { announce } from "./booking-state.ts";

/**
 * simulation — the owner's buyer simulation of a listing page (`/catalogue/[id]/simulate`, Decision
 * #217 (j)).
 *
 * The page is the real `EntityViewPage`: the lane, the archetype, the resolved CTA and every modal
 * are the ones a buyer meets. What changes is the COMMIT. Every write a buyer could make from the page
 * — instant checkout, a basket line, a pipeline draft, a booked time, a staged brief, a quote, a
 * question, a save — goes through {@link commitOrSimulate}, which, while the page is a simulation,
 * never runs the network call and instead states what would have happened ("A buyer would now pay
 * $480 into escrow and land on Project setup").
 *
 * The transactional regions are separate hydration roots (lane, buy bar, scheduler stage), so the
 * simulation is module state, seeded by each from its `simulation` prop — the `booking-state` /
 * `buy-now-state` precedent. Nothing here imports a component, so the gate is testable under
 * `deno test`.
 */

// #region Copy
/** The banner every simulated page leads with. */
export const SIMULATION_BANNER =
	"Preview · This is what buyers see. Nothing you do here books or charges.";

/** What a modal's commit button reads in a simulation (ruling #217 (j)). */
export const SIMULATED_COMMIT_LABEL = "Simulated: nothing is booked or charged";

/** What a commit control says once it has resolved locally. */
export const SIMULATED_SETTLED_LABEL = "Simulated";
// #endregion

// #region Facts
/** The listing facts an outcome sentence is written from, resolved once by the page. */
export interface SimulationFacts {
	/** The listing title. */
	title: string;
	/** The seller's display name. */
	sellerName: string;
	/** The headline price, formatted (`$480`), or `null` for a listing quoted on request. */
	price: string | null;
	/** Whether {@link price} is only the low end of a range. */
	isFloor: boolean;
	/** The booking format the offer resolved, or `null` when there is no offer. */
	format: ServiceBookingFormat | null;
	/** Whether this format's money is held in escrow at checkout. */
	escrows: boolean;
	/** How many stages the listing shows. */
	stageCount: number;
}

/** The facts a simulated page states its outcomes from. Pure. */
export function simulationFactsFor(
	view: EntityView,
	offer: ServiceBookingOffer | null,
): SimulationFacts {
	const headline = headlinePriceFor(view);
	const price = headline.amount
		? formatMoney(headline.amount.minor, headline.amount.currency)
		: null;
	return {
		title: view.item.title,
		sellerName: view.item.owner.name,
		price,
		isFloor: headline.isFloor,
		format: offer?.format ?? null,
		escrows: offer?.escrows ?? false,
		stageCount: view.service?.stages.length ?? 0,
	};
}
// #endregion

// #region Commits
/** Every write a buyer can make from a listing page. */
export type SimulatedCommit =
	| { kind: "buy_now" }
	| { kind: "add_to_basket" }
	| { kind: "instantiate_pipeline" }
	| { kind: "archive_draft" }
	| { kind: "book_session"; seats?: number }
	| { kind: "discovery_call"; minutes: number | null }
	| { kind: "configure"; wholeEngagement: boolean }
	| { kind: "custom_quote" }
	| { kind: "ask_question" }
	| { kind: "save" }
	| { kind: "collection" }
	| { kind: "share" };

/** "$480", "from $480", or "the quoted price". */
function priceOf(facts: SimulationFacts): string {
	if (!facts.price) return "the quoted price";
	return facts.isFloor ? `from ${facts.price}` : facts.price;
}

/** "into escrow " when this format escrows at checkout, else nothing. */
function escrowOf(facts: SimulationFacts): string {
	return facts.escrows ? " into escrow" : "";
}

/**
 * The would-be outcome of a commit, as one sentence that starts "A buyer would now…". Pure. It names
 * what the real flow does next and never claims more than the flow guarantees.
 */
export function simulatedOutcomeFor(commit: SimulatedCommit, facts: SimulationFacts): string {
	switch (commit.kind) {
		case "buy_now":
			return `A buyer would now pay ${priceOf(facts)} at checkout for ${facts.title}.`;
		case "add_to_basket":
			return `A buyer would now add ${facts.title} to their basket at ${
				priceOf(facts)
			}, and pay for it at checkout.`;
		case "instantiate_pipeline":
			return `A buyer would now add ${facts.title} to their projects as a draft and land on Project setup. Nothing is paid until a stage is funded.`;
		case "archive_draft":
			return "A buyer would now archive their draft of this listing.";
		case "book_session": {
			const seats = commit.seats ?? 1;
			const what = facts.format === "cohort"
				? `hold ${seats === 1 ? "a seat" : `${seats} seats`}`
				: "hold this time";
			return `A buyer would now ${what} and pay ${priceOf(facts)}${escrowOf(facts)} at checkout.`;
		}
		case "discovery_call":
			return `A buyer would now request ${
				commit.minutes ? `a ${commit.minutes}-minute call` : "a call"
			} with ${facts.sellerName}, who would confirm the time.`;
		case "configure": {
			const all = facts.stageCount <= 1 || commit.wholeEngagement;
			const what = all ? `pay ${priceOf(facts)}` : `fund stage 1 of ${facts.stageCount}`;
			return `A buyer would now ${what} into escrow at checkout and land on Project setup.`;
		}
		case "custom_quote":
			return `${facts.sellerName} would now receive this scope and reply with a price. Nothing is committed.`;
		case "ask_question":
			return `A buyer would now open a conversation with ${facts.sellerName} in Messages.`;
		case "save":
			return `A buyer would now save ${facts.title} to their saved items.`;
		case "collection":
			return `A buyer would now add ${facts.title} to one of their collections.`;
		case "share":
			return `A buyer would now share a link to ${facts.title}.`;
	}
}
// #endregion

// #region State
/** The simulated page's facts, or `null` on a real listing page. */
export const simulationFacts = signal<SimulationFacts | null>(null);

/** Whether the listing page is the owner's buyer simulation. */
export const simulating = computed(() => simulationFacts.value !== null);

/** The last simulated outcome, for the visible confirmation beside the control that committed. */
export const simulationOutcome = signal<string | null>(null);

/**
 * Seed the simulation from an island's `simulation` prop. Every transactional island calls it on
 * render, so whichever hydrates first arms the gate before any control can be pressed; `undefined`
 * (a real listing page) leaves it alone.
 */
export function seedSimulation(facts: SimulationFacts | undefined): void {
	if (!facts) return;
	const current = simulationFacts.peek();
	if (current && current.title === facts.title && current.format === facts.format) return;
	simulationFacts.value = facts;
}

/** Forget the last outcome (a modal closing, a fresh attempt). */
export function clearSimulationOutcome(): void {
	simulationOutcome.value = null;
}
// #endregion

// #region Gate
/** What a gated commit resolved to. */
export type CommitResult<T> =
	| { simulated: true; outcome: string }
	| { simulated: false; value: T };

/**
 * Run a buyer's commit, or — on a simulated page — resolve it locally. In a simulation `live` is
 * never called, so no request leaves the page: the outcome sentence is recorded, announced on the
 * shared status line, and returned for the control to show.
 */
export async function commitOrSimulate<T>(
	commit: SimulatedCommit,
	live: () => Promise<T>,
): Promise<CommitResult<T>> {
	const facts = simulationFacts.peek();
	if (!facts) return { simulated: false, value: await live() };
	const outcome = simulatedOutcomeFor(commit, facts);
	simulationOutcome.value = outcome;
	announce(outcome);
	return { simulated: true, outcome };
}
// #endregion
