# marketplace: Tables

_Not yet documented._ This file is scaffolded to match the domain/kind structure described in
[../README.md](../README.md), but no Tables content has been written for the `marketplace` schema
yet.

See `brain2.md`'s Database section for the general migration-numbering and RLS conventions this
domain follows once populated.

## `marketplace.service_blueprints` — the public address

Documented ahead of the rest of the table because it is a routing contract shared with three other
schemas, not a detail of this one.

| Column | Type        | Notes                                                                |
| :----- | :---------- | :------------------------------------------------------------------- |
| `slug` | text UNIQUE | **The public address.** `svc-` + 10 symbols. Minted once, immutable. |

`NOT NULL` with no `DEFAULT`: `security.fn_slug_guard` (`00001890_triggers_slugs.sql`) fills it
before the `NOT NULL` is checked and refuses any UPDATE that would move it. The shape is
`^svc-[23456789abcdefghjkmnopqrstuvwxyz]{10}$` (`ck_service_blueprints_slug_shape`) — the same
alphabet and the same cross-checked contract as `projects.projects.slug`; see
[../projects/Tables.md](../projects/Tables.md) for the full reasoning.

It matters more here than anywhere else that the address is title-independent. A seller renames a
listing to reposition it — ordinary catalogue work, not a republication — and under a title-derived
address every card, share link and search result pointing at it would die on the edit, silently, at
exactly the moment the seller was trying to sell more of it.

## `marketplace.service_blueprints.intake_fields` — the seller's questions

| Column          | Type  | Notes                                                                                     |
| :-------------- | :---- | :---------------------------------------------------------------------------------------- |
| `intake_fields` | jsonb | NOT NULL `DEFAULT '[]'`. An ORDERED array of `IntakeField` documents. `CHECK` array, ≤ 12. |

The questions a buyer answers in the Service Detail modal on the way to purchase (Decision #108).
The element shape is owned by the Zod SSOT — `IntakeFieldSchema` in
`packages/types/services/intake.ts`: nine kinds (text · textarea · number, optionally with a slider ·
boolean · select · multiselect · radio · pills · checkboxes), each with an `id`, a `label`, a
`required` flag and kind-specific bounds/options — and it is validated by every fat service that
writes or reads it. The database refuses only what no reader could interpret at all: a non-array,
or more than `INTAKE_FIELDS_MAX` (12) elements (`ck_service_blueprints_intake_shape`).

A jsonb document rather than a child table for the same reason `session_template_rules` is one: the
seller authors the list as one unit, every reader takes it whole, and nothing queries across
listings by field. **Answers never live here.** They travel keyed by field id on the purchase
(`finance.basket_items.metadata` under `answers`) or on the invitation
(`projects.project_invitations.answers`), and the buyer-side services re-run `intakeRefusal`
against the list on the way in, so the modal's gate and the server's cannot drift.

The seller-side EDITOR for this column is the catalogue console (`ListingDetail.intake` /
`UpdateListingInput.intake`); see [`../../flows/ServiceCreation.md`](../../flows/ServiceCreation.md)
for what that surface must write.
