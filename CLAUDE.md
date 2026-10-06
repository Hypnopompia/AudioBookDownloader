# ListenSync

Electron app (plain HTML/CSS/JS, no build step) for free audiobooks, radio, music and podcasts,
synced to SD cards and MP3 players. The README covers features, layout and releasing; this file
holds the things that aren't obvious from the code.

## Writing for users

Most users aren't technical. UI text uses plain words: never mention GitHub, archive.org, APIs,
caches or file formats in settings, buttons or messages unless there's no other way to say it.

## Screenshots

- Published screenshots (`docs/screenshots`, the app page, README, release notes) must not show
  racist or offensive titles, artists or covers. Vintage Music (78 rpm records, 1900s–1950s) and
  Old Time Radio have songs and shows with slurs in their titles. Read every visible title before
  using a shot; if one is on screen, change the genre, sort or search instead of cropping.
- Take them with a separate profile (`LISTENSYNC_PROFILE`, see below) and a fake drive: a 512 MB
  FAT32 disk image named HEADPHONES
  (`hdiutil create -size 512m -fs "MS-DOS FAT32" -volname HEADPHONES -layout MBRSPUD x.dmg`).
  The app ignores disk images unless started with `SD_LOADER_ALLOW_DISK_IMAGES=1`.
- Match the existing images: 1600×1010, which is the app at 1280×808 at 1.25× scale, with
  scrollbars hidden. The app's CSP blocks `<style>` tags, so hide them from script with a
  constructed stylesheet (`document.adoptedStyleSheets`) and inline styles.

## Testing the app

- `npm test` runs the unit tests.
- `LISTENSYNC_PROFILE=<folder>` runs the app with separate settings, library and saved books, so
  your real ones aren't touched. Use it for any manual or automated testing.
- `LISTENSYNC_CATALOG_URL=<url>` points the app (and `scripts/build-catalog.js`) at another copy
  of the prebuilt lists, for example a local folder served over HTTP.
- Restart the app to see code changes; reloading the page doesn't reliably pick them up.

## Source lists

- Lists come from a weekly prebuilt catalog (`.github/workflows/catalog.yml`), falling back to
  archive.org. Bump `CACHE_VERSION` in `src/main/catalog.js` whenever a source's query or the
  cached item fields change; the file names include it, so older app versions keep their own.
- The `catalog` release is a pre-release and must never be marked latest: the updater and the
  download page use the latest release.

## Releasing

Bump the version (`npm version x.y.z --no-git-tag-version`), commit "Version x.y.z" with a short
list of changes, push, then `npm run release`.
