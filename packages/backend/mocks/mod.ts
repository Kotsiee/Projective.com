/**
 * mod.ts — the single entry point to the consolidated mock corpus.
 *
 * ## Why the exports are NAMESPACED rather than flattened
 *
 * A flat `export *` over thirty-three fixture modules does not compile here, and the reason is worth
 * recording because it is the same reason the corpus needed consolidating at all: the modules were
 * written independently and reuse names. `MutationOutcome` is declared by both
 * `finance/basket-fixtures.ts` and `finance/wallet-fixtures.ts` with different shapes;
 * `messaging/workspace-fixtures.ts` and `workspace/workspace-fixtures.ts` share a filename;
 * `findMessagePage` exists in the projects corpus and `findConversationMessagePage` in the messaging
 * one. Namespacing keeps every symbol reachable without renaming a single export, so nothing that
 * imports a fixture module directly today has to change.
 *
 * ## Two ways to consume, both supported deliberately
 *
 *  1. **Directly**, as the fat services already do — `import { findProfile } from
 *     "../profile/profile-fixtures.ts"`. Unchanged, and still the right call inside a service that
 *     needs one dataset. This barrel does not deprecate it.
 *  2. **Through this module**, for anything that needs the corpus as a whole — a seed generator, a
 *     dev inspector, a fixture-vs-database differ, or the centralised mock provider in
 *     `core/data-source.ts`. Those callers want the set, not a member of it.
 *
 * ## Cost
 *
 * Importing this module pulls in every dataset, which is precisely what a caller wanting the whole
 * corpus is asking for and precisely what a caller wanting one dataset should avoid. That is why
 * {@link ./registry.ts} — the inventory — imports nothing: listing what exists must not cost what
 * loading it costs. Ask `registry.ts` what is there; ask this module for the data.
 *
 * The app-side mock modules (`shell/core/nav-fixtures.ts`, `marketing/core/landing-data.ts`) are
 * deliberately absent. They are listed in the registry but cannot be re-exported here, because they
 * live on island import paths and root CLAUDE.md §2 forbids an island reaching this package.
 */

// #region Inventory & shared asset builders
export * from "./assets.ts";
export * from "./registry.ts";
// #endregion

// #region Discovery
export * as exploreMocks from "../services/explore/fixtures.ts";
export * as exploreViewMocks from "../services/explore/view-fixtures.ts";
// #endregion

// #region Profiles
export * as profileMocks from "../services/profile/profile-fixtures.ts";
// #endregion

// #region Projects & workspace
export * as projectMocks from "../services/projects/fixtures.ts";
export * as projectDetailMocks from "../services/projects/detail-fixtures.ts";
export * as projectBoardMocks from "../services/projects/board-fixtures.ts";
export * as projectFileMocks from "../services/projects/files-fixtures.ts";
export * as projectMemberMocks from "../services/projects/members-fixtures.ts";
export * as projectMessageMocks from "../services/projects/messages-fixtures.ts";
export * as projectSubmissionMocks from "../services/projects/submissions-fixtures.ts";
export * as projectDraftStore from "../services/projects/draft-store.ts";
// #endregion

// #region Messaging
export * as conversationMocks from "../services/messaging/conversation-fixtures.ts";
export * as conversationMessageMocks from "../services/messaging/messages-fixtures.ts";
export * as messagingSettingsMocks from "../services/messaging/settings-fixtures.ts";
export * as conversationWorkspaceMocks from "../services/messaging/workspace-fixtures.ts";
// #endregion

// #region Catalogue
export * as catalogueMocks from "../services/catalogue/catalogue-fixtures.ts";
// #endregion

// #region Finance
export * as walletMocks from "../services/finance/wallet-fixtures.ts";
export * as basketMocks from "../services/finance/basket-fixtures.ts";
export * as cardMocks from "../services/finance/cards-fixtures.ts";
export * as orderMocks from "../services/finance/order-fixtures.ts";
export * as buyerMocks from "../services/finance/buyer-fixtures.ts";
export * as fxMocks from "../services/finance/fx-fixtures.ts";
// #endregion

// #region Teams & businesses
export * as workspaceMocks from "../services/workspace/workspace-fixtures.ts";
// #endregion

// #region Assets & connectors
export * as assetMocks from "../services/files/assets-fixtures.ts";
export * as quotaMocks from "../services/files/quota-fixtures.ts";
export * as shareMocks from "../services/files/share-fixtures.ts";
export * as connectionMocks from "../services/integrations/connections-fixtures.ts";
// #endregion

// #region Scheduling
export * as calendarMocks from "../services/scheduling/calendar-fixtures.ts";
export * as availabilityMocks from "../services/scheduling/availability-fixtures.ts";
export * as scheduleMocks from "../services/scheduling/schedule-fixtures.ts";
export * as personalScheduleMocks from "../services/scheduling/personal-fixtures.ts";
export * as coordinationMocks from "../services/scheduling/coordination-fixtures.ts";
export * as slotMocks from "../services/scheduling/slot-fixtures.ts";
// #endregion
