# Bodík v9.1.1

Bodík je lokální rodinný bodovací systém integrovaný přímo do Home Assistantu.
Obsahuje profily dětí, důvody bodových změn, periodické nároky a historii.

## Architektura

- Data jsou uložena v privátním úložišti Home Assistantu pomocí `Store`.
- Panel komunikuje s backendem přes autentizované WebSocket příkazy.
- Zápis je povolen jen administrátorům Home Assistantu a uživatelům vybraným
  v nastavení Bodíku.
- Automatizace mohou používat služby `bodik.adjust_score` a `bodik.set_score`.
- Nakonfigurované důvody se bezpečně používají službou `bodik.apply_reason` podle
  stabilního ID; bodovou hodnotu a denní limity určuje backend.
- Pro čtení jsou dostupné služby `bodik.get_info`, `bodik.read_scores` a
  `bodik.read_periodic`.
- Periodický engine ukládá pouze nové způsobilé transakce a bezpečně dohání
  zmeškané uzávěry po startu Home Assistantu.
- Volitelný denní limit důvodu i Offline bodový strop používají lokální den
  Home Assistantu a jsou samostatné pro každý profil.
- Kategorie důvodů mají stabilní profilová ID; zobrazované názvy a pořadí lze
  měnit bez dopadu na backendové limity.
- Staré prahové odměny z v8 jsou archivované jako inertní migrační data a
  neovlivňují aktivní periodické nároky.
- Veřejný JSON, anonymní webhook ani shell command nejsou součástí verze 9.

## Instalace

V `configuration.yaml` stačí zapnout integraci:

```yaml
bodik: {}
```

Panel se registruje automaticky. Starší ruční `panel_custom` konfigurace je dál
kompatibilní přes `/bodik-panel/bodik-panel.js` a nemusí se při každém releasu
upravovat. Po aktualizaci přes HACS je nutný restart Home Assistant Core;
frontend se následně načte z adresáře obsahujícího verzi releasu, bez ručního
mazání cache.

## Zálohy a obnova

Před změnami zálohujte složku `custom_components/bodik` a standardní zálohou
Home Assistantu také jeho interní úložiště. Nesdílejte obsah `.storage`, protože
může obsahovat soukromá rodinná data a identifikátory uživatelů.
