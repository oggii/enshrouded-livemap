"""The game's own texts (localisation) by LocaTag guid.

The client keeps all texts of a language in one content blob of keen::LocaTagCollectionResource
(unpacked descriptor: `kfc-parser unpack -f tkeen::LocaTagCollectionResource`). Layout
(LocaTagCollectionResourceData): BlobArray {int32 offset from the field, uint32 count} of
LocaTagResource (24 bytes): id u32, text {int32 offset from the field, u32 length} UTF-8,
arguments BlobArray, genericArguments u32. A LocaTag reference (a guid, e.g. MapMarker.markerId)
becomes the id as FNV-1a 32 over the guid's little-endian bytes (checked 2026-10-22: the spire
template MapMarker_Tower_Capital_FastTravel -> "Revelwood", as the game's map shows it).
"""
import json
import re
import struct
import uuid

from kfc_content import Kfc

TAG = re.compile(r"</?[A-Za-z][A-Za-z0-9_]*>")


def fnv1a(data):
    h = 0x811C9DC5
    for c in data:
        h = ((h ^ c) * 0x01000193) & 0xFFFFFFFF
    return h


def guid_id(guid):
    return fnv1a(uuid.UUID(guid).bytes_le)


class GameTexts:
    def __init__(self, game_dir, collection_json, language="En_Us"):
        d = json.load(open(collection_json, encoding="utf-8"))
        lang = next(l for l in d["languages"] if l["language"] == language)
        blob = Kfc(game_dir).read(lang["data"]["hash"])
        rel, count = struct.unpack_from("<iI", blob, 0)
        self.texts = {}
        for i in range(count):
            o = rel + 24 * i
            tid, trel, tlen = struct.unpack_from("<IiI", blob, o)
            text = blob[o + 4 + trel:o + 4 + trel + tlen].decode("utf-8", "replace")
            # markup the game styles: <location>Woodgard</location>, <npc>Farmer</npc>, ...
            self.texts[tid] = TAG.sub("", text).strip()

    def by_guid(self, guid):
        return self.texts.get(guid_id(guid)) if guid else None

    def by_id(self, tid):
        return self.texts.get(tid)
