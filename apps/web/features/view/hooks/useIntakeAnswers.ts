import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";
import { type Signal, useSignal } from "@preact/signals";
import {
	emptyIntakeAnswers,
	type IntakeAnswers,
	type IntakeField,
	type IntakeRefusal,
	IntakeRefusalCode,
	intakeRefusal,
} from "@projective/types/services";
import { focusFirstRefused } from "@web/features/profile/components/hire/IntakeFields.tsx";

/** What {@link useIntakeAnswers} hands a listing's booking modal. */
export interface IntakeAnswersState {
	answers: Signal<IntakeAnswers>;
	/** The refusal to paint, read per render: `null` until the first attempt (fields paint on touch, §A.7.5). */
	refusal: () => IntakeRefusal | null;
	/** Run the seller's rule before a commit; `false` paints the refusal and focuses its control. */
	check: () => boolean;
	/** Paint a refusal the server answered with (`errors["answers.<id>"]`); `true` when it named one. */
	fromServer: (message: string | undefined, errors: Record<string, string> | undefined) => boolean;
	/** Back to the seller's empty answers, nothing painted — a fresh opening of the modal. */
	reset: () => void;
}

/**
 * The listing's own intake questions inside a `/view` booking modal, held to the SAME rule the server
 * enforces (`intakeRefusal`): the profile's service modal asks them, and a modal that sent `{}`
 * instead was refused 422 on every listing with a required question.
 */
export function useIntakeAnswers(
	fields: readonly IntakeField[],
	rootRef: RefObject<HTMLElement>,
): IntakeAnswersState {
	const answers = useSignal<IntakeAnswers>(emptyIntakeAnswers(fields));
	const attempted = useSignal(false);
	const server = useSignal<IntakeRefusal | null>(null);
	const refusedAttempts = useSignal(0);

	useEffect(() => {
		if (refusedAttempts.value === 0) return;
		focusFirstRefused(rootRef.current);
	}, [refusedAttempts.value]);

	return {
		answers,
		refusal: () => (attempted.value ? intakeRefusal(fields, answers.value) ?? server.value : null),
		check: () => {
			attempted.value = true;
			server.value = null;
			if (intakeRefusal(fields, answers.value) === null) return true;
			refusedAttempts.value++;
			return false;
		},
		fromServer: (message, errors) => {
			const entry = Object.entries(errors ?? {}).find(([key]) => key.startsWith("answers."));
			if (!entry) return false;
			const code = IntakeRefusalCode.safeParse(entry[1]);
			attempted.value = true;
			server.value = {
				fieldId: entry[0].slice("answers.".length),
				code: code.success ? code.data : "wrong_shape",
				message: message ?? "Check this answer.",
			};
			refusedAttempts.value++;
			return true;
		},
		reset: () => {
			answers.value = emptyIntakeAnswers(fields);
			attempted.value = false;
			server.value = null;
		},
	};
}
