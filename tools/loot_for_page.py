"""Turns the loot model (tools/build_drops.py: drops.json + placements.json) into web/loot.json, what
the map's search needs to answer "where do I get item X?".

    python tools/loot_for_page.py <drops.json> <placements.json> [--pois web/pois.json] [--out web/loot.json]

Sources with the same name on the map (template variants such as "_hook_Pt_E" or several sarcophagus
templates) become one group; its chance is the placement-weighted mean of its templates' chances. A
group keeps its places when it has at most MAX_PLACES of them (chests, enemies, rare plants); more
common ones (twigs, thyme) only say in which regions they are. Enemies are named like on the map:
boss names from pois.json creatureNames, else the creature kind from the template name.

loot.json: {"regions": [...], "groups": [[name, kind, places, regionBits, [x, z, x, z, ...] | null]],
            "items": [[itemId, name, [[group, chance], ...]]]}  (chance 0..1, best sources first)
"""
import argparse
import gzip
import json
import math
import re
import sys

MAX_PLACES = 2000
MAX_SOURCES = 10

# Creature kinds by template name, in the same order as the page (web/index.html CREATURE_KINDS).
CREATURE_KINDS = [(r"willowisp", "Will-o'-wisp"), (r"icewisp", "Ice wisp"), (r"hound", "Hound"), (r"wolf", "Wolf"),
                  (r"sabertooth", "Sabertooth"), (r"boar", "Boar"), (r"(^|_)rat(_|$)", "Rat"), (r"(^|_)bat(_|$)", "Bat"),
                  (r"wasp", "Wasp"), (r"bunny", "Bunny"), (r"catdeer", "Catdeer"), (r"yak", "Yak"), (r"goat", "Goat"),
                  (r"sanddigger", "Sanddigger"), (r"vulture", "Vulture"), (r"spider", "Spider"), (r"critterqueen|critter_queen", "Fell Critter Queen"),
                  (r"critter", "Critter"), (r"slime", "Slime"), (r"tentacle", "Tentacle"), (r"spitter", "Spitter"),
                  (r"cyclops", "Cyclops"), (r"vukah", "Vukah"), (r"skeleton", "Skeleton"), (r"lizardpeople|drak", "Drak"),
                  (r"scavenger", "Scavenger"), (r"fogger", "Fell"), (r"ancientconstruct", "Ancient construct"), (r"fish", "Fish")]
ROLES = ["heavy", "mage", "ranger", "archer", "crossbow", "spear", "melee", "shielded", "berserker", "caster", "weakling",
         "elite", "monstrosity", "tyrant", "matron", "brute", "hunter", "shaman"]


# Without a known kind: the first word that is not a family, tier or variant word
# (Animal_Wildlife_Cat_01_black_AG2 -> "Cat", Enemy_Wildbeast_GiantCrab_Combat -> "Giant Crab").
KIND_NOISE = {"enemy", "animal", "wildlife", "wildbeast", "spawnpoint", "spawnpoints", "poi", "signalreceiver", "spawninbox",
              "boss", "fog", "hook", "neutral", "hover", "combat", "summonstone"}


def fallback_kind(tpl):
    words = [w for w in tpl.split("_") if w.lower() not in KIND_NOISE and not re.fullmatch(r"t\d+|\d+|[a-z]|sm|xl|ag\d", w, re.I)]
    return re.sub(r"([a-z])([A-Z])", r"\1 \2", words[0]) if words else tpl


def enemy_name(tpl, boss_names):
    if tpl in boss_names:
        return boss_names[tpl]
    for suffix in ("_BossHealthBar", "_bossHealthbar", "_bossHealtBar", "_healthbar"):
        if tpl + suffix in boss_names:
            return boss_names[tpl + suffix]
    low = tpl.lower()
    kind = next((name for pat, name in CREATURE_KINDS if re.search(pat, low)), None)
    if kind is None:
        kind = fallback_kind(tpl)
    roles = [r for r in ROLES if r in low and r not in kind.lower()]
    return kind + (" (" + ", ".join(roles[:2]) + ")" if roles else "")


