#!/usr/bin/env python
"""build_drops.py - derive a "where do I get item X" table from the unpacked Enshrouded server data.

Read-only on the game data. Writes drops.json (+ placements.json) into --out-dir.

Model (see REPORT.md for the evidence):
  * Loot labels. Every container / enemy has a SET OF TAGS (tag id = FNV-1a of the tag guid, groupIndex 0..3).
    The tags come from (a) the template's RandomLoot.defaultLabels (DefaultLootLabelCollectionResource, "kind":
    wood/silver/gold chest, enemy identity ...) and (b) the scene node of the placed entity
    (SceneRandomLootResource.lootContainer[nodeId].lootSettingsIndex -> lootSettings, "tier" g2 + "biome" g3).
    An item (LootableItemsResource) is eligible when one root-to-leaf path of its labelGroups tree is covered by the
    tags (one matching label per level); its weight is the product of the matched label weights.
  * RandomLootSlotCount slots are rolled; each slot picks an eligible item by weight (gear: shufflebag category
    weights first). RandomLootProbability scales the whole container.
  * DefaultInventoryResource: fixed contents of chests, pickups and (via Actor.deathSequence ->
    TransformToLootEvent.defaultInventory) enemy corpses: stacks with spawnProbability, selector groups choosing one
    stack by weight, groups gated by a label tree.
  * Spawners (RandomSpawner, ...) link placed spawn points to enemy / pickup templates.
  * SceneRandomLootResource.specialItems: one guaranteed item placed into one of N candidate containers.
  * SceneResource.questItems: fixed quest/collectible items with a container node and a position.

Usage: python tools/build_drops.py --data <unpacked server dir> --loca <client loca_en.bin> [--out-dir build/loot]
Then tools/loot_for_page.py turns drops.json + placements.json into web/loot.json. The model and its
open questions are in docs/RESEARCH.md section 22.
"""
import argparse
import collections
import glob
import json
import math
import os
import pickle
import re
import struct
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
INTERIOR_CORNERS = [(1600.0, 8000.0), (2600.0, 8200.0)]  # same rule as extract_pois.py: dungeon interiors
TAG_RE = re.compile(r"</?[A-Za-z][A-Za-z0-9_]*>")
GUID_RE = re.compile(r'"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"')


def fnv1a(data):
    h = 0x811C9DC5
    for c in data:
        h = ((h ^ c) * 0x01000193) & 0xFFFFFFFF
    return h


def guid_id(g):
    return fnv1a(uuid.UUID(g).bytes_le)


def load_loca(path):
    blob = open(path, "rb").read()
    rel, count = struct.unpack_from("<iI", blob, 0)
    texts = {}
    for i in range(count):
        o = rel + 24 * i
        tid, trel, tlen = struct.unpack_from("<IiI", blob, o)
        texts[tid] = TAG_RE.sub("", blob[o + 4 + trel:o + 4 + trel + tlen].decode("utf-8", "replace")).strip()
    return texts


class Cache:
    def __init__(self, folder):
        self.folder = folder
        if folder:
            os.makedirs(folder, exist_ok=True)

    def get(self, name, fn):
        if self.folder:
            p = os.path.join(self.folder, name + ".pkl")
            if os.path.exists(p):
                return pickle.load(open(p, "rb"))
        v = fn()
        if self.folder:
            pickle.dump(v, open(os.path.join(self.folder, name + ".pkl"), "wb"))
        return v


def jfirst(data, folder):
    return json.load(open(sorted(glob.glob(os.path.join(data, folder, "*.json")))[0], encoding="utf-8"))


# ------------------------------------------------------------------------------------------------ loaders
TPL_KEEP = {
    "keen::ecs::RandomLoot", "keen::ecs::RandomLootContainer", "keen::ecs::RandomLootSlotCount",
    "keen::ecs::RandomLootProbability", "keen::ecs::RandomLootOnDestroy", "keen::ecs::DefaultInventory",
    "keen::ecs::ResourceNodePickupDrops", "keen::ecs::RandomSpawner", "keen::ecs::TriggerBoxMultiSpawner",
    "keen::ecs::WhiteboxRandomSpawner", "keen::ecs::TriggerSpawner", "keen::ecs::SpawnEntityOnDestroy",
    "keen::ecs::RandomLootEntitySpawner", "keen::ecs::RayCastSpawner", "keen::ecs::PickupItem",
    "keen::ecs::Actor", "keen::ecs::EnemyArsenalReference", "keen::ecs::PickupLootSlot",
    "keen::ecs::InteractionLootRefill", "keen::ecs::EnemyScaling",
}


