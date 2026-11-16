# ADR 0007 — Person photos: stored in the database, sanitized by the API, served by version

- Status: accepted
- Date: 2026-11-16
- Context: PRD #44 (person photos), reviewed with the owner on the prototype
  `prototype/person-photo` (fixture preview "Performance – Vorschau (Avatar-Entwurf)"). Code:
  `PersonPhotos`, `CleanJpeg`, `PersonPhotoActions`, `BodyLimit`, `DataRevision::writeIfChanged`,
  migration `0019_create_person_photos`. Rollout rules: [ADR 0006](0006-rollout-compatibility.md).

## Decisions

1. **Photos live in their own table, `person_photos`.** The person's id is the primary key and a
   foreign key to `persons` with `ON DELETE CASCADE`; the bytes are a `MEDIUMBLOB` with a named
   `CHECK` of at most 65 536 bytes; `version` is the lowercase hex SHA-256 of the stored bytes
   (`CHAR(64) ascii_bin`); `updated_at`. A person without a photo has no row. The table keeps the
   BLOB out of the row every list and scoreboard query reads, and "no photo" means no row instead
   of three nullable columns that must be null together.
   *Rejected:* columns on `persons` (see above); files beside the web root, which would serve
   without PHP but cannot share the data-revision transaction, have no cascade on person
   deletion, and need a runtime-config key, a deploy layout entry and a writable path in every
   test environment. **One-way door:** once migrated, the schema floor blocks a rollback below
   `0019`.
2. **Rollout (ADR 0006):** a new table with a `CHECK` no existing row can violate is
   expand-only, and every new response field is additive, so `MIN_CLIENT_VERSION` does not move.
   `RolloutCompatibilityTest` runs the previous release's person list, rename and delete against
   the new schema; its delete cascades the photo.
3. **The transport is JSON with base64.** `PUT /api/persons/{id}/photo` takes
   `{"image": "<base64 JPEG>"}`, like every request body of this API a JSON object, which also
   keeps HTML forms from posting to it. The overhead is about a third of at most 64 KiB.
   *Rejected:* a raw `image/jpeg` body (the first non-JSON body: a second body middleware and
   binary branches in the web client and the fixture backend) and multipart (form-postable).
   The photo is never a field of the person `PATCH`, whose "all fields" rule would make every
   rename resend it.
4. **Bounded before parsing.** `BodyLimit` refuses a photo body over 98 304 bytes (96 KiB) with
   413 `Foto zu groß.` before `JsonBody` parses it: by its `Content-Length`, and whatever that
   says by reading at most one byte past the limit. It runs after `SessionAuth`, so a request
   without a session is 401 first. An `image` longer than 87 384 characters (the base64 of
   65 536 bytes) is 422 before it is decoded; base64 must be strict and canonical (padded, no
   whitespace). Every other route keeps its body handling.
5. **The browser prepares; the server sanitizes and validates.** The browser crops, scales and
   re-encodes to a 256 × 256 JPEG of at most 64 KiB, so normal uploads are small and clean. Any
   signed-in client can call the API directly, so `CleanJpeg` walks the marker segments and
   rewrites the file keeping only SOI, DQT, DHT, DRI, one SOF0/SOF1/SOF2, SOS with its scan data,
   and EOI. Every APPn (EXIF, XMP, ICC, JFIF, Adobe …) and COM segment is dropped; any other
   marker, a truncated segment, a missing EOI, trailing bytes, a frame that is not 256 × 256 or a
   component count other than 1 or 3 is 422 on `image`. The stored bytes, and the version hashed
   from them, are the rewritten file, so no stored photo carries metadata, whichever client
   uploaded it. The walk proves structure, not that every scan decodes; any member can replace a
   photo that looks broken. `getimagesizefromstring` is not used as validation.
   *Rejected:* re-encoding on the server with GD or Imagick (the host probe never checked for
   either, the CI, e2e and PHPUnit images would need them, memory limits are unprobed; a later
   probe that finds GD makes it a compatible follow-up); trusting the client's re-encoding, which
   a direct API call bypasses.
6. **A photo is served by its version only.** The person, the person list and the scoreboard rows
   carry a server-built `photoUrl` (`<basePath>/api/persons/{id}/photo?v=<version>`, or null),
   read through a `LEFT JOIN` of the version, never the bytes. `GET …/photo?v=` reads version and
   bytes in one statement and answers 200 `image/jpeg` only when `v` is the stored version;
   missing, malformed or stale `v`, no photo and an unknown person are 404. No URL can return
   another version's bytes, and re-uploading an earlier photo makes its old URL valid again with
   exactly those bytes. There is no unversioned photo URL, and the client never composes one.
