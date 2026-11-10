# Modal & Overlay Audit (2026-11-10)

> **Evaluation, not binding.** An inventory of every modal-behaving overlay in `apps/web/features/`
> and `packages/ui/`, each classified **KEEP AS MODAL**, **MIGRATE TO POPOVER** or **MIGRATE TO
> INLINE**, and checked against `DESIGN_SYSTEM.md` §B.8 (the Button Interaction Matrix), §B.10 (the
> overlay family) and Decision #305 (hints behind a "?"). What was changed, and every open question for
> the owner, is Decision #404 — this page is its evidence and does not restate its rulings.

## Method and headline

- **96 overlay instances** were read file by file.
- **Portal and stack: compliant everywhere.** Every package `Dialog` / `ConfirmDialog` / `Popover`
  portals through `BodyPortal` and claims `useOverlayStack`. So does every hand-rolled panel:
  `ProjectCreateModal`, `PreSubmitModal`, `SubmissionReviewModal`, `PreviewShell`, `LightboxDialog`,
  `TicketView`, `EventModal`, `AssetPicker`, `DriveBrowser`, `ShareDialog`, `InspectorSheet`. Two
  irregularities:
  - `MessageBody` wraps a `Dialog` in a second `BodyPortal`.
  - `BasketTicketModal`'s loading and failure fallbacks render in place.
- **Radius: token-only** (`--overlay-radius-lg` / `--overlay-radius-sm`). The one exception is the
  landing demo dialog, which uses the landing ramp (`--lp-r-lg`).
- **Width: mostly raw.** Only about a dozen overlays read `--overlay-w-*`; the rest pass raw rem or
  `min()` widths. That is a follow-up, not a defect of any one modal.
- **§B.8 tier violations: 10 confirmed, 9 fixed.** The claims were checked against the matrix's own
  worked examples. The checkout's Save details / Add-card actions, the wallet's Continue and Accept
  Submission are compliant by the doc's explicit rule.

`✅` changed in #404 · `◻` proposed, not done · blank = keep as is.

## Projects

