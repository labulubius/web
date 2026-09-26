# Forums (initial version)

`/forums` aggregates public Discourse topic lists from the allowlisted sources in `app/lib/forums.ts`. It is separate from the private `/news` FreshRSS database and its five-day retention policy. No forum posts are persisted locally; Next.js caches upstream JSON responses for roughly five minutes. Topics and replies are read on demand. When an upstream source is unavailable, the list shows the other sources and a warning. The discussion page displays replies in 20-post batches as escaped plain text, with links back to the original discussion for rich content and participation.

To add another Discourse forum, first confirm that it permits this use and that its `/latest.json` and `/t/<topic-id>.json` endpoints work, then add a fixed origin and name to `forumSources`. Other forum platforms need their own adapter; do not let user-supplied URLs reach server-side fetch. The list currently displays only the first page of each source's latest topics (up to roughly 30 per source), not a complete archive. OpenAI's source requests its open-topic filter; the other sources use their ordinary latest lists.

Manual checks: open `/forums`, filter by source, open a discussion with over 20 posts and select Next 20, follow an original-post link, verify unknown source or invalid topic IDs return 404. Source outages should not prevent other sources from loading.
