# Comenzi online integrate — implementare

Scop: rezervări reale pe fiecare bucată, comenzi multiple, preluare fiscală pe PC, mod Live cu scanner, colet/AWB manual, roluri/jurnal, fotografii și stare.

Rezervarea folosește ams_products.reservation_code. Mobilul nu marchează produse vândute. POS transferă atomic rezervarea către bon; confirmarea fiscală și vânzarea rămân în tranzacția existentă. Comenzile online nu se emit offline. Returul fizic/fiscal se procesează la casă, nu printr-un buton de expediere.

Transportul și avansul sunt evidențiate separat; nu sunt inventate linii fiscale sau încasări. AWB se introduce de operator, fără integrare cu un curier neconfigurat. Datele manuale anterioare rămân în ams_live_state.

Sursa desktop verificată: release v1.6.15 / V24.20, SHA256 arhivă 2e254228a140a4f20cecc892ae116966954434de555781d2499ada10289a9482. Instalarea efectivă pe PC și testul Datecs necesită calculatorul magazinului.
