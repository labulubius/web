-- Run hourly with psql -X -v ON_ERROR_STOP=1 -f this-file.
-- All expired articles (including unread/starred) and their entry tags are
-- deleted atomically with the anti-reimport hashes, based on publication time.
BEGIN;
SET LOCAL search_path = public, pg_catalog;
DO $cleanup$
DECLARE f record; cutoff timestamptz := clock_timestamp() - interval '5 days';
BEGIN
  -- Same feed-scoped lock as the insert trigger; deterministic order avoids
  -- import/cleanup races, including imports starting while this run commits.
  FOR f IN SELECT id FROM public.freshrss_labulubius_feed ORDER BY id LOOP
    PERFORM pg_advisory_xact_lock(750581, f.id);
  END LOOP;
  INSERT INTO public.news_entry_tombstone (id_feed, guid_hash)
    SELECT DISTINCT e.id_feed, decode(md5(e.guid), 'hex')
    FROM public.freshrss_labulubius_entry e
    WHERE e.date <= extract(epoch FROM cutoff)::bigint
    ON CONFLICT (id_feed, guid_hash) DO NOTHING;
  DELETE FROM public.freshrss_labulubius_entry e
    WHERE e.date <= extract(epoch FROM cutoff)::bigint;
  -- FK cascades remove entrytag and receipt; feed deletion cascades tombstones.
END $cleanup$;
COMMIT;
