import type { JSX } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { Button, InputText } from "@projective/ui/fields";
import { useId } from "@projective/ui/hooks";
import { Icon } from "@projective/ui/icons";
import type { PasswordReason } from "../../../core/pdf-runtime.ts";

/** pdf.js asking for the document's password. */
export interface PdfPasswordRequest {
	reason: PasswordReason;
	submit(password: string): void;
}

/** Props for {@link PdfPasswordPrompt}. */
export interface PdfPasswordPromptProps {
	request: PdfPasswordRequest;
}

/** The inline form an encrypted PDF opens behind. The password goes only to the in-page PDF engine. */
export function PdfPasswordPrompt({ request }: PdfPasswordPromptProps): JSX.Element {
	const password = useSignal("");
	const inputId = useId(undefined, "ins-pdf-password");
	const titleId = useId(undefined, "ins-pdf-password-title");
	const errorId = useId(undefined, "ins-pdf-password-error");
	const incorrect = request.reason === "incorrect";

	useEffect(() => {
		password.value = "";
		const timer = setTimeout(() => {
			const input = document.getElementById(inputId);
			if (input instanceof HTMLInputElement && document.activeElement !== input) input.focus();
		}, 0);
		return () => clearTimeout(timer);
	}, [request, inputId]);

	const onSubmit = (event: JSX.TargetedSubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (password.value.length === 0) return;
		request.submit(password.value);
	};

	return (
		<div class="ins-pdf-lock">
			<form class="ins-pdf-lock__form" aria-labelledby={titleId} onSubmit={onSubmit}>
				<span class="ins-pdf-lock__glyph" aria-hidden="true">
					<Icon name="lock" size="lg" />
				</span>
				<h2 id={titleId} class="ins-pdf-lock__title">This PDF is password-protected</h2>
				<p class="ins-pdf-lock__lede">Enter its password to open it here.</p>
				<InputText
					id={inputId}
					type="password"
					value={password}
					block
					autoComplete="off"
					aria-label="PDF password"
					status={incorrect ? "invalid" : "default"}
					aria-describedby={incorrect ? errorId : undefined}
				/>
				{incorrect
					? (
						<p id={errorId} class="ins-pdf-lock__error" role="alert">
							That password didn't work. Try again.
						</p>
					)
					: null}
				<Button
					type="submit"
					size="md"
					variant="filled"
					label="Open"
					disabled={password.value.length === 0}
				/>
			</form>
		</div>
	);
}
