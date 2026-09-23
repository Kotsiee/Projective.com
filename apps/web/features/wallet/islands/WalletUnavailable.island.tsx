import type { JSX } from "preact";
import "../styles/wallet.css";
import { Alert } from "@projective/ui/feedback";
import { Band, PageHead } from "../components/band-parts.tsx";

/**
 * WalletUnavailable — the page body when the wallet itself could not be read.
 *
 * A read that fails must say so rather than paint a wallet: an empty balance drawn as £0.00 is a
 * statement about someone's money, and a false one. Nothing below this notice would be true, so the
 * page renders only the notice and a way to ask again. Reloading is the right retry here — unlike a
 * band-scoped failure there is no place in a ledger to lose.
 *
 * An island only so the wallet stylesheet reaches the page: on a failed read no other wallet island
 * mounts to carry it, and an unstyled failure reads as a second failure.
 */
export interface WalletUnavailableProps {
	title: string;
	message: string;
}

export default function WalletUnavailable(props: WalletUnavailableProps): JSX.Element {
	return (
		<main class="wlt" aria-label={props.title}>
			<div class="wlt__stack">
				<Band tone="head" index={0} label={props.title}>
					<PageHead title={props.title} />
				</Band>
				<div class="wlt-errorband" role="alert">
					<div class="wlt-error">
						<Alert severity="danger" class="wlt-error__alert">{props.message}</Alert>
						<button
							type="button"
							class="wlt-error__retry"
							onClick={() => globalThis.location?.reload()}
						>
							Try again
						</button>
					</div>
				</div>
			</div>
		</main>
	);
}