7. **The API's first cache exception.** The matching photo `GET` answers
   `Cache-Control: private, max-age=31536000, immutable`; the outermost middleware keeps
   `no-store` as the default for every other answer, every photo error included, but no longer
   overwrites a header an action set. It is also the first API response loaded outside the
   single fetch wrapper (through `<img>`). An `<img>` request sends the session cookie but no
   `X-Client-Version`, so it would count as the last client without the header (0.1.0) and be
   refused once `MIN_CLIENT_VERSION` rises past 0.1.0. So `ClientVersionGate` lets a `GET` on
   exactly `<basePath>/api/persons/{id}/photo` through without a version check, as it does
   health: the route only reads a version-addressed photo, so no client can be too old for it.
   Its other methods stay gated.
   *Rejected (owner decision):* sending only a version and painting bytes fetched by the fetch
   wrapper into canvases, which also uses the HTTP cache, but the CSP blocks `blob:` images, so
   it needs a canvas per avatar, DPR handling and its own failure states.
8. **Downloaded copies outlive their data (accepted).** A cache hit does not reach the API, so a
   copy a browser downloaded stays in that browser's cache after sign-out, session revocation,
   replacement or person deletion until the browser evicts it. `private` keeps it out of shared
   caches; it is not scoped to an account or purged on sign-out. The app stops showing a copy as
   soon as its data names another version or none. A running app keeps showing cached photos when
   the connection drops (best effort); reopening the installed app offline is not promised.
9. **CSP and Permissions-Policy stay as they are.** The crop preview is a canvas, so no `blob:`
   or `data:` image source is needed; choosing a photo is a plain `<input type="file">`, so
   `camera=()` stays. The preview's `data:` uploads exist only on the artifact host.
10. **Writes lock person, then photo, and only real changes bump.** Setting and removing run in
    the data-revision transaction: the person row `FOR UPDATE` (404 when it is gone), then its
    photo row, each in its own statement so the order never depends on how a join is executed.
    Person rename and deletion take the same order (`PersonPhotos::lockedPerson`). The version
    comparison, the change, the audit event and the bump decision happen in that transaction,
    under the existing whole-transaction deadlock retry. `DataRevision::writeIfChanged` commits a
    change that reports no change, releasing its locks, without a bump: the same version again,
    or removing a photo that is not there, bumps nothing and records nothing. The data revision
    now counts "writes that change what the scoreboard sends".
    *Rejected:* a locking join of person and photo (its lock order is the optimizer's), and
    bumping unconditionally (an identical re-upload would make every phone reload the
    Rangliste).
11. **Every person event's snapshot is `{name, photo}`** (owner decision, PRD #14): photo set,
    replace and remove are person `update` events by the acting account; creates record
    `photo: null`, renames carry the unchanged version, deletions the version they deleted, all
    read under the write's locks. `photo` is the version or null. Events recorded before, or by
    the previous release during a rollout, lack the key, which keeps meaning unknown. The
    Protokoll names photo changes (`Foto gesetzt`, `Foto geändert`, `Foto entfernt`), never the
    hash. Members never see who set a photo: the photo row has no uploader.
    *Rejected:* a photo subject kind of its own, which would split one person's history in the
    Protokoll and need a new enum value on the audit event.

## Consequences

- Until it reloads, the previous web client's Protokoll (admins only, read-only) shows a photo
  change as a person change without a listed value: growth that shows less well (ADR 0006,
  "A new value …"), not a break.
- Photo bytes are part of the database and its backups: at most 64 KiB per person.
- A photo write locks the person row, so it waits for, and makes wait, renames and deletions of
  the same person. For a person without a photo, its `FOR UPDATE` read of the missing photo row
  takes a gap lock on `person_photos` (REPEATABLE READ), not a row lock. Gap locks do not block
  each other but block inserts into the gap, so first uploads of different persons whose ids
  fall into the same gap can deadlock, and renames or deletions of a person without a photo can
  make another person's first upload wait. InnoDB rolls one deadlocked write back and the
  whole-transaction retry (`DataRevision::ATTEMPTS`) runs it again; only a pile-up of more
  concurrent first uploads than retries would fail one with 500.
