import type {
	EngagementKind,
	ProjectCompleteBlocked,
	ProjectCompletePreview,
} from "../types/projects-types.ts";

/**
 * project-complete-model — the pure words behind the Complete and Reopen confirmations (EX1,
 * Decision #546): what a blocked engagement says and what completing closes. Every count arrives
 * from the server; nothing here decides whether the engagement may complete.
 */

/** The words the dialogs use for an engagement of this kind. */
export interface ProjectCompleteCopy {
	noun: "project" | "service";
	/** The lane and Overview label, and the Complete dialog's commit. */
	commit: string;
	header: string;
	/** The Reopen label and commit. */
	reopen: string;
	reopenHeader: string;
}

/** The dialogs' words for a brief or a bought service. */
export function projectCompleteCopy(kind: EngagementKind): ProjectCompleteCopy {
	const noun = kind === "service" ? "service" : "project";
	return {
		noun,
		commit: `Complete ${noun}`,
		header: `Complete this ${noun}?`,
		reopen: `Reopen ${noun}`,
		reopenHeader: `Reopen this ${noun}?`,
	};
}

/** Why the engagement cannot be completed now, in words for its client. */
export function projectCompleteBlockedText(
	blocked: ProjectCompleteBlocked,
	kind: EngagementKind = "project",
): string {
	const noun = kind === "service" ? "service" : "project";
	switch (blocked) {
		case "ended":
			return `This ${noun} has already ended.`;
		case "draft":
			return `This ${noun} has not started yet, so there is nothing to complete.`;
		case "sessions":
			return "A session engagement completes seat by seat as its sittings settle.";
		case "dispute":
			return `A dispute is open on money this ${noun} holds. Complete it once the ruling has settled that money.`;
		case "sittings":
			return `This ${noun} holds money for booked sittings, which settle sitting by sitting.`;
		case "settling":
			return "A stage is being paid out right now. Try again once that settles.";
		case "held":
			return `This ${noun} still holds escrow. Approve the stages holding it, or cancel the ${noun}, and it completes once the money settles.`;
	}
}

/** The meta line under the lede: what completing closes. */
export function projectCompleteConsequences(preview: ProjectCompletePreview): string[] {
	const lines: string[] = [];
	if (preview.ticketsToClose === 1) lines.push("1 unfunded ticket will be cancelled");
	else if (preview.ticketsToClose > 1) {
		lines.push(`${preview.ticketsToClose} unfunded tickets will be cancelled`);
	}
	if (preview.stagesToClose === 1) lines.push("1 open stage will close");
	else if (preview.stagesToClose > 1) lines.push(`${preview.stagesToClose} open stages will close`);
	lines.push("its reviews open");
	return lines;
}
