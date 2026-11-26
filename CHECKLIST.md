# Live Map: Nexus promises of 25.11.2026

**Wo wir stehen:** Test-Server läuft seit 26.11.2026 mit dem ExploreMode-Build und ExploreMode=1 (Log, /state und /near geprüft). Als Nächstes: Spieltest durch Oggi (Aufgabe 5, Schritt 4).

## Wartet auf dich

- Spieltest auf dem Test-Server: Karte schwarz bis auf Erkundetes, Truhe ab 50 m, Stadt nach Entdeckung, Suche nach unentdeckter Stadt leer

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
