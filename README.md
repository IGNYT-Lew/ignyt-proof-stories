# IGNYT proof stories

Posts one Google review as an Instagram Story on @ignyt_fitness every Tuesday, Thursday and Sunday at 16:00 UK time.

- `queue.json` is the schedule: date, style and quote for each story.
- `stories/` holds the rendered 1080x1920 images.
- `post-story.js` posts today's story. `--dry-run` builds it but does not publish.
- `posted.json` is the log of what has gone out.
- The Instagram token lives only in the `IG_TOKEN` repository secret. It is never in this repo.