| Overlay | Class | Finding | Resolution |
| :------ | :---- | :------ | :--------- |
| `ProjectCreateModal` (hand-rolled) | MODAL — multi-field initializer | Description beyond §Quick-Init's four fields; type as large cards; three reassurance notes; Create at tier 3 | ✅ Title · Type (`SelectButton`) · Currency · Baseline, hints behind "?", Create tier 2. Profile step cards and the Personal checkbox kept (#404 a, b) |
| `CreateStageModal` | POPOVER candidate (2 fields) | Workflow intro; Create at tier 3 | ✅ intro removed, tier 2 · ◻ popover |
| `CreateSubmissionModal` | MODAL (opened from several surfaces) | Workflow intro | ✅ intro removed |
| `MemberEditDialog` | POPOVER candidate (1 select) | — | ◻ popover |
| `PaidRevisionPayDialog` | MODAL — money | Pay from wallet at tier 3 | ✅ tier 1 |
| `ApproveStageDialog`, `FairExitDialog`, `BoardWarnings` (claimed move), `SessionDisputes`, `DisputeCaseDialog` | MODAL — escrow and settlement | Consequence copy is a disclosure; `ConfirmDialog` cannot draw tier 1 (#404 i) | |
| `ArchiveProjectDialog`, `RemoveMemberDialog`, `ProjectSetupRig` Publish / Archive | MODAL — destructive / irreversible | `ProjectSetupRig` copies Archive's text instead of reusing `ArchiveProjectDialog` | ◻ reuse |
| `BoardWarnings` reorder / revision | POPOVER candidate | Reversible, row-scoped | ◻ `ConfirmPopup` |
| `PreSubmitModal`, `SubmissionReviewModal`, `AttachmentPreviewModal` | MODAL — review workspaces | Hand-rolled buttons, outside the tier vocabulary | ◻ move to `Button` |
| `MemberPreviewModal` | POPOVER candidate (read-only peek) | Outlined Message is not tier-4 neutral | ◻ |
| `MessageBody` | MODAL — long text | Portalled twice | ◻ drop the outer `BodyPortal` |

## Checkout, payments, wallet

| Overlay | Class | Finding | Resolution |
| :------ | :---- | :------ | :--------- |
| `BuyNowModal` | MODAL — money | Pay was rounded but tier 3 | ✅ tier 1 |
| `NewListDialog` | POPOVER candidate (1 field) | Reassurance note; Create at tier 3 | ✅ note removed, tier 2 · ◻ popover |
| `RequestApprovalDialog` | POPOVER candidate (1 field, no money) | Intro sentence | ◻ owner review |
| `ConfirmPayDialog`, `FundStageDialog`, `CommitReview`, `WalletDialogs` move / add card | MODAL — money | Compliant (tier 1) | |
| `AddPaymentMethodModal`, `SaveDetailsModal` | MODAL / INLINE candidate | Tier 1 per §B.8's "every checkout commit"; long bank-transfer prose | ◻ trim the prose |
| `WalletDialogs` schedules (recurring, payout, smoother) | INLINE candidate | Settings held in a dialog | ◻ |
| `WalletDialogs` lock, transaction, spend request; `AnalyticsView` inspector | POPOVER candidates / MODAL (chart tool) | — | ◻ |
| `BasketTicketModal` | MODAL (reuses `TicketView`) | Fallback renders unportalled | ◻ |

## Catalogue, view, profile, invites, messaging

| Overlay | Class | Finding | Resolution |
| :------ | :---- | :------ | :--------- |
| `CatalogueCreateModal` | MODAL — initializer (5 fields) | A legend for an asterisk nothing draws; Create draft at tier 3 | ✅ legend removed, tier 2 |
| `AltTextDialog` | POPOVER candidate (1 field) | Cancel at tier 4 | ✅ tier 5 · ◻ popover |
| `ConflictDialog`, `ListingRemovalDialog` delete | MODAL — data loss | — | |
| `ListingRemovalDialog` archive, `MediaShowcaseSection` / `MediaSection` empty slot | POPOVER candidates (reversible) | — | ◻ `ConfirmPopup` |
| `ProjectApplyModal`, `QuoteRequestModal`, `ScopeBriefModal`, `SessionBookingModal` | MODAL — conversion | × only, no Cancel; reassurance lines ("Nothing is committed.") | ◻ owner review |
| `LightboxDialog`, `AvatarLightbox` | MODAL — media | Inline `z-index`; two lightboxes | ◻ reuse |
| `ProjectAssignModal`, `ServiceDetailModal`, `ConsultationModal` (split modals) | MODAL — initializers | Outlined secondaries are not tier-4 neutral | ◻ |
| `ConnectionsDialog`, `TabCreateButton` stub | POPOVER candidates | The stub's Close and Got it do the same thing | ◻ |
| `UniversalInviteModal` | MODAL — access list | Staged queue, note, footnotes, link panel with its own Copy | ✅ one invite row, Link access row, People with access, Copy link + Done footer (#405) |
| `NewConversationModal` | MODAL — multi-recipient | — | |

## Workspaces

| Overlay | Class | Finding | Resolution |
| :------ | :---- | :------ | :--------- |
| `CreateWorkspaceModal` | MODAL — initializer (name + handle) | Intro pitch, a "You can change this later." hint, legend and asterisks | ✅ all removed |
| `NewRoleModal` (new / edit) | MODAL | A computed intro and note (`roles-model.ts`, tested) | ◻ owner review |
| `ChannelCreateDialog` | POPOVER candidate (2 fields) | — | ◻ |
| `ChannelEditDialog` | MODAL (nested media crop) | Save is tier 2 by its own doc, against §B.8.1 | ◻ ruling (#404 g) |
| `OwnershipTransfer`, Leave / Remove member, Archive team / entity | MODAL — high impact | — | |
| Archive role / channel, Withdraw proposal | POPOVER candidates | — | ◻ `ConfirmPopup` |

## Files, inspector, share

| Overlay | Class | Finding | Resolution |
| :------ | :---- | :------ | :--------- |
| New folder (`FilesFooterRig`) | POPOVER | A dialog for a 2-field action; Create at tier 3 | ✅ anchored popover, tier 2 |
| Attach link (`FilesFooterRig`) | POPOVER | A dialog for 1 field; explanatory paragraph | ✅ anchored popover; the https rule behind "?" |
| `ConnectDriveDialog` | INLINE / POPOVER | "Separate permission" paragraph; dead-end empty states | ✅ sentence removed, empty states link to `/settings/integrations` (#405) · ◻ provider-picker popover (#404 e) |
| `FolderColorDialog`, `CollectionPicker` | POPOVER candidates | — | ◻ |
| `AssetPicker` | MODAL — media tool | Two fills while the link pane is open; "separate permission" copy | ✅ Save and choose tier 4, copy trimmed |
| `DriveBrowser` | — | Mounted nowhere | ◻ delete or mount |
| `ShareHost` / `ShareModalBody` | POPOVER where anchored | No anchor contract; note textarea; card rail | ✅ `ShareRequest.anchor`, popover from a standing button, dialog from a menu or a phone; note and rail removed (#405) |
| `ShareDialog` (files link terms) | MODAL | The link is a credential whose terms freeze once made | |
| Delete / Disconnect confirms, `IntegrationsConsole` disconnect | MODAL — destructive, consent | — | |
| `InspectorSheet`, `PdfPrintDialog` | Sheet / POPOVER candidate | The sheet sets `aria-modal="false"` over a scrim | ◻ |

## Calendar

| Overlay | Class | Finding | Resolution |
| :------ | :---- | :------ | :--------- |
| `CalendarExportPopover` (was `CalendarExportModal`) | POPOVER | A centred dialog for a rig action | ✅ anchored to its rig circle beside Import (#405) |
| `ConnectCalendarDialog` | INLINE candidate | "Separate permission" sentence; dead-end empty state | ✅ sentence removed (data-use disclosure kept), empty state links to `/settings/integrations` (#405) |
| `RoutineDialog` | INLINE per the brief | No named home | ◻ (#404 e) |
| `AvailabilityModal`, `EventModal` | MODAL — complex tools | `EventModal` may draw up to three fills (staged file) | ◻ |
| `CalendarImportPopover` | POPOVER (already) | — | |
| `CalendarWorkspace` delete confirm | POPOVER candidate | The message repeats the header | ◻ |

## Settings, shell and the rest

| Overlay | Class | Finding | Resolution |
| :------ | :---- | :------ | :--------- |
| `SettingsModalHost`, `HelpSearch`, `FeedbackBoard`, `SignInPrompt`, `RemovalDialog`, `OfflineBridge`, `FeatureDemoDialog` | MODAL | `SignInPrompt` draws two fills while SSO is open; `FeedbackBoard` intro; `OfflineBridge`'s outlined Stay | ◻ |
| `ShortcutSheet` | POPOVER candidate | — | ◻ |
| `ConfirmDialog`, `DynamicDialog`, `Dialog`, `Popover` (primitives) | — | `ConfirmDialog` has no `rounded` / `structural` pass-through | ◻ (#404 i) |