def load_templates(data):
    out = {}
    for p in glob.glob(os.path.join(data, "TemplateResource", "*.json")):
        d = json.load(open(p, encoding="utf-8"))
        comps = {}
        for c in d.get("components") or []:
            if c["$type"] in TPL_KEEP:
                comps[c["$type"]] = c["$value"]
        out[d["$guid"]] = {"name": d.get("name") or "", "family": d.get("family"), "comps": comps}
    return out


def load_death_sequences(data):
    """actor sequence guid -> list of TransformToLootEvent {inv, keep, req} (only sequences that have one)."""
    out = {}
    for f in glob.glob(os.path.join(data, "ActorSequenceResource", "*.json")):
        s = open(f, encoding="utf-8").read()
        if "TransformToLootEvent" not in s and "SpawnEntityEvent" not in s:
            continue
        d = json.loads(s)
        evs = []

        def walk(o):
            if isinstance(o, dict):
                if o.get("$type") == "keen::actor::TransformToLootEvent":
                    v = o["$value"]
                    evs.append({"inv": v.get("defaultInventory"), "keep": v.get("keepDefaultInventory"),
                                "req": v.get("requiredEntityTag"), "tpl": None})
                elif o.get("$type") == "keen::actor::SpawnEntityEvent":
                    v = o["$value"]
                    if v.get("templateReference"):
                        evs.append({"inv": None, "keep": None, "req": v.get("requiredEntityTag"),
                                    "tpl": v["templateReference"]})
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(d)
        if evs:
            out[d["$guid"]] = evs
    return out


def load_scene(data):
    """All placed entities: rows (templateIdx, x, y, z, nodeId) + node index. Layout of spawnData.indices:
    per entity [nComponents, startLo, startHi, ...flag indices]; entries[i] belongs to entities[i]."""
    tpl_idx, tpl_list, rows, nodes = {}, [], [], {}
    for p in sorted(glob.glob(os.path.join(data, "SceneEntityChunkResource", "*.json"))):
        d = json.load(open(p, encoding="utf-8"))
        sd = d["spawnData"]
        ix, comps, entries, tp = sd["indices"], sd["components"], sd["entries"], d["templates"]
        for i, e in enumerate(d["entities"]):
            g = tp[e["templateIndex"]]
            ti = tpl_idx.get(g)
            if ti is None:
                ti = tpl_idx[g] = len(tpl_list)
                tpl_list.append(g)
            t = e["transform"]
            x = t["positionX1"] + t["positionX0"] / 65536.0
            y = t["positionY1"] + t["positionY0"] / 65536.0
            z = t["positionZ1"] + t["positionZ0"] / 65536.0
            node = 0
            if i < len(entries):
                s = entries[i]["spawnIndexStart"]
                n = ix[s]
                if n > 0:
                    start = ix[s + 1] + (ix[s + 2] << 8)
                    for c in comps[start:start + n]:
                        if c["$type"] == "keen::ecs::SceneLootNodeId":
                            node = c["$value"]["id"]["value"]
            rows.append((ti, round(x, 1), round(y, 1), round(z, 1), node))
            if node:
                nodes[node] = len(rows) - 1
    return {"tpl_list": tpl_list, "rows": rows, "nodes": nodes}


