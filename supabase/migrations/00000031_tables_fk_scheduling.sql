-- =============================================================================================
-- 00000031_tables_fk_scheduling.sql — trailing FK closure (Category 0).
--
-- The permitted `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` (root CLAUDE.md §1), for the reason
-- the rule carves out: a genuine circular dependency. Two of them: the reschedule pair below, and the
-- blueprint ⇄ availability-preset pair at the end of the file.
--
--   scheduling.reschedule_proposals --reschedule_id--> scheduling.event_reschedules
--   scheduling.event_reschedules --resolved_proposal_id--> scheduling.reschedule_proposals
--
-- Each table references the other, so whichever is created second can carry its FK inline and the
-- first cannot. The proposals side is inline (00000022); this is the other half.
--
-- COMPOSITE, not a plain FK on resolved_proposal_id. A plain one would prove the winner is SOME
-- proposal; `(resolved_proposal_id, id) → (id, reschedule_id)` proves it is a proposal on THIS round,
-- which is the only thing "the slot that carried" can mean. It targets the
-- `uq_proposal_in_reschedule (id, reschedule_id)` key that already exists for the votes' own
-- composite FK. MATCH SIMPLE (the default), so an open round — winner NULL — is not checked at all.
--
-- No ON DELETE action: a winning proposal is part of the record of why an event is where it is, and
-- nothing in this schema hard-deletes it (root CLAUDE.md §5).
-- =============================================================================================

ALTER TABLE scheduling.event_reschedules
    ADD CONSTRAINT event_reschedules_resolved_proposal_fkey
    FOREIGN KEY (resolved_proposal_id, id)
    REFERENCES scheduling.reschedule_proposals (id, reschedule_id);

-- A blueprint's availability binding (Decision #217 (c)). The second genuine cycle:
--
--   scheduling.availability_presets --blueprint_id--> marketplace.service_blueprints
--   marketplace.service_blueprints --availability_preset_id--> scheduling.availability_presets
--
-- marketplace (00000014) is created before scheduling, so the preset side is inline (00000022) and
-- this is the other half. SET NULL: a binding to a preset that no longer exists means "use the
-- schedule's default", which is what NULL already says. That the bound preset belongs to the
-- blueprint owner's schedule (and, for a service fork, to this blueprint) is a cross-table rule an FK
-- cannot state; scheduling.trg_blueprint_preset_binding (00001510, trigger in 00001860) enforces it.
ALTER TABLE marketplace.service_blueprints
    ADD CONSTRAINT service_blueprints_availability_preset_fkey
    FOREIGN KEY (availability_preset_id)
    REFERENCES scheduling.availability_presets (id) ON DELETE SET NULL;
