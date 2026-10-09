import type { JSX } from "preact";
import { useEffect } from "preact/hooks";
import { Button } from "@projective/ui/fields";
import { Icon } from "@projective/ui/icons";
import type { MediaPickState } from "../../hooks/use-media-pick.ts";

/**
 * SignInPictureSource — the picker's sign-in provider source: the picture the person's Google (or
 * other) account carries, previewed as-is, and one action that copies it into their library through
 * the server pipeline on Save & Apply. The browser only previews it; it never reads its bytes.
 */
export interface SignInPictureSourceProps {
	state: MediaPickState;
}

export function SignInPictureSource({ state }: SignInPictureSourceProps): JSX.Element {
	useEffect(() => {
		void state.loadSignIn();
	}, []);

	const source = state.signIn.value;
	const chosen = state.items.value.some((i) => i.candidate.origin.kind === "signin");

	if (!state.signInLoaded.value) {
		return (
			<div class="apk-state" role="status">
				<p class="apk-state__note">Reading your sign-in account…</p>
			</div>
		);
	}

	if (!source?.url) {
		return (
			<div class="apk-state" role="status">
				<p class="apk-state__title">No sign-in picture</p>
				<p class="apk-state__note">
					{source?.provider
						? `Your ${source.label} account has no picture we can use. Upload one from this device instead.`
						: "You signed in without a Google or other account, so there's no account picture to bring in. Upload one from this device instead."}
				</p>
				{state.error.value && <p class="pf-media__error" role="alert">{state.error.value}</p>}
			</div>
		);
	}

	return (
		<div class="pf-signin">
			<img
				class="pf-signin__img"
				src={source.url}
				alt={`Your ${source.label} picture`}
				referrerpolicy="no-referrer"
			/>
			<div class="pf-signin__text">
				<p class="pf-signin__title">Your {source.label} picture</p>
				<p class="pf-signin__note">
					It is copied into your library only when you save, then framed like any other picture.
				</p>
			</div>
			<Button
				size="sm"
				variant={chosen ? "outlined" : "filled"}
				icon={<Icon name={chosen ? "check" : "plus"} size="sm" />}
				aria-pressed={chosen ? "true" : "false"}
				onClick={() => void state.pickSignIn()}
			>
				{chosen ? "Chosen" : "Use this picture"}
			</Button>
			{state.error.value && <p class="pf-media__error" role="alert">{state.error.value}</p>}
		</div>
	);
}
