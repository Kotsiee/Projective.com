import type { JSX } from "preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import { Dialog, InlineNotice } from "@projective/ui/feedback";
import { Button } from "@projective/ui/fields";
import { useIsMobile } from "@projective/ui/hooks";
import type { SellerPromoCode } from "@projective/types/finance";
import { archivePromotion, promotions, promotionsBusy } from "../../core/promotions-store.ts";
import { consoleUrl, setConsoleUrl } from "../../core/console-store.ts";

/** The live code `?promo=archive:<CODE>` names, if any. */
function archiveTarget(promo: string | undefined): SellerPromoCode | undefined {
	if (!promo?.startsWith("archive:")) return undefined;
	const code = promo.slice("archive:".length);
	return promotions.value?.codes.find((c) => c.code === code && c.archivedAt === null);
}

/**
 * ArchivePromoDialog — the seller confirms archiving a live code, at `?promo=archive:<CODE>`. It says
 * what happens before the press: the code stops applying at once, past orders keep their discount, and
 * the code stays listed (nothing is deleted). An address naming no live code opens nothing. A bottom
 * sheet on a phone.
 */
export function ArchivePromoDialog(): JSX.Element {
	const mobile = useIsMobile();
	const visible = useSignal(false);
	const failure = useSignal<string | null>(null);
	const target = archiveTarget(consoleUrl.value.promo);

	useSignalEffect(() => {
		const want = !!archiveTarget(consoleUrl.value.promo);
		if (want && !visible.peek()) failure.value = null;
		visible.value = want;
	});

	const close = () => setConsoleUrl({ promo: undefined }, "replace");

	async function confirm(): Promise<void> {
		if (!target) return;
		const out = await archivePromotion(target.id);
		if (!out.ok) failure.value = out.message;
	}

	const used = target?.redemptionCount ?? 0;
	return (
		<Dialog
			visible={visible}
			role="alertdialog"
			position={mobile ? "bottom" : "center"}
			header={target ? `Archive ${target.code}?` : "Archive this code?"}
			width="min(30rem, calc(100vw - 2rem))"
			onVisibleChange={(v) => {
				if (!v && consoleUrl.peek().promo?.startsWith("archive:")) close();
			}}
			footer={
				<div class="cat-promo__actions">
					<Button
						label="Keep it"
						severity="neutral"
						variant="outlined"
						disabled={promotionsBusy.value}
						onClick={close}
					/>
					<Button
						label="Archive code"
						severity="danger"
						loading={promotionsBusy.value}
						disabled={promotionsBusy.value || !target}
						onClick={() => void confirm()}
					/>
				</div>
			}
		>
			{target && (
				<div class="cat-promo__form">
					{failure.value && <InlineNotice assertive align="start" text={failure.value} />}
					<p class="cat-promo__note">
						Buyers can't use it from now on. {used > 0 &&
							`The ${used} ${used === 1 ? "order" : "orders"} that used it keep the discount. `}
						It stays listed under Archived.
					</p>
					<p class="cat-promo__note">This can't be undone. You can issue a new code afterwards.</p>
				</div>
			)}
		</Dialog>
	);
}