# ------------------------------------------------------------------------------------------------ model
class Loot:
    def __init__(self, data, loca_path, cache):
        self.data = data
        loca = load_loca(loca_path)
        # items
        reg = jfirst(data, "ItemRegistryResource")
        self.items = {}
        self.guid_item = {}
        for g, dbg in zip(reg["itemRefs"], reg["dbgNames"]):
            fs = glob.glob(os.path.join(data, "ItemInfo", g + "_*.json"))
            if not fs:
                continue
            d = json.load(open(fs[0], encoding="utf-8"))
            iid = d["itemId"]["value"]
            nm = loca.get(guid_id(d["name"])) if d.get("name") else None
            self.items[iid] = {"guid": g, "dbg": dbg, "name": nm or dbg, "category": d.get("category")}
            self.guid_item[g] = iid
        li = jfirst(data, "LootableItemsResource")
        self.lootable = {it["itemId"]["value"]: it for it in li["items"]}
        self.bag_default = li["shufflebagCategoryWeights"]
        self.rarity_rates = li["globalRarityDropRates"]
        self.dl = {s["id"]["value"]: s for s in jfirst(data, "DefaultLootLabelCollectionResource")["lootSettings"]}
        srl = jfirst(data, "SceneRandomLootResource")
        self.scene_settings = srl["lootSettings"]
        self.node_setting = {x["nodeId"]["value"]: x["lootSettingsIndex"] for x in srl["lootContainer"]}
        self.special_items = srl["specialItems"]
        self.quest_items = jfirst(data, "SceneResource")["questItems"]
        self.paths = {iid: self._paths(it["labelGroups"]) for iid, it in self.lootable.items()}
        # default inventories
        self.di = {}
        for f in glob.glob(os.path.join(data, "DefaultInventoryResource", "*.json")):
            d = json.load(open(f, encoding="utf-8"))
            self.di[d["$guid"]] = d["rootGroup"]
        self.tpl = cache.get("templates", lambda: load_templates(data))
        self.seq = cache.get("death_seq", lambda: load_death_sequences(data))
        self.scene = cache.get("scene", lambda: load_scene(data))
        self.tpl_list = self.scene["tpl_list"]
        self.tpl_pos = collections.defaultdict(list)       # template guid -> [(x,y,z,node)]
        for ti, x, y, z, node in self.scene["rows"]:
            self.tpl_pos[self.tpl_list[ti]].append((x, y, z, node))
        self._match_cache = {}
        self._probs_cache = {}
        self._di_cache = {}

    # ---- label trees
    def _paths(self, g):
        node = {l["tagId"]["value"]: l["weight"] for l in g["labels"]}
        if not g["childGroups"]:
            return [[node]] if node else []
        out = []
        for c in g["childGroups"]:
            for p in self._paths(c):
                out.append(([node] if node else []) + p)
        return out

    @staticmethod
    def tree_matches(g, tags):
        """DefaultInventory group gate: labels tree (same grammar as item labelGroups)."""
        if not g["labels"] and not g["childGroups"]:
            return True

        def ok(n):
            if n["labels"] and not any(l["tagId"]["value"] in tags for l in n["labels"]):
                return False
            if n["childGroups"]:
                return any(ok(c) for c in n["childGroups"])
            return True
        return ok(g)

    def eligible(self, tags):
        """tags {tagId: weight} -> {itemId: weight}"""
        key = tuple(sorted(tags.items()))
        r = self._match_cache.get(key)
        if r is not None:
            return r
        res = {}
        for iid, paths in self.paths.items():
            tot = 0.0
            for p in paths:
                w = 1.0
                for node in p:
                    s = 0.0
                    for t, lw in node.items():
                        tw = tags.get(t)
                        if tw:
                            s += lw * tw
                    if s <= 0:
                        w = 0.0
                        break
                    w *= s
                tot += w
            if tot > 0:
                res[iid] = tot
        self._match_cache[key] = res
        return res

    # ---- one random-loot slot
    def slot_probs(self, tags, mod):
        """{itemId: probability that ONE slot yields the item}."""
        key = (tuple(sorted(tags.items())), mod["align"], mod["bag"])
        r = self._probs_cache.get(key)
        if r is not None:
            return r
        el = self.eligible(tags)
        align = mod["align"]
        if align and align != "None":
            el = {i: w for i, w in el.items() if self.lootable[i]["classAlignmentType"] in (align, "None")}
        total = sum(el.values())
        out = {}
        if total > 0:
            bags = collections.defaultdict(float)
            gear_w = 0.0
            for i, w in el.items():
                bt = self.lootable[i]["shufflebagType"]
                if bt != "None":
                    bags[bt] += w
                    gear_w += w
            bw = mod["bag"] or self.bag_default
            catw = {"Weapon": bw["weaponWeight"], "Shield": bw["shieldWeight"], "Armor": bw["armorWeight"],
                    "Ring": bw["ringWeight"]}
            catsum = sum(catw[c] for c in bags) if bags else 0
            for i, w in el.items():
                bt = self.lootable[i]["shufflebagType"]
                if bt == "None":
                    out[i] = w / total
                elif catsum > 0:
                    out[i] = (gear_w / total) * (catw[bt] / catsum) * (w / bags[bt])
        self._probs_cache[key] = out
        return out

    # ---- default inventory
    def di_items(self, guid, tags):
        """{itemId: (probability of >=1 stack, countMin, countMax)} for a DefaultInventoryResource."""
        key = (guid, tuple(sorted(tags)))
        r = self._di_cache.get(key)
        if r is not None:
            return r
        out = {}
        root = self.di.get(guid)

        def add(item_id, p, cmin, cmax):
            if p <= 0:
                return
            o = out.get(item_id)
            if o is None:
                out[item_id] = [p, cmin, cmax]
            else:
                o[0] = 1 - (1 - o[0]) * (1 - p)
                o[1] = min(o[1], cmin)
                o[2] = max(o[2], cmax)

        def rec(g, mult):
            if not self.tree_matches(g["lootLabels"], tags):
                return
            if g["isSelector"] and g["stacks"]:
                wsum = sum(s["weight"] for s in g["stacks"]) or 1.0
                for s in g["stacks"]:
                    stack(s, mult * s["weight"] / wsum)
            else:
                for s in g["stacks"]:
                    stack(s, mult)
            for c in g["groups"]:
                rec(c, mult)

        def stack(s, mult):
            iid = s["item"]["value"]
            p = mult * s["spawnProbability"]
            if iid:
                if iid in self.items:
                    add(iid, p, s["countMin"], s["countMax"])
            elif s["lootLabelsId"]["value"] in self.dl:
                # labelled stack without fixed item: one random loot roll from that label collection
                st = self.dl[s["lootLabelsId"]["value"]]
                tg = dict(tags_of(st))
                for k in tags:
                    tg.setdefault(k, 1.0)
                for iid2, pp in self.slot_probs(tg, mod_of(st)).items():
                    add(iid2, p * pp, 1, 1)
        if root:
            rec(root, 1.0)
        out = {k: tuple(v) for k, v in out.items()}
        self._di_cache[key] = out
        return out


