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
