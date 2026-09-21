# 🏆 Bodík pro Home Assistant

[![Release](https://img.shields.io/github/v/release/Radioffka/score_system)](https://github.com/Radioffka/score_system/releases)
[![HACS validation](https://github.com/Radioffka/score_system/actions/workflows/validate-and-release.yml/badge.svg)](https://github.com/Radioffka/score_system/actions/workflows/validate-and-release.yml)

Bodík je lokální rodinný bodovací systém pro Home Assistant. Obsahuje profily,
důvody bodových změn, periodické nároky, historii a responzivní panel pro telefon,
tablet i počítač.

Veškerá rodinná data zůstávají v privátním úložišti Home Assistantu. GitHub
repozitář obsahuje pouze zdrojový kód integrace.

## Funkce

- více samostatných profilů;
- přidávání, odebírání a přesné nastavení bodů;
- konfigurovatelné důvody a jejich profilové kategorie;
- stabilní ID důvodů, volitelné denní limity a serverově řízené použití;
- konfigurovatelný denní strop kladných Offline bodů;
- samostatné denní, týdenní a měsíční cíle pro každý profil;
- výpočet sdíleného digitálního času na následující den;
- konfigurovatelná týdenní odměna a měsíční kapesné;
- historie změn s exportem do XLSX;
- kompletní záloha a obnova nastavení i historie ve formátu JSON;
- oprávnění pro vybrané uživatele Home Assistantu;
- služby pro automatizace a MCP;
- responzivní světlý i tmavý vzhled;
- aktualizace prostřednictvím HACS a GitHub Releases.

## Instalace přes HACS

1. V HACS otevřete nabídku **Vlastní repozitáře**.
2. Přidejte `https://github.com/Radioffka/score_system` jako typ **Integrace**.
3. Vyhledejte **Bodík** a zvolte **Stáhnout**.
4. Do `configuration.yaml` přidejte:

```yaml
bodik: {}
```

5. Zkontrolujte konfiguraci a restartujte Home Assistant Core.

Bodík panel v postranní liště registruje automaticky. Stávající ruční
`panel_custom` konfigurace zůstává podporovaná a není nutné ji ihned měnit;
stabilní URL `/bodik-panel/bodik-panel.js` funguje jako kompatibilní zavaděč.
Pokud ji později odstraníte, panel převezme integrace bez změny jeho adresy
`/bodik`.

Pokud používáte Bodík i jako Lovelace kartu, přidejte v nastavení dashboardu
zdroj typu **JavaScript modul**:

```text
/bodik-panel/bodik-panel.js
```

Konfigurace karty:

```yaml
type: custom:bodik-panel
compact: true
```

Panel v postranní liště i karta `custom:bodik-panel` načítají tentýž lokálně
nainstalovaný JavaScript a pracují se stejnými daty backendu. Kód se nespouští
přímo z GitHubu: HACS stáhne konkrétní release do Home Assistantu.

## Záloha a obnova dat

Správce najde v záložce **Nastavení** sekci **Záloha a obnova**. Exportovaný
JSON obsahuje všechny profily, aktuální skóre, pravidla, důvody, kategorie,
oprávnění a historii. Import obsah kompletně nahradí až po výslovném potvrzení
a backend před uložením kontroluje jeho formát i oprávnění.

Záloha neobsahuje samotné soubory profilových fotografií ani definice
pomocníků `input_number`; ukládá pouze jejich odkazy a entity ID.

## Aktualizace

Každá publikovaná GitHub Release s vyšší verzí se v Home Assistantu zobrazí
jako aktualizace HACS. Po instalaci aktualizace je potřeba restartovat Home
Assistant Core a znovu načíst stránku. Každý release používá vlastní adresář
frontendových assetů (`/bodik-panel/<verze>/…`), takže běžná aktualizace
nevyžaduje ruční změnu URL ani mazání cache prohlížeče.

Vývojový postup:

1. upravit soubory v `custom_components/bodik/`;
2. zvýšit stejnou verzi v `manifest.json`, `const.py` a
   `frontend/bodik-panel.js`;
3. pracovat na samostatné větvi a otevřít pull request do `main`;
4. GitHub Actions spustí jednotkové testy a ověří HACS i hassfest;
5. po schválení a sloučení do `main` workflow vytvoří chybějící release;
6. HACS nabídne novou verzi v Home Assistantu.

## Dostupné služby

- `bodik.adjust_score` – přičte nebo odečte body;
- `bodik.apply_reason` – bezpečně použije nakonfigurovaný důvod podle jeho ID;
- `bodik.set_score` – nastaví přesný počet bodů;
- `bodik.get_info` – vrátí provozní informace;
- `bodik.read_scores` – vrátí aktuální stav profilů.
- `bodik.read_periodic` – vrátí aktuální periodický postup, nároky a uzavřené výsledky.

Zápisové služby respektují oprávnění správce Bodíku. Systémové automatizace
bez uživatelského kontextu zůstávají podporované.

## Datový model v9 a migrace

Dlouhodobé `score` a historie zůstávají zachované. Bodík v9 ke
každému profilu přidává `periodic_config` a `periodic`. Periodická část obsahuje
čas zahájení sledování, explicitně způsobilé transakce, kurzory rozehraných
období, neměnné uzavřené snapshoty, dnešní digitální nárok a aktivní týdenní
odměnu. Výpočty používají lokální časovou zónu Home Assistantu.

Při prvním spuštění nad daty v8 se uloží aktuální čas jako
`periodic_tracking_started_at`. Starší historie se zpětně nepřepočítává a první
neúplný den, týden a měsíc jsou označeny jako částečné a jejich výsledek se
nepoužije jako sankce. Výchozí dopady jsou záměrně neutrální (0 minut,
vypnutá týdenní odměna a 0 Kč), dokud správce nenastaví rodinné hodnoty.
`adjust_score` se do periodického výkonu započítá;
administrativní `set_score`, reset a technická synchronizace nikoliv.

Interní datové schéma v3 doplňuje stabilní ID, kategorii a volitelný denní
limit důvodů. Staré důvody dostanou při normalizaci ID, aniž by se změnil jejich
název, hodnota, historie nebo skóre. Rychlá tlačítka posílají backendu pouze ID;
bodovou hodnotu, denní četnost a Offline strop vždy kontroluje backend podle
lokálního dne Home Assistantu.

Schéma v4 přidává ke každému profilu samostatné definice kategorií se stabilním
ID, editovatelným názvem a pořadím. Kategorie `offline` si drží svůj sémantický
význam i po přejmenování. Starý v8 katalog prahových odměn je při migraci uložen
do skrytého `legacy_rewards` pouze pro datovou/rollback kompatibilitu; v aktivním
rozhraní ani ve výpočtech v9.1 se nepoužívá.

Při jednorázové migraci existujících profilů Tomášek a Kuba/Kubík se použije
dohodnutá rodinná konfigurace z issue #3: 30 bodů denně, 120–180 minut,
180 bodů týdně s páteční uzávěrou v 17:00, 780 bodů měsíčně, 200 Kč při 100 %,
strop 150 % a sada rodinných důvodů. Tyto hodnoty nejsou obecnými výchozími
hodnotami nových instalací ani nových profilů a po migraci zůstávají pro každý
profil samostatně editovatelné.

U cílených rodinných profilů nahrazuje katalog 44 důvodů původní aktivní seznam
v8. Staré názvy a hodnoty zůstávají beze změny v historických záznamech, ale
zastaralé vysokobodové důvody již po migraci nelze nově použít.

Pravidla „30 vs. 60 minut venku“ a „běžný vs. kompletní úklid“ platí pro jednu
konkrétní aktivitu, ale Bodík zatím neeviduje ID jednotlivých aktivit. Proto
nejsou automatizována jako složitý rules engine; rodič pro danou aktivitu použije
jen odpovídající důvod. Denní četnosti a celkový Offline strop backend vynucuje.

Záloha formátu v2 obsahuje konfiguraci i celý nutný stav period. Import nadále
přijímá v8 zálohy formátu v1 a zahájí pro ně nové periodické sledování bez
výroby historických bodů.

## Bezpečnost a data

- Bodík nepoužívá anonymní webhook ani veřejný JSON.
- Panel komunikuje přes autentizované WebSocket API Home Assistantu.
- Do repozitáře nepatří obsah `.storage`, historie, fotografie dětí, hesla,
  tokeny ani jiné soukromé údaje.

Chyby hlaste přes [GitHub Issues](https://github.com/Radioffka/score_system/issues).