def tags_of(setting):
    d = {}
    for t in setting["tags"]:
        d[t["tagId"]["value"]] = max(d.get(t["tagId"]["value"], 0), t["weight"])
    return d


def mod_of(setting):
    m = setting["modifier"]
    sb = m["shufflebagWeights"]
    bag = None
    if sb["mode"] == "Set":
        bag = (sb["weaponWeight"], sb["shieldWeight"], sb["armorWeight"], sb["ringWeight"])
    return {"align": m["classAlignment"], "bag": _Bag(bag) if bag else None}


class _Bag(dict):
    """hashable-friendly shufflebag weights"""

    def __init__(self, t):
        super().__init__(weaponWeight=t[0], shieldWeight=t[1], armorWeight=t[2], ringWeight=t[3])
        self._t = t

    def __hash__(self):
        return hash(self._t)

    def __eq__(self, o):
        return isinstance(o, _Bag) and self._t == o._t


def merge_mod(a, b):
    return {"align": a["align"] if a["align"] != "None" else b["align"], "bag": a["bag"] or b["bag"]}


# ------------------------------------------------------------------------------------------------ naming
def chest_kind(name):
    n = name.lower()
    if not n.startswith("lootchest"):
        return None
    if "sarcophagus" in n:
        return "sarcophagus"
    if "gold" in n:
        return "gold"
    if "silver" in n:
        return "silver"
    if "wood" in n or "shell" in n:
        return "wood"
    return "other"


def pretty(name):
    s = re.sub(r"^(Base_)", "", name)
    boss = bool(re.search(r"boss_?health_?bar|_boss_|^Enemy_Boss", s, re.I))
    s = re.sub(r"[_ ]?boss_?health_?bar", "", s, flags=re.I)
    s = re.sub(r"^(Enemy_|Animal_|LootContainer_Enemy_|Spawnpoints?_)", lambda m: "Spawn point " if m.group(1).startswith("Spawnpoint") else "", s)
    s = re.sub(r"_+", " ", s).strip()
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)
    return s + (" (boss)" if boss and "boss" not in s.lower() else "")


def describe(name, role):
    ck = chest_kind(name)
    if ck:
        flags = []
        n = name.lower()
        if "locked" in n:
            m = re.search(r"t(\d)(?:[-_]t?(\d))?", n)
            flags.append("locked" + (" T" + m.group(1) + ("-" + m.group(2) if m.group(2) else "") if m else ""))
        if "fog" in n:
            flags.append("in the Shroud")
        if "water" in n:
            flags.append("underwater")
        label = {"gold": "Gold chest", "silver": "Silver chest", "wood": "Wooden chest",
                 "sarcophagus": "Sarcophagus", "other": "Chest"}[ck]
        return label + (" (" + ", ".join(flags) + ")" if flags else "")
    return pretty(name)


def is_interior(x, z):
    return any(x < cx and z > cz for cx, cz in INTERIOR_CORNERS)


