# Amazon Mix Shop Live — independent phone app

Install URL: https://ebeb2014.github.io/amazon-mix-shop-mobile/live/

This PWA is hosted on the existing GitHub Pages site, with its own app identity, icons, session storage key and service-worker scope. The original mobile dashboard files remain unchanged. It does not require ChatGPT authentication.

Sign in using the existing store account's email and password. The account must be active in `ams_app_users` and have `pos.sell=allow`; the primary administrator already qualifies through the existing permission system. No new users, passwords or broader grants are created. Sessions refresh through the pinned Supabase SDK. The password is cleared after submission and is never stored by the app.

Orders and manual inventory are shared by store owner in `ams_live_state`, protected by RLS. Save RPCs validate the complete state and reject stale revisions so simultaneous phones cannot silently overwrite one another. Unknown users and anonymous requests cannot read or write the data. The stock catalog uses an authenticated, read-only RPC and the existing product RLS. No service key is shipped to the client.

The old Site database was checked before this migration and contained zero rows. No user order data was copied into this public repository. The old private Site remains available independently.

## Installation

- Android Chrome: menu → Add to Home screen / Install app.
- iPhone Safari: Share → Add to Home Screen; enable Open as Web App if offered.

The app requires internet for stock and saves. Only a generic offline page is cached. No native store listing or APK is required for the existing PWA installation method.

## Development and validation

`npm ci`, `npm run build`, `npm test` from this directory. The compiled `auth.js` is committed because GitHub Pages serves static files directly. Dependencies are pinned in `package.json` and `package-lock.json`.

The additive database migration is in `supabase/migrations/`. Apply it through the authenticated database management workflow. `tests/database.sql` verifies authorization, validation, optimistic concurrency and catalog mapping inside a transaction which rolls back all test writes. Existing stock quantities, receipts and fiscal procedures are not modified.

Online reservations and transfer of orders to the store PC's fiscal flow remain pending confirmation of the exact desktop version installed in the store. Confirming a manual order currently changes only manual inventory; the UI explains this limitation.
