-- Install on the FreshRSS PostgreSQL database as a role owning these tables.
-- Run with psql -X -v ON_ERROR_STOP=1 -f scripts/news-retention-install.sql
-- This installation intentionally refuses a nonempty entry table: receipt times
-- for pre-existing articles cannot be reconstructed from publication/lastSeen.
BEGIN;
SET LOCAL search_path = public, pg_catalog;
LOCK TABLE public.freshrss_labulubius_entry IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.freshrss_labulubius_feed IN SHARE ROW EXCLUSIVE MODE;
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.freshrss_labulubius_entry)
     AND (to_regclass('public.news_entry_receipt') IS NULL
          OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.freshrss_labulubius_entry'::regclass AND tgname = 'news_entry_stamp_trigger' AND NOT tgisinternal)) THEN
    RAISE EXCEPTION 'Entry table is not empty and retention is not installed; first receipt times are unknown';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.freshrss_labulubius_entry'::regclass AND attname = 'id_feed' AND atttypid = 'integer'::regtype AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.freshrss_labulubius_entry'::regclass AND attname = 'guid' AND atttypid IN ('text'::regtype, 'character varying'::regtype) AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Unexpected FreshRSS entry schema (expected integer id_feed and text/varchar guid)';
  END IF;
END $check$;

-- CTAS copies the exact ID type from the installed FreshRSS schema.
CREATE TABLE IF NOT EXISTS public.news_entry_receipt AS
  SELECT id AS entry_id, clock_timestamp() AS received_at
  FROM public.freshrss_labulubius_entry WHERE false;
-- CREATE TABLE IF NOT EXISTS ... AS SELECT does not run SELECT on reruns.
DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.freshrss_labulubius_entry e
             LEFT JOIN public.news_entry_receipt r ON r.entry_id = e.id
             WHERE r.entry_id IS NULL) THEN
    RAISE EXCEPTION 'An entry lacks a first-receipt timestamp; refusing to guess its age';
  END IF;
END $verify$;
DO $schema$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.news_entry_receipt'::regclass AND contype = 'p') THEN
    ALTER TABLE public.news_entry_receipt ADD CONSTRAINT news_entry_receipt_pk PRIMARY KEY (entry_id);
  END IF;
END $schema$;
ALTER TABLE public.news_entry_receipt ALTER COLUMN received_at SET NOT NULL;
-- Hash-only key: no article body, URL, or raw GUID retained after deletion.
CREATE TABLE IF NOT EXISTS public.news_entry_tombstone AS
  SELECT id AS id_feed, decode(md5(''), 'hex') AS guid_hash
  FROM public.freshrss_labulubius_feed WHERE false;
DO $schema$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.news_entry_tombstone'::regclass AND contype = 'p') THEN
    ALTER TABLE public.news_entry_tombstone ADD CONSTRAINT news_entry_tombstone_pk PRIMARY KEY (id_feed, guid_hash);
  END IF;
END $schema$;
ALTER TABLE public.news_entry_tombstone ALTER COLUMN id_feed SET NOT NULL;
ALTER TABLE public.news_entry_tombstone ALTER COLUMN guid_hash SET NOT NULL;
DO $hash$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.news_entry_tombstone'::regclass AND conname = 'news_entry_tombstone_hash_size') THEN
    ALTER TABLE public.news_entry_tombstone ADD CONSTRAINT news_entry_tombstone_hash_size CHECK (octet_length(guid_hash) = 16);
  END IF;
END $hash$;

