# Live Map: Nexus promises of 25.11.2026

**Wo wir stehen:** Aufgaben 1 bis 4 gebaut und geprüft auf Zweig feat/explore-mode (bis da1e17d, nicht gepusht). Als Nächstes: Spieltest auf dem Test-Server (Aufgabe 5).

## Wartet auf dich

- OK für den Neustart des Test-Servers mit ExploreMode=1 und Zeit für den Spieltest

## 1. Spoiler-Schalter (ExploreMode=1), Version 1.9.0

- [x] Entwurf besprochen (Seite sperrt, kleine Marker ab 50 m)
- [x] Spec geschrieben
- [x] Spec von Oggi abgenommen
- [x] Umsetzungsplan (docs/superpowers/plans/2026-11-25-explore-mode-plan.md)
- [x] Server: Store mit Radius, near.json, /near, nearVersion, Schalter in config
- [x] Test explored_test für 50 m
- [x] Seite: Nebel deckend, Marker, Namen, Suche, Item-Quellen
- [x] Seitencheck explore_check.mjs
- [ ] Spieltest auf dem Test-Server
- [ ] Release 1.9.0 (GitHub, Nexus nach OK) und Antwort an entrigant, unholyhakisak und GitHub-Issue #2
- [ ] Live-Server nach OK

## 2. Spieler in Dungeons am Eingang zeigen

- [ ] Entwurf
- [ ] Umsetzung und Test
- [ ] Antwort an Radianshot (Bug 1160538)

## 3. Kacheln mit Licht von oben links

- [ ] Ursache in render_map.py finden
- [ ] Kacheln neu rendern und vergleichen
- [ ] Antwort an entrigant (179900613)
