# Amazon Mix Shop Live 4.0

Aplicație mobilă separată: https://ebeb2014.github.io/amazon-mix-shop-mobile/live/
Autentificare prin contul magazinului, fără cont ChatGPT. Instalare PWA din Chrome Android / Safari iPhone.

- Stoc real pe bucată, căutare EAN/cod/număr Live și scanare cameră (ZXing inclus local).
- Comandă cu mai multe produse, preț final pe bucată, transport, avans și rest.
- Rezervare atomică în `ams_products.reservation_code`; anularea eliberează numai rezervarea proprie.
- Adresa se poate completa ulterior; coletul nu se împachetează fără datele de livrare și nu se expediază înainte de fiscalizare.
- Fotografii private și stare pe fiecare unitate, număr Live unic, editări cu verificarea reviziei.
- Roluri manager/operator/packer/viewer/disabled, conturi separate prin funcția existentă de administrare, jurnal cu autor și oră.
- AWB introdus manual; integrarea API cu un curier necesită configurarea contractului. Comentariile TikTok nu sunt importate automat.
- Arhiva manuală anterioară este păstrată în `ams_live_state`, fără rezervări retroactive.

## Desktop

Modulul și pachetul Windows sunt dezvoltate în repository-ul privat `ebeb2014/amazon-mix-shop-desktop`, folder `desktop-live`, workflow `build-live-desktop.yml`. Se pornește de la arhiva V24.20 verificată SHA256, nu de la configurații sau date ale magazinului.

Preluare din Vânzări → Comenzi online, numai în bon gol. Snapshotul păstrează `live_order_id` pe fiecare unitate, inclusiv după restaurarea coșurilor. `checkout_prepare` transferă rezervarea către bon în aceeași tranzacție. `checkout_commit` folosește funcția fiscală atomică existentă și marchează comanda fiscalizată numai la BONOK=1. Răspunsurile necunoscute păstrează tentativa pentru reconciliere; nu se reemite bonul. Eșecul fiscal confirmat restabilește rezervarea Live.

Noua versiune PC cere conexiune înainte de emiterea bonurilor, pentru a respecta rezervările concurente de pe telefoane. Recuperarea vechilor bonuri offline este păstrată. Versiunile vechi instalate pe PC nu pot primi această protecție până la actualizare.

Transportul și avansul sunt afișate în comandă și notele preluării. Operatorul verifică documentele și încasările; nu sunt inventate linii fiscale sau deduceri automate.

## Validare

`npm ci && npm run build && npm test`

SQL: `tests/workflow.sql` și `tests/workflow-extra.sql` se execută tranzacțional, cu identitatea unui administrator existent și `SET LOCAL ROLE authenticated`; toate scrierile se anulează cu ROLLBACK. Acoperă rezervare, conflicte, anulare, transfer la POS, eșec fiscal, confirmare atomică, idempotentă, roluri, RLS, fotografii și date client.

`tests/qa-fixture.js` conține exclusiv date fictive. Este injectat numai de serverul local la `?qa=1`, niciodată de aplicația publicată. Ecranul la 390px a fost verificat, inclusiv salvarea unei comenzi cu 2 produse și total transport/avans. Testul cu aparatul fiscal fizic și camerele telefoanelor se face la magazin.

Serverul interzice scrierea directă în tabelele Live. RPC-ul public este SECURITY INVOKER; funcția privată verifică identitatea, magazinul, rolul și revizia înainte de orice modificare. Nicio cheie secretă nu este inclusă în client. Service worker-ul păstrează numai pagina generică de lipsă conexiune, fără date private.


## Live 5.0: team and delivery

New sections: Notifications, Live reports, reservations older than 24 hours, GLS.
Orders have exclusive self-assignment, per-unit internal-code packing verification,
and a revocable 7-day customer link. Customer links contain a random 256-bit token
in the URL fragment; only the SHA-256 digest is stored. Access closes at packing
or fiscal checkout. Full session reports aggregate server-side.

Push is opt-in per device and uses a separate VAPID identity stored in Vault.
A minute cron dispatches event deliveries with leases, retries and deduplication.
Stale reservations generate at most one event per order/day, never auto-cancel.
No real notification or shipment was sent during automated tests.

GLS requires the primary administrator to enter MyGLS email/password, contractual
client number and pickup address in Courier. Credentials are verified with
GetParcelList, then the SHA-512 password representation is encrypted in Vault.
Production labels require a fiscalized, scanned, packed order and an explicit
COD amount. One parcel per order. The order is never marked shipped automatically.
The PDF is in a private bucket, with download links valid for 120 seconds.
Unknown carrier results block another PrintLabels call; recovery searches the
exact ClientReference then reprints the same ParcelId. Rejected requests can be
corrected and restarted. Test labels never write a production AWB.

GLS live-account verification and a real label test remain pending until the
owner enters their credentials. Native iPhone push/camera/printing must be
checked on the actual devices.

Validation: npm test; rollback SQL workflow.sql, workflow-extra.sql,
team-workflow.sql, push-workflow.sql, gls-workflow.sql.
