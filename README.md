# 🏆 Bodík pro Home Assistant

[![Release](https://img.shields.io/github/v/release/Radioffka/score_system)](https://github.com/Radioffka/score_system/releases)
[![HACS validation](https://github.com/Radioffka/score_system/actions/workflows/validate-and-release.yml/badge.svg)](https://github.com/Radioffka/score_system/actions/workflows/validate-and-release.yml)

Bodík je lokální rodinný bodovací systém pro Home Assistant. Obsahuje profily,
důvody bodových změn, odměny, historii a responzivní panel pro telefon, tablet
i počítač.

Veškerá rodinná data zůstávají v privátním úložišti Home Assistantu. GitHub
repozitář obsahuje pouze zdrojový kód integrace.

## Funkce

- více samostatných profilů;
- přidávání, odebírání a přesné nastavení bodů;
- konfigurovatelné důvody a odměny;
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

panel_custom:
  - name: bodik-panel
    url_path: bodik
    sidebar_title: Bodík
    sidebar_icon: mdi:trophy
    module_url: /bodik-panel/bodik-panel.js
    config: {}
```

5. Zkontrolujte konfiguraci a restartujte Home Assistant Core.

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
JSON obsahuje všechny profily, aktuální skóre, pravidla, důvody, odměny,
oprávnění a historii. Import obsah kompletně nahradí až po výslovném potvrzení
a backend před uložením kontroluje jeho formát i oprávnění.

Záloha neobsahuje samotné soubory profilových fotografií ani definice
pomocníků `input_number`; ukládá pouze jejich odkazy a entity ID.

## Aktualizace

Každá publikovaná GitHub Release s vyšší verzí se v Home Assistantu zobrazí
jako aktualizace HACS. Po instalaci aktualizace je potřeba restartovat Home
Assistant Core a znovu načíst stránku.

Vývojový postup:

1. upravit soubory v `custom_components/bodik/`;
2. zvýšit stejnou verzi v `manifest.json`, `const.py` a `bodik-panel.js`;
3. commitnout a pushnout změny do `main`;
4. GitHub Actions ověří HACS i hassfest a vytvoří chybějící release;
5. HACS nabídne novou verzi v Home Assistantu.

## Dostupné služby

- `bodik.adjust_score` – přičte nebo odečte body;
- `bodik.set_score` – nastaví přesný počet bodů;
- `bodik.get_info` – vrátí provozní informace;
- `bodik.read_scores` – vrátí aktuální stav profilů.

Zápisové služby respektují oprávnění správce Bodíku. Systémové automatizace
bez uživatelského kontextu zůstávají podporované.

## Bezpečnost a data

- Bodík nepoužívá anonymní webhook ani veřejný JSON.
- Panel komunikuje přes autentizované WebSocket API Home Assistantu.
- Do repozitáře nepatří obsah `.storage`, historie, fotografie dětí, hesla,
  tokeny ani jiné soukromé údaje.

Chyby hlaste přes [GitHub Issues](https://github.com/Radioffka/score_system/issues).
