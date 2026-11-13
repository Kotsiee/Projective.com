import type { MenuItem } from "@ui/types/mod.ts";
import {
	type BoardCard,
	executionBands,
	TICKET_MAX_STAGES,
	ticketTermsLocked,
} from "../types/projects-types.ts";
import { activeStagesFor } from "./ticket-view.ts";

/**
 * stage-menu — what each stage card in the ticket modal may do, and the rows its menu offers.
 *
 * Pure: the pipeline hands in the facts it already holds and the commands to run. A claimed ticket's
 * stages are its terms (Decision #291, enforced by `projects.fn_ticket_immutability_guard`), so once
 * claimed every stage is locked, each with a reason that says where that stage stands. A row that
 * could not do anything is absent; a row the reader should understand the refusal of is present,
 * disabled, with the reason (root CLAUDE.md §3 gate 11).
 *
 * @module
 */

// #region Phases & locks
/** Where a stage stands in a claimed ticket's run. */
export type StagePhase = "done" | "running" | "upcoming";

/** The refusal for taking out a ticket's only stage. */
export const LAST_STAGE_REFUSAL =
	"A ticket runs through at least one stage. Add another before taking this one out.";

/** The refusal for adding a stage past the cap. */
export const STAGE_CAP_REFUSAL = `A ticket runs through at most ${TICKET_MAX_STAGES} stages.`;

const KEEPS_TERMS = "A claimed ticket keeps the stages it was claimed on.";

const PHASE_LOCK: Record<StagePhase, string> = {
	done: `This stage is finished. ${KEEPS_TERMS}`,
	running: `Work on this stage is under way. ${KEEPS_TERMS}`,
	upcoming: `This stage hasn't started, but ${KEEPS_TERMS.charAt(0).toLowerCase()}${
		KEEPS_TERMS.slice(1)
	}`,
};

/**
 * Each stage's phase: the bands before the one being worked are done, that band is running, and the
 * rest are upcoming. A completed ticket is done throughout; one not yet in a stage is all upcoming.
 */
export function stagePhases(card: BoardCard): Map<string, StagePhase> {
	const ordered = [...card.stages].sort((a, b) => a.order - b.order);
	const phases = new Map<string, StagePhase>();
	if (card.status === "completed") {
		for (const s of ordered) phases.set(s.stageId, "done");
		return phases;
	}
	const running = new Set(activeStagesFor(card).map((s) => s.stageId));
	const bands = executionBands(ordered);
	const current = bands.findIndex((b) => b.some((s) => running.has(s.stageId)));
	bands.forEach((band, i) => {
		const phase: StagePhase = current < 0 || i > current
			? "upcoming"
			: i === current
			? "running"
			: "done";
		for (const s of band) phases.set(s.stageId, phase);
	});
	return phases;
}

/** The pipeline's locks: the ticket-wide notice, and each locked stage's reason. */
export interface PipelineLocks {
	/** Why the ticket's composition is frozen, or `null` while it may change. */
	ticket: string | null;
	stages: ReadonlyMap<string, string>;
}

/** Lock every stage of a claimed ticket, each with the reason its phase gives; nothing otherwise. */
export function pipelineLocks(card: BoardCard): PipelineLocks {
	if (!ticketTermsLocked(card)) return { ticket: null, stages: new Map() };
	const who = card.assignee?.name;
	const stages = new Map<string, string>();
	for (const [id, phase] of stagePhases(card)) stages.set(id, PHASE_LOCK[phase]);
	return {
		ticket: who
			? `Claimed by ${who}. The stages stay as they were when it was claimed.`
			: "Claimed. The stages stay as they were when it was claimed.",
		stages,
	};
}

/** Why a stage cannot be taken out of the ticket, or `null` when it can. */
export function removalRefusal(includedCount: number, lock: string | null): string | null {
	return lock ?? (includedCount <= 1 ? LAST_STAGE_REFUSAL : null);
}