# ------------------------------------------------------------------------------------------------ main build
def slot_count_dist(c):
    lo, hi = (c["slotsMin"], c["slotsMax"]) if c else (1, 1)
    if hi < lo:
        hi = lo
    n = hi - lo + 1
    return [(k, 1.0 / n) for k in range(lo, hi + 1)]


def at_least_one(p, dist):
    return sum(pn * (1 - (1 - p) ** k) for k, pn in dist)


def build(a):
    cache = Cache(a.cache)
    L = Loot(a.data, a.loca, cache)
    T = L.tpl
    # ---- spawn graph
    edges = collections.defaultdict(list)       # template guid -> [(child guid, share)]
    for g, t in T.items():
        c = t["comps"]
        rs = c.get("keen::ecs::RandomSpawner")
        if rs and rs["spawnEntries"]:
            wsum = sum(e["weight"] for e in rs["spawnEntries"]) or 1.0
            for e in rs["spawnEntries"]:
                for et in e["entityTemplates"]:
                    edges[g].append((et, e["weight"] / wsum))
        tb = c.get("keen::ecs::TriggerBoxMultiSpawner")
        if tb and tb.get("entityTemplate"):
            edges[g].append((tb["entityTemplate"], 1.0))
        wb = c.get("keen::ecs::WhiteboxRandomSpawner")
        if wb:
            ws = sum(e["weight"] for e in wb["entries"]) or 1.0
            for e in wb["entries"]:
                if e.get("entityTemplateId"):
                    edges[g].append((e["entityTemplateId"], e["weight"] / ws))
        ts = c.get("keen::ecs::TriggerSpawner")
        if ts and ts.get("entityTemplate"):
            edges[g].append((ts["entityTemplate"], 1.0))
        so = c.get("keen::ecs::SpawnEntityOnDestroy")
        if so and so.get("spawnEntity"):
            edges[g].append((so["spawnEntity"], 1.0))
        le = c.get("keen::ecs::RandomLootEntitySpawner")
        if le and le.get("lootEntity"):
            edges[g].append((le["lootEntity"], 1.0))
        rc = c.get("keen::ecs::RayCastSpawner")
        if rc:
            es = [e["entityTemplate"] for e in rc["spawnEntries"] if e.get("entityTemplate")]
            for e in es:
                edges[g].append((e, 1.0 / len(es)))

    def corpse_tpl(g):
        """template guid spawned by a death sequence if it is a lootable container, else None"""
        t = T.get(g) if g else None
        if not t:
            return None
        c = t["comps"]
        if (c.get("keen::ecs::DefaultInventory") or {}).get("defaultInventory"):
            return g
        return None

    def role(g):
        t = T.get(g)
        if not t:
            return None
        c = t["comps"]
        act = c.get("keen::ecs::Actor")
        has_death = bool(act and any(e["inv"] or corpse_tpl(e["tpl"]) for e in L.seq.get(act.get("deathSequence"), [])))
        if has_death or ("keen::ecs::EnemyArsenalReference" in c and "keen::ecs::RandomLoot" in c):
            return "enemy"
        if chest_kind(t["name"]):
            return "chest"
        if "keen::ecs::PickupItem" in c and (c["keen::ecs::PickupItem"].get("item") in L.guid_item):
            return "node"
        if t["name"].startswith(("Scatter_", "LootPickup", "Lootpickup")) and "keen::ecs::PickupLootSlot" not in c:
            return "node"
        if ("keen::ecs::ResourceNodePickupDrops" in c or "keen::ecs::InteractionLootRefill" in c):
            return "node"
        if ("keen::ecs::RandomLootContainer" in c or "keen::ecs::PickupLootSlot" in c or
                ((c.get("keen::ecs::DefaultInventory") or {}).get("defaultInventory"))):
            return "container"
        return None

    # ---- per (template, scene-setting index) item chances
    spec_cache = {}

    def spec(g, sidx, parent_tags_override=None):
        """-> {itemId: [chance, countMin, countMax, via]} for one template under scene setting sidx (-1 = none)."""
        key = (g, sidx)
        r = spec_cache.get(key)
        if r is not None:
            return r
        t = T[g]
        c = t["comps"]
        rl = c.get("keen::ecs::RandomLoot") or {}
        tags, mod = {}, {"align": "None", "bag": None}
        if rl.get("defaultLabels"):
            st = L.dl.get(guid_id(rl["defaultLabels"]))
            if st:
                tags.update(tags_of(st))
                mod = mod_of(st)
        if sidx >= 0:
            ss = L.scene_settings[sidx]
            for k, v in tags_of(ss).items():
                tags[k] = max(tags.get(k, 0), v)
            mod = merge_mod(mod, mod_of(ss))
        out = {}

        def put(iid, ch, cmin, cmax, via):
            o = out.get(iid)
            if o is None:
                out[iid] = [ch, cmin, cmax, via]
            else:
                o[0] = 1 - (1 - o[0]) * (1 - ch)
                o[1] = min(o[1], cmin)
                o[2] = max(o[2], cmax)
                if via not in o[3]:
                    o[3] += "+" + via
        # (1) random label loot
        if rl and not rl.get("disableRandomLoot") and tags and (
                "keen::ecs::RandomLootContainer" in c or "keen::ecs::PickupLootSlot" in c):
            prob = (c.get("keen::ecs::RandomLootProbability") or {}).get("spawnProbability", 1.0)
            dist = slot_count_dist(c.get("keen::ecs::RandomLootSlotCount"))
            for iid, p in L.slot_probs(tags, mod).items():
                it = L.lootable[iid]
                put(iid, prob * at_least_one(p, dist), it["stackSizeMin"], it["stackSizeMax"], "random")
        # (2) fixed default inventory of the template
        di = (c.get("keen::ecs::DefaultInventory") or {}).get("defaultInventory")
        if di:
            for iid, (p, cmin, cmax) in L.di_items(di, set(tags)).items():
                put(iid, p, cmin, cmax, "fixed")
        # (3) enemy corpse: Actor.deathSequence -> TransformToLootEvent.defaultInventory and/or SpawnEntityEvent ->
        #     LootContainer_Enemy_* template (its DefaultInventory). Variants by entity tag are averaged.
        act = c.get("keen::ecs::Actor")
        if act and act.get("deathSequence") in L.seq:
            evs = [e for e in L.seq[act["deathSequence"]] if e["inv"] or corpse_tpl(e["tpl"])]
            if evs:
                variants = any(e["req"] for e in evs)
                w = 1.0 / len(evs) if variants else 1.0
                per = collections.defaultdict(lambda: [0.0, 99999, 0])
                for e in evs:
                    invs = []
                    if e["inv"]:
                        invs.append((e["inv"], set(tags)))
                    ct = corpse_tpl(e["tpl"])
                    if ct:
                        cdi = (T[ct]["comps"].get("keen::ecs::DefaultInventory") or {}).get("defaultInventory")
                        if cdi:
                            invs.append((cdi, set(tags)))
                    for inv, tg in invs:
                        for iid, (p, cmin, cmax) in L.di_items(inv, tg).items():
                            q = per[iid]
                            q[0] = 1 - (1 - q[0]) * (1 - p * w)
                            q[1] = min(q[1], cmin)
                            q[2] = max(q[2], cmax)
                for iid, (p, cmin, cmax) in per.items():
                    put(iid, p, cmin, cmax, "corpse")
        # (4) gatherable pickups
        pk = c.get("keen::ecs::PickupItem")
        if pk and pk.get("item") in L.guid_item:
            amt = pk.get("pickupAmount", 1)
            put(L.guid_item[pk["item"]], 1.0, amt, amt, "pickup")
        nd = c.get("keen::ecs::ResourceNodePickupDrops")
        if nd and nd["drops"]:
            ws = sum(d["weight"] for d in nd["drops"]) or 1.0
            n = max(1, nd["numberOfDrops"])
            for d in nd["drops"]:
                p1 = d["weight"] / ws
                ch = 1 - (1 - p1) ** n
                dit = d.get("item")
                if isinstance(dit, dict):
                    dit = dit.get("value")
                elif isinstance(dit, str):
                    dit = L.guid_item.get(dit)
                if dit and dit in L.items:
                    put(dit, ch, d["stackAmount"], d["stackAmount"], "node")
                elif d.get("entity") in T:
                    ec = T[d["entity"]]["comps"]
                    pi = ec.get("keen::ecs::PickupItem")
                    if pi and pi.get("item") in L.guid_item:
                        amt = pi.get("pickupAmount", 1) * d["stackAmount"]
                        put(L.guid_item[pi["item"]], ch, amt, amt, "node")
                    edi = (ec.get("keen::ecs::DefaultInventory") or {}).get("defaultInventory")
                    if edi:
                        for iid, (p, cmin, cmax) in L.di_items(edi, set(tags)).items():
                            put(iid, ch * p, cmin, cmax, "node")
        spec_cache[key] = out
        return out

    # ---- collect sources: (item, kind, template guid) -> accumulators
    acc = {}          # (iid, kind, tguid) -> {"sum": chance sum, "n": placements weight, "pos": [...], "via": set}
    tpl_total = collections.Counter()   # (kind, tguid) -> placement weight
    tpl_positions = collections.defaultdict(list)

    def credit(kind, g, sidx, w, pos, parent=None):
        sp = spec(g, sidx)
        tpl_total[(kind, g)] += w
        if pos is not None:
            tpl_positions[(kind, g)].append(pos)
        for iid, (ch, cmin, cmax, via) in sp.items():
            k = (iid, kind, g)
            e = acc.get(k)
            if e is None:
                e = acc[k] = {"sum": 0.0, "cmin": cmin, "cmax": cmax, "via": set(), "parent": collections.Counter()}
            e["sum"] += ch * w
            e["cmin"] = min(e["cmin"], cmin)
            e["cmax"] = max(e["cmax"], cmax)
            e["via"].update(via.split("+"))
            if parent:
                e["parent"][parent] += w

    def walk(g, sidx, w, pos, depth, seen, parent_name):
        r = role(g)
        if r:
            credit(r, g, sidx, w, pos, parent_name)
        if depth >= 3:
            return
        for child, share in edges.get(g, []):
            if child in T and child not in seen:
                walk(child, sidx, w * share, pos, depth + 1, seen | {g}, T[g]["name"] if depth == 0 else parent_name)

    placed_templates = 0
    for g, plist in L.tpl_pos.items():
        if g not in T:
            continue
        if not edges.get(g) and role(g) is None:
            continue
        placed_templates += 1
        for (x, y, z, node) in plist:
            sidx = L.node_setting.get(node, -1) if node else -1
            pos = None if is_interior(x, z) else (x, y, z)
            walk(g, sidx, 1.0, pos, 0, frozenset(), None)

    # ---- special items: one guaranteed item in one of N candidate containers
    special = []
    for sp in L.special_items:
        iid = sp["itemId"]["value"]
        cands = [c["value"] for c in sp["lootContainerCandidates"]]
        n = len(cands)
        if n == 0 or iid not in L.items:
            continue
        per_t = collections.defaultdict(list)
        for cn in cands:
            ri = L.scene["nodes"].get(cn)
            if ri is None:
                continue
            ti, x, y, z, _ = L.scene["rows"][ri]
            per_t[L.tpl_list[ti]].append((x, y, z))
        for g, plist in per_t.items():
            if g not in T:
                continue
            special.append((iid, g, len(plist) / n, plist, sp["amount"], n))
    quest = []
    for q in L.quest_items:
        iid = q["itemId"]["value"]
        if iid not in L.items:
            continue
        p = q["transform"]["position"]
        pos = (round(p["x"] / 2 ** 32, 1), round(p["y"] / 2 ** 32, 1), round(p["z"] / 2 ** 32, 1))
        ri = L.scene["nodes"].get(q["lootContainerId"]["value"])
        g = L.tpl_list[L.scene["rows"][ri][0]] if ri is not None else None
        quest.append((iid, g, pos))

    # ---- assemble per item
    def sample(pl, k=4):
        if not pl:
            return []
        step = max(1, len(pl) // k)
        return [[int(round(v)) for v in p] for p in pl[::step][:k]]

    items_out = {}

    def ent(iid):
        e = items_out.get(iid)
        if e is None:
            it = L.items[iid]
            e = items_out[iid] = {"name": it["name"], "dbg": it["dbg"], "sources": []}
        return e
    for (iid, kind, g), e in acc.items():
        total = tpl_total[(kind, g)]
        t = T[g]
        pl = tpl_positions[(kind, g)]
        s = {"kind": kind, "template": t["name"], "name": describe(t["name"], kind),
             "chance": round(e["sum"] / total, 5) if total else None,
             "placements": int(round(total)) if total >= 1 else round(total, 3),
             "samplePositions": sample(pl),
             "via": sorted(e["via"])}
        if e["cmax"]:
            s["count"] = [e["cmin"], e["cmax"]]
        if e["parent"]:
            s["spawnedBy"] = [n for n, _ in e["parent"].most_common(3)]
        ent(iid)["sources"].append(s)
    for iid, g, share, plist, amount, n in special:
        t = T[g]
        r = role(g)
        carried = False
        if r is None:
            # a spawn point: the item is carried by whatever it spawns
            r = "enemy" if edges.get(g) else "container"
            carried = r == "enemy"
        pl = [p for p in plist if not is_interior(p[0], p[2])]
        ent(iid)["sources"].append({
            "kind": r, "template": t["name"],
            "name": describe(t["name"], r) + (" (carried by the spawned creature)" if carried else " (guaranteed item)"),
            "chance": round(share, 5), "placements": len(plist), "samplePositions": sample(pl),
            "via": ["special"], "count": [amount, amount], "candidatesTotal": n})
    for iid, g, pos in quest:
        t = T.get(g) if g else None
        ent(iid)["sources"].append({
            "kind": "container", "template": t["name"] if t else None,
            "name": (describe(t["name"], "container") if t else "Quest / collectible spot") + " (fixed item)",
            "chance": 1.0, "placements": 1, "samplePositions": [list(pos)], "via": ["quest"]})
    # gear: the loot variant (..._Loot) is the lootable copy of the craftable item; mirror the sources
    by_dbg = {v["dbg"]: i for i, v in L.items.items()}
    for iid in list(items_out):
        dbg = L.items[iid]["dbg"]
        if dbg.endswith("_Loot") and dbg[:-5] in by_dbg:
            base = by_dbg[dbg[:-5]]
            if base not in items_out:
                e = ent(base)
                e["sources"] = [dict(s, via=s["via"] + ["lootVariant"]) for s in items_out[iid]["sources"]]
                e["lootVariantOf"] = dbg
    for iid, e in items_out.items():
        e["sources"].sort(key=lambda s: (-(s["chance"] or 0), s["kind"], s["template"] or ""))
        e["sourceCount"] = len(e["sources"])
        if a.max_sources and len(e["sources"]) > a.max_sources:
            e["sources"] = e["sources"][:a.max_sources]
            e["truncated"] = True
    # items with no source: craftable (recipe output) or not
    recipes = jfirst(a.data, "RecipeRegistryResource")["recipes"]
    craftable = {o["item"]["value"] for r in recipes for o in r["output"]}
    missing = [i for i in L.items if i not in items_out]
    # ---- output
    os.makedirs(a.out_dir, exist_ok=True)
    out = {"build": "26083076", "itemCount": len(L.items), "withSource": len(items_out),
           "items": {str(i): e for i, e in sorted(items_out.items())}}
    kinds = collections.Counter()
    for e in items_out.values():
        for k in {s["kind"] for s in e["sources"]}:
            kinds[k] += 1
    out["summary"] = {
        "itemsTotal": len(L.items),
        "itemsWithAtLeastOneSource": len(items_out),
        "itemsPerKind": dict(kinds),
        "lootableItems": len(L.lootable),
        "lootableWithSource": sum(1 for i in L.lootable if i in items_out),
        "sourceTemplates": len({(s["kind"], s["template"]) for e in items_out.values() for s in e["sources"]}),
        "itemsWithLabelTree": sum(1 for i, p in L.paths.items() if p),
        "itemsWithLabelTreeAndSource": sum(1 for i, p in L.paths.items() if p and i in items_out),
        "withoutSourceTotal": len(missing),
        "withoutSourceCraftable": sum(1 for i in missing if i in craftable),
        "withoutSourceByCategory": dict(collections.Counter(L.items[i]["category"] for i in missing if i not in craftable)),
    }
    json.dump(out, open(os.path.join(a.out_dir, "drops.json"), "w", encoding="utf-8"), separators=(",", ":"))
    pl_out = {}
    for (kind, g), pl in tpl_positions.items():
        pl_out[kind + ":" + T[g]["name"]] = [[p[0], p[2]] for p in pl]
    json.dump(pl_out, open(os.path.join(a.out_dir, "placements.json"), "w"), separators=(",", ":"))
    json.dump([{"id": i, "dbg": L.items[i]["dbg"], "name": L.items[i]["name"], "category": L.items[i]["category"],
                "craftable": i in craftable} for i in missing], open(os.path.join(a.out_dir, "items_without_source.json"), "w", encoding="utf-8"), indent=0)
    print(json.dumps(out["summary"], indent=1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="kfc-parser unpack of the server files (u-clean-<build>)")
    ap.add_argument("--loca", required=True, help="the client's English texts (loca_en.bin)")
    ap.add_argument("--out-dir", default=os.path.join("build", "loot"))
    ap.add_argument("--cache", default=os.path.join("build", "loot", "cache"))
    ap.add_argument("--max-sources", type=int, default=0, help="keep only the N best sources per item (0 = all)")
    build(ap.parse_args())