# Variant words of prop and scatter names: "Scatter Loot Desert Bush Abal Twigs b below" and its
# siblings a, c, d ... become "Desert Bush Abal Twigs".
NOISE_WORDS = {"scatter", "loot", "lootpickup", "pickup", "prop", "base", "below", "above", "free", "wall", "ground", "group",
               "range", "on", "off", "big", "small", "medium", "large"}


def plain_name(name):
    words = [w for w in re.split(r"[\s_]+", name) if w]
    keep = [w for w in words if w.lower() not in NOISE_WORDS and not re.fullmatch(r"[a-zA-Z]|\d+[a-z]?|t\d(-t\d)?|\d+m|ag\d", w, re.I)]
    return " ".join(keep) or name


def group_name(src, boss_names):
    if src["kind"] == "enemy" and src.get("template"):
        return enemy_name(src["template"], boss_names)
    name = re.sub(r"\s+", " ", src.get("name") or src.get("template") or "?").strip()
    return plain_name(name) if src["kind"] in ("node", "container") else name


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("drops")
    ap.add_argument("placements")
    ap.add_argument("--pois", default="web/pois.json")
    ap.add_argument("--out", default="web/loot.json")
    a = ap.parse_args()
    drops = json.load(open(a.drops, encoding="utf-8"))
    places = json.load(open(a.placements, encoding="utf-8"))
    pois = json.load(open(a.pois, encoding="utf-8"))
    regions = pois.get("regions") or []
    boss_names = pois.get("creatureNames") or {}

    def region_of(x, z):
        best, bd = 0, math.inf
        for i, (_, rx, rz) in enumerate(regions):
            d = (rx - x) ** 2 + (rz - z) ** 2
            if d < bd:
                best, bd = i, d
        return best

    def placements_of(src):
        # Quest and collectible spots have no template, only their one position.
        if not src.get("template"):
            return [[p[0], p[-1]] for p in src.get("samplePositions") or []]
        for key in (src["kind"] + ":" + src["template"], src["template"]):
            if key in places:
                return places[key]
        return []

    groups, group_index = [], {}
    items_out = []
    for item_id, item in drops["items"].items():
        by_group = {}
        for src in item.get("sources") or []:
            name = group_name(src, boss_names)
            key = (name, src["kind"])
            g = group_index.get(key)
            if g is None:
                g = group_index[key] = len(groups)
                groups.append({"name": name, "kind": src["kind"], "templates": set(), "points": set()})
            tkey = src.get("template") or repr(src.get("samplePositions"))
            if tkey not in groups[g]["templates"]:
                groups[g]["templates"].add(tkey)
                for p in placements_of(src):
                    groups[g]["points"].add((round(p[0]), round(p[-1])))
            n = max(1, src.get("placements") or 1)
            acc = by_group.setdefault(g, [0.0, 0])
            acc[0] += (src.get("chance") or 0) * n
            acc[1] += n
        if not by_group:
            continue
        ranked = sorted(((g, s / n) for g, (s, n) in by_group.items()), key=lambda t: -t[1])[:MAX_SOURCES]
        items_out.append([int(item_id), item["name"], [[g, round(c, 5)] for g, c in ranked]])

    groups_out = []
    for g in groups:
        pts = sorted(g["points"])
        bits = 0
        for x, z in pts:
            bits |= 1 << region_of(x, z)
        # Plants, twigs and other scatter loot lie everywhere in their regions: no places for them.
        flat = [v for p in pts for v in p] if 0 < len(pts) <= MAX_PLACES and g["kind"] != "node" else None
        groups_out.append([g["name"], g["kind"], len(pts), bits, flat])
    items_out.sort(key=lambda t: t[1])
    out = {"regions": [r[0] for r in regions], "groups": groups_out, "items": items_out}
    text = json.dumps(out, separators=(",", ":"), ensure_ascii=False)
    open(a.out, "w", encoding="utf-8").write(text)
    raw = text.encode("utf-8")
    open(a.out + ".gz", "wb").write(gzip.compress(raw, 9, mtime=0))
    with_places = sum(1 for g in groups_out if g[4])
    print(f"{len(items_out)} items, {len(groups_out)} source groups ({with_places} with places), "
          f"{len(raw) // 1024} KB, {len(gzip.compress(raw, 9)) // 1024} KB gzipped", file=sys.stderr)


if __name__ == "__main__":
    main()