/** Why an available stage cannot be added, or `null` when it can. */
export function inclusionRefusal(includedCount: number, ticketLock: string | null): string | null {
	return ticketLock ?? (includedCount >= TICKET_MAX_STAGES ? STAGE_CAP_REFUSAL : null);
}
// #endregion

// #region Menu
/** Another included stage, as the "Run in parallel with" submenu lists it. */
export interface StageMenuPeer {
	stageId: string;
	name: string;
	/** Whether it already runs in the same step as the card's stage. */
	sameBand: boolean;
}

/** What the pipeline knows about one stage card. */
export type StageMenuFacts =
	| {
		zone: "included";
		/** Position in the ticket's order, and how many stages the ticket includes. */
		index: number;
		count: number;
		/** The other included stages, in pipeline order. */
		peers: readonly StageMenuPeer[];
		/** This stage's lock reason, or `null`. */
		lock: string | null;
	}
	| {
		zone: "available";
		count: number;
		/** The ticket-wide lock, or `null`. */
		lock: string | null;
	};

/** The commands the stage rows run. */
export interface StageMenuActions {
	configure: () => void;
	move: (direction: -1 | 1) => void;
	/** Bring `peerId` into this stage's step, beside it. */
	groupWith: (peerId: string) => void;
	/** Take this stage out of its step's group into a step of its own. */
	sequential: () => void;
	include: () => void;
	remove: () => void;
}

const ALREADY_PARALLEL = "Already runs in this step.";

const refused = (reason: string | null): Pick<MenuItem, "disabled" | "disabledReason"> =>
	reason ? { disabled: true, disabledReason: reason } : {};

/** The rows a stage card's `…` and right-click open. */
export function stageMenuModel(facts: StageMenuFacts, run: StageMenuActions): MenuItem[] {
	if (facts.zone === "available") {
		return [{
			key: "stage-include",
			label: "Include in ticket",
			icon: "plus",
			command: run.include,
			...refused(inclusionRefusal(facts.count, facts.lock)),
		}];
	}

	const { index, count, peers, lock } = facts;
	const rows: MenuItem[] = [
		{ key: "stage-configure", label: "Configure stage", icon: "settings", command: run.configure },
	];

	const order: MenuItem[] = [];
	if (index > 0) {
		order.push({
			key: "stage-up",
			label: "Move up",
			icon: "arrow-up",
			command: () => run.move(-1),
			...refused(lock),
		});
	}
	if (index < count - 1) {
		order.push({
			key: "stage-down",
			label: "Move down",
			icon: "arrow-down",
			command: () => run.move(1),
			...refused(lock),
		});
	}
	if (order.length > 0) rows.push({ separator: true, key: "stage-sep-order" }, ...order);

	const concurrency: MenuItem[] = [];
	if (peers.length > 0) {
		concurrency.push({
			key: "stage-parallel",
			label: "Run in parallel with",
			icon: "switch",
			...refused(lock),
			items: lock ? undefined : peers.map((peer) => ({
				key: `stage-parallel-${peer.stageId}`,
				label: peer.name,
				command: () => run.groupWith(peer.stageId),
				...refused(peer.sameBand ? ALREADY_PARALLEL : null),
			})),
		});
	}
	if (peers.some((p) => p.sameBand)) {
		concurrency.push({
			key: "stage-sequential",
			label: "Run sequentially",
			icon: "arrow-down",
			command: run.sequential,
			...refused(lock),
		});
	}
	if (concurrency.length > 0) {
		rows.push({ separator: true, key: "stage-sep-parallel" }, ...concurrency);
	}

	rows.push(
		{ separator: true, key: "stage-sep-remove" },
		{
			key: "stage-remove",
			label: "Remove from ticket",
			icon: "minus",
			command: run.remove,
			...refused(removalRefusal(count, lock)),
		},
	);
	return rows;
}
// #endregion
