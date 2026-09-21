# Bodík v8

Bodík je lokální rodinný bodovací systém integrovaný přímo do Home Assistantu.
Obsahuje profily dětí, důvody bodových změn, odměny a historii.

## Architektura

- Data jsou uložena v privátním úložišti Home Assistantu pomocí `Store`.
- Panel komunikuje s backendem přes autentizované WebSocket příkazy.
- Zápis je povolen jen administrátorům Home Assistantu a uživatelům vybraným
  v nastavení Bodíku.
- Automatizace mohou používat služby `bodik.adjust_score` a `bodik.set_score`.
- Pro čtení jsou dostupné služby `bodik.get_info` a `bodik.read_scores`.
- Veřejný JSON, anonymní webhook ani shell command nejsou součástí verze 8.

## Instalace

V `configuration.yaml` musí být integrace a vlastní panel:

```yaml
bodik: {}

panel_custom:
  - name: bodik-panel
    url_path: bodik
    sidebar_title: Bodík
    sidebar_icon: mdi:trophy
    module_url: /bodik-panel/bodik-panel.js?v=8.0.6
    config: {}
```

Po změně Pythonu, manifestu nebo `panel_custom` je nutný restart Home Assistant
Core. Po změně pouze dashboardového zdroje obvykle stačí znovu načíst stránku.

## Zálohy a obnova

Před změnami zálohujte složku `custom_components/bodik` a standardní zálohou
Home Assistantu také jeho interní úložiště. Nesdílejte obsah `.storage`, protože
může obsahovat soukromá rodinná data a identifikátory uživatelů.
