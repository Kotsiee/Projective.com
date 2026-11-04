-- =============================================================================================
-- Probe: event recurrence series and availability-preset slugs (Decision #375).
--
-- Rollback-safe: one transaction, ends in ROLLBACK, writes nothing. Run against a migrated, seeded
-- local DB:
--   docker exec -i supabase_db_Projective psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/probes/scheduling_event_recurrence.sql
--
-- A clean run prints only PASS notices; any failure raises `FAIL …` and aborts. It checks:
--    1. every seeded preset carries a minted `avp-` slug, and a slug cannot move;
--    2. an occurrence attaches to a master on the same schedule;
--    3. an occurrence is refused on another schedule, under a non-master, or with a rule of its own;
--    4. a master that still has occurrences cannot drop its rule or move schedule;
--    5. a row cannot name itself as its master (ck_event_recurrence_not_self);
--    6. the RRULE column takes only the stored shape (`FREQ=` first, at most 400 characters);
--    7. deleting a master cascades its occurrences.
-- =============================================================================================

BEGIN;

DO $$
DECLARE
    v_sched uuid;
    v_other uuid;
    v_master uuid;
    v_lone uuid;
    v_occ uuid;
    v_at timestamptz := date_trunc('hour', now()) + interval '60 days';
    v_msg text;
    v_constraint text;
BEGIN
    SELECT s.id INTO v_sched FROM scheduling.schedules s ORDER BY s.id LIMIT 1;
    SELECT s.id INTO v_other FROM scheduling.schedules s WHERE s.id <> v_sched ORDER BY s.id LIMIT 1;
    IF v_other IS NULL THEN
        RAISE EXCEPTION 'FAIL setup: the seed has fewer than two schedules';
    END IF;

    -- 1. Preset slugs.
    IF NOT EXISTS (SELECT 1 FROM scheduling.availability_presets) THEN
        RAISE EXCEPTION 'FAIL 1: the seed has no presets to check';
    END IF;
    IF EXISTS (
        SELECT 1 FROM scheduling.availability_presets p
         WHERE p.slug !~ '^avp-[23456789abcdefghjkmnopqrstuvwxyz]{10}$'
    ) THEN
        RAISE EXCEPTION 'FAIL 1: a seeded preset has no minted avp- slug';
    END IF;
    BEGIN
        UPDATE scheduling.availability_presets p SET slug = 'avp-2222222222'
         WHERE p.id = (SELECT q.id FROM scheduling.availability_presets q ORDER BY q.id LIMIT 1);
        RAISE EXCEPTION 'FAIL 1: a preset slug moved';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'PASS 1: presets carry a minted avp- slug that cannot move';
    END;

    -- 2. A master and an occurrence on one schedule.
    INSERT INTO scheduling.events (schedule_id, title, starts_at, ends_at, recurrence_rule)
    VALUES (v_sched, 'Probe series', v_at, v_at + interval '1 hour', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH')
    RETURNING id INTO v_master;
    INSERT INTO scheduling.events (schedule_id, title, starts_at, ends_at, recurrence_parent_id)
    VALUES (v_sched, 'Probe series', v_at + interval '2 days', v_at + interval '2 days 1 hour', v_master)
    RETURNING id INTO v_occ;
    RAISE NOTICE 'PASS 2: an occurrence attaches to its master';

    -- 3. Refused occurrences.
    BEGIN
        INSERT INTO scheduling.events (schedule_id, title, starts_at, ends_at, recurrence_parent_id)
        VALUES (v_other, 'Probe stray', v_at, v_at + interval '1 hour', v_master);
        RAISE EXCEPTION 'FAIL 3: an occurrence attached across schedules';
    EXCEPTION WHEN check_violation THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        IF v_msg NOT LIKE 'recurrence_parent_id:%' THEN RAISE EXCEPTION 'FAIL 3: wrong refusal (%)', v_msg; END IF;
    END;
    BEGIN
        INSERT INTO scheduling.events (schedule_id, title, starts_at, ends_at, recurrence_parent_id)
        VALUES (v_sched, 'Probe nested', v_at, v_at + interval '1 hour', v_occ);
        RAISE EXCEPTION 'FAIL 3: an occurrence attached under another occurrence';
    EXCEPTION WHEN check_violation THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        IF v_msg NOT LIKE 'recurrence_parent_id:%' THEN RAISE EXCEPTION 'FAIL 3: wrong refusal (%)', v_msg; END IF;
    END;
    BEGIN
        UPDATE scheduling.events e SET recurrence_rule = 'FREQ=DAILY' WHERE e.id = v_occ;
        RAISE EXCEPTION 'FAIL 3: an occurrence carried a rule of its own';
    EXCEPTION WHEN check_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint <> 'ck_event_recurrence_shape' THEN RAISE EXCEPTION 'FAIL 3: wrong refusal (%)', v_constraint; END IF;
    END;
    RAISE NOTICE 'PASS 3: stray, nested and self-ruled occurrences are refused';

    -- 4. A master with occurrences keeps its rule and its anchor.
    BEGIN
        UPDATE scheduling.events e SET recurrence_rule = NULL WHERE e.id = v_master;
        RAISE EXCEPTION 'FAIL 4: a master dropped its rule under its occurrences';
    EXCEPTION WHEN check_violation THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        IF v_msg NOT LIKE 'recurrence_rule:%' THEN RAISE EXCEPTION 'FAIL 4: wrong refusal (%)', v_msg; END IF;
    END;
    BEGIN
        UPDATE scheduling.events e SET schedule_id = v_other WHERE e.id = v_master;
        RAISE EXCEPTION 'FAIL 4: a master moved schedule under its occurrences';
    EXCEPTION WHEN check_violation THEN
        GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
        IF v_msg NOT LIKE 'recurrence_rule:%' THEN RAISE EXCEPTION 'FAIL 4: wrong refusal (%)', v_msg; END IF;
    END;
    RAISE NOTICE 'PASS 4: a master with occurrences keeps its rule and its schedule';

    -- 5. A master with no occurrences cannot become its own occurrence.
    INSERT INTO scheduling.events (schedule_id, title, starts_at, ends_at, recurrence_rule)
    VALUES (v_sched, 'Probe lone', v_at, v_at + interval '1 hour', 'FREQ=DAILY')
    RETURNING id INTO v_lone;
    BEGIN
        UPDATE scheduling.events e SET recurrence_rule = NULL, recurrence_parent_id = v_lone WHERE e.id = v_lone;
        RAISE EXCEPTION 'FAIL 5: a row named itself as its master';
    EXCEPTION WHEN check_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint <> 'ck_event_recurrence_not_self' THEN RAISE EXCEPTION 'FAIL 5: wrong refusal (%)', v_constraint; END IF;
    END;
    RAISE NOTICE 'PASS 5: a row cannot name itself';

    -- 6. The stored RRULE shape.
    BEGIN
        UPDATE scheduling.events e SET recurrence_rule = 'RRULE:FREQ=WEEKLY' WHERE e.id = v_lone;
        RAISE EXCEPTION 'FAIL 6: a raw RRULE: line was stored';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        UPDATE scheduling.events e SET recurrence_rule = 'FREQ=DAILY;X-PAD=' || repeat('A', 384) WHERE e.id = v_lone;
        RAISE EXCEPTION 'FAIL 6: a 401-character rule was stored';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    UPDATE scheduling.events e SET recurrence_rule = 'FREQ=DAILY;X-PAD=' || repeat('A', 383) WHERE e.id = v_lone;
    RAISE NOTICE 'PASS 6: the column takes the stored shape up to 400 characters, and nothing else';

    -- 7. Deleting a master cascades its occurrences.
    DELETE FROM scheduling.events e WHERE e.id = v_master;
    IF EXISTS (SELECT 1 FROM scheduling.events e WHERE e.id = v_occ) THEN
        RAISE EXCEPTION 'FAIL 7: an occurrence outlived its master';
    END IF;
    RAISE NOTICE 'PASS 7: deleting a master cascades its occurrences';
END;
$$;

ROLLBACK;