-- Reconcile existing FreshRSS FKs (if any) instead of leaving a RESTRICT FK
-- that would block hard deletion. CASCADE also removes tags/receipts on feed deletion.
DO $fks$
DECLARE r record; fk record;
BEGIN
  FOR r IN
    SELECT child::regclass AS child, parent::regclass AS parent, col, name
    FROM (VALUES
      ('public.freshrss_labulubius_entry'::regclass, 'public.freshrss_labulubius_feed'::regclass, 'id_feed', 'news_entry_feed_fk'),
      ('public.freshrss_labulubius_entrytag'::regclass, 'public.freshrss_labulubius_entry'::regclass, 'id_entry', 'news_entrytag_entry_fk'),
      ('public.freshrss_labulubius_entrytag'::regclass, 'public.freshrss_labulubius_tag'::regclass, 'id_tag', 'news_entrytag_tag_fk'),
      ('public.news_entry_receipt'::regclass, 'public.freshrss_labulubius_entry'::regclass, 'entry_id', 'news_receipt_entry_fk'),
      ('public.news_entry_tombstone'::regclass, 'public.freshrss_labulubius_feed'::regclass, 'id_feed', 'news_tombstone_feed_fk')
    ) AS targets(child, parent, col, name)
  LOOP
    -- Replace non-cascading FreshRSS FKs in this transaction so hard deletes
    -- cannot be blocked by unread/starred entry tags or feed removal.
    FOR fk IN
      SELECT DISTINCT c.conname FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.conrelid = r.child AND c.contype = 'f' AND a.attname = r.col
        AND (c.confrelid <> r.parent OR c.confdeltype <> 'c' OR array_length(c.conkey, 1) <> 1)
    LOOP
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.child, fk.conname);
    END LOOP;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.conrelid = r.child AND c.contype = 'f' AND c.confrelid = r.parent
        AND c.confdeltype = 'c' AND array_length(c.conkey, 1) = 1 AND a.attname = r.col
    ) THEN
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s(id) ON DELETE CASCADE', r.child, r.name, r.col, r.parent);
      -- Receipt references entry(entry_id -> id); every other target also uses id.
    END IF;
  END LOOP;
END $fks$;

CREATE INDEX IF NOT EXISTS news_entry_receipt_time_idx ON public.news_entry_receipt (received_at);
CREATE OR REPLACE FUNCTION public.news_entry_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.guid IS NULL OR NEW.id_feed IS NULL THEN
    RAISE EXCEPTION 'News retention requires a GUID and feed ID';
  END IF;
  -- Serialize with hourly deletion for this feed, even if an import races it.
  PERFORM pg_advisory_xact_lock(750581, NEW.id_feed);
  IF EXISTS (SELECT 1 FROM public.news_entry_tombstone
             WHERE id_feed = NEW.id_feed AND guid_hash = decode(md5(NEW.guid), 'hex')) THEN
    RETURN NULL; -- discard previously expired GUID, do not resurrect it
  END IF;
  RETURN NEW;
END $fn$;
CREATE OR REPLACE FUNCTION public.news_entry_identity_immutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.guid IS DISTINCT FROM OLD.guid OR NEW.id_feed IS DISTINCT FROM OLD.id_feed THEN
    RAISE EXCEPTION 'News retention requires immutable entry GUID and feed ID';
  END IF;
  RETURN NEW;
END $fn$;
CREATE OR REPLACE FUNCTION public.news_entry_stamp() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO public.news_entry_receipt (entry_id, received_at)
  VALUES (NEW.id, clock_timestamp());
  RETURN NULL;
END $fn$;
DROP TRIGGER IF EXISTS news_entry_guard_trigger ON public.freshrss_labulubius_entry;
CREATE TRIGGER news_entry_guard_trigger BEFORE INSERT ON public.freshrss_labulubius_entry
  FOR EACH ROW EXECUTE FUNCTION public.news_entry_guard();
DROP TRIGGER IF EXISTS news_entry_identity_trigger ON public.freshrss_labulubius_entry;
CREATE TRIGGER news_entry_identity_trigger BEFORE UPDATE OF guid, id_feed ON public.freshrss_labulubius_entry
  FOR EACH ROW EXECUTE FUNCTION public.news_entry_identity_immutable();
DROP TRIGGER IF EXISTS news_entry_stamp_trigger ON public.freshrss_labulubius_entry;
CREATE TRIGGER news_entry_stamp_trigger AFTER INSERT ON public.freshrss_labulubius_entry
  FOR EACH ROW EXECUTE FUNCTION public.news_entry_stamp();
COMMIT;
