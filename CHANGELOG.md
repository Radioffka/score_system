# Přehled změn

## 9.0.0

- denní, týdenní a měsíční cíle odvozené z explicitně způsobilých transakcí;
- restartově bezpečné a idempotentní uzávěry v lokální časové zóně Home Assistantu;
- denní výpočet sdíleného digitálního času pro následující den;
- konfigurovatelná týdenní odměna, která zůstává aktivní celý následující týden;
- měsíční kapesné s pásmy, lineárním růstem nad 100 % a maximálním limitem;
- responzivní přehled a serverově validované nastavení pro každý profil;
- rozšířená čtecí API a služba `bodik.read_periodic`;
- záloha formátu v2 a bezpečná migrace dat i záloh z verze 8.1.0;
- cílené testy migrace, catch-up uzávěr, DST, záporných hodnot, výplat a profilů.

## 8.1.0

- kompletní export nastavení, skóre a historie do čitelné JSON zálohy;
- bezpečný import zálohy s kontrolou formátu, oprávnění a revize dat;
- atomické obnovení profilů a synchronizace skóre do nastavených HA pomocníků;
- ovládání záloh přímo v záložce Nastavení.

## 8.0.6

- bezpečný autentizovaný WebSocket backend;
- transakční úložiště přes Home Assistant Store;
- oprávnění správců a zabezpečené zápisové služby;
- responzivní rozhraní pro počítač, tablet a telefon;
- profily, důvody, odměny, historie a XLSX export;
- příprava distribuce a aktualizací přes HACS.
