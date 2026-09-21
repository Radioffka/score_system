# Přehled změn

## 9.1.0

- odstranění starého v8 katalogu prahových odměn z aktivního rozhraní a výpočtů;
- nový přehled dnešního nároku, náhledu na zítřek, týdenní odměny a odhadu kapesného;
- profilové kategorie důvodů se stabilními ID, editovatelnými názvy a pořadím;
- přehlednější správa důvodů po kategoriích a vyhledávání bez ohledu na českou diakritiku;
- automaticky generovaný souhrn aktuálních pravidel z živé konfigurace;
- trvalé zvýraznění splněného denního cíle a krátká animace při jeho dosažení;
- idempotentní migrace schématu v4 zachovávající periodická data, skóre, historii a staré odměny ve skrytém `legacy_rewards`.

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
- stabilní ID důvodů a backendové použití bez důvěry v hodnotu z frontendu;
- volitelné denní limity důvodů a konfigurovatelný Offline strop;
- jednorázová rodinná konfigurace issue #3 pro stávající profily Tomášek a Kuba/Kubík,
  včetně nahrazení starého aktivního katalogu přesně 44 kanonickými důvody;
- testy denních limitů, neomezených a záporných důvodů, lokálního dne a týdenního DST.

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
