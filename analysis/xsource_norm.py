"""Normalization and lineage rules shared by every cross-source comparison.

One module, so the scorecard, the provider view and plan reconciliation all
normalize a ZIP, a phone and a taxonomy code the same way, and all agree on
which sources may corroborate each other.

Normalization:

    zip5      first five digits of a 5- or 9-digit US ZIP; anything else None.
    phone10   the phones-helper rule (cms_npd.phones_per_practitioner): strip
              every non-digit, drop a leading 1 from an 11-digit result,
              require exactly 10 digits. Anything else None, never a guess.
    taxonomy  a NUCC code that is a member of the current NUCC code set, via
              analysis/nucc_taxonomy.py. A well-formed code NUCC does not list
              is None, as is the CMS Medicare specialty form ("14-50").

Lineage: agreement is evidence only between sources that did not copy each
other. The NPD is built from NPPES and PECOS, so NPD equal to NPPES is copy
fidelity ("consistent with its upstream"), never agreement. Payer lineage is
unknown (payers often fill from CAQH or from NPPES itself), and unknown is
never treated as independent.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Callable

# Source -> the sources it is derived from. "unknown" means nobody has
# documented where the publisher's values come from.
LINEAGE: dict[str, list[str]] = {
    "npd": ["nppes", "pecos"],
    "nppes": [],
    "pecos": [],
    "humana": ["unknown"],
    "optum_flex": ["unknown"],
}

UNKNOWN = "unknown"

# macOS st_flags bit for an iCloud placeholder whose bytes are not local.
# Reading one blocks or fails partway, so every input is checked first.
SF_DATALESS = 0x40000000

_NON_DIGIT = re.compile(r"\D")
_NUCC_SHAPE = re.compile(r"^[0-9A-Z]{9}X$")


# --------------------------------------------------------------------------
# Lineage
# --------------------------------------------------------------------------

def _ancestors(source: str) -> set[str]:
    seen: set[str] = set()
    stack = list(LINEAGE[source])
    while stack:
        s = stack.pop()
        if s in seen or s == UNKNOWN:
            continue
        seen.add(s)
        stack.extend(LINEAGE.get(s, []))
    return seen


def _has_unknown(source: str) -> bool:
    if UNKNOWN in LINEAGE[source]:
        return True
    return any(UNKNOWN in LINEAGE.get(a, []) for a in _ancestors(source))


def relation(a: str, b: str) -> str:
    """How two sources relate: 'upstream', 'independent' or 'unknown'.

    'unknown' wins whenever either lineage is unknown, even if the other side
    is a root: an undocumented payer may have copied NPPES. 'upstream' when
    one source derives from the other, and also when both derive from a common
    source, because agreement through a shared parent is copy fidelity too
    (no current pair hits that case; the rule is stated so a later source
    cannot slip through as independent). Otherwise 'independent'.
    """
    for s in (a, b):
        if s not in LINEAGE:
            raise ValueError(f"unknown source {s!r}; add it to LINEAGE first")
    if a == b:
        raise ValueError("a source compared with itself is not a cross-source comparison")
    if _has_unknown(a) or _has_unknown(b):
        return "unknown"
    anc_a, anc_b = _ancestors(a), _ancestors(b)
    if b in anc_a or a in anc_b or (anc_a & anc_b):
        return "upstream"
    return "independent"


def lineage_label(source: str) -> str:
    """The lineage column value for a facts row: parents pipe-joined, or 'root'."""
    parents = LINEAGE[source]
    return "|".join(parents) if parents else "root"


# --------------------------------------------------------------------------
# Normalization
# --------------------------------------------------------------------------

def zip5(v) -> str | None:
    if v is None:
        return None
    digits = _NON_DIGIT.sub("", str(v))
    if len(digits) not in (5, 9):
        return None
    z = digits[:5]
    return None if z == "00000" else z


def phone10(v) -> str | None:
    if v is None:
        return None
    digits = _NON_DIGIT.sub("", str(v))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits if len(digits) == 10 else None


def phones_from_telecom(raw: str | None) -> list[str]:
    """Normalized phones from a flattened `_telecom` column.

    The column is `system:value` pairs joined with '|', in source order. Only
    `phone` entries count; fax numbers are not a way to reach a person.
    Order kept, duplicates and invalid values dropped.
    """
    if not raw:
        return []
    out: list[str] = []
    for pair in str(raw).split("|"):
        system, sep, value = pair.partition(":")
        if not sep or system != "phone":
            continue
        p = phone10(value)
        if p and p not in out:
            out.append(p)
    return out


_NUCC_CACHE: dict | None = None


def _load_nucc() -> dict:
    # Imported lazily: nucc_taxonomy fetches nucc.org when its cache is empty,
    # which must never happen as a side effect of importing this module.
    try:
        from nucc_taxonomy import load_taxonomy
    except ImportError:  # imported as analysis.xsource_norm
        from analysis.nucc_taxonomy import load_taxonomy
    return load_taxonomy()


def taxonomy(code, taxonomy_map: dict | None = None) -> str | None:
    """A NUCC taxonomy code if it is in the NUCC code set, else None.

    Pass `taxonomy_map` (the dict `nucc_taxonomy.load_taxonomy()` returns) in
    bulk loops and tests; without it the map is loaded once and cached.
    """
    global _NUCC_CACHE
    if code is None:
        return None
    c = str(code).strip().upper()
    if not _NUCC_SHAPE.match(c):
        return None
    if taxonomy_map is None:
        if _NUCC_CACHE is None:
            _NUCC_CACHE = _load_nucc()
        taxonomy_map = _NUCC_CACHE
    return c if c in taxonomy_map else None


# --------------------------------------------------------------------------
# Input guard
# --------------------------------------------------------------------------

def assert_materialized(path: Path | str, stat: Callable = os.stat) -> None:
    """Raise if `path` is missing or an iCloud placeholder (dataless).

    Stop rather than read around it: the fix is for the owner to open the
    folder in Finder and choose Download Now.
    """
    p = Path(path)
    st = stat(p)  # FileNotFoundError propagates for a missing file
    if getattr(st, "st_flags", 0) & SF_DATALESS:
        raise RuntimeError(
            f"{p} is an iCloud placeholder (dataless), not a local file. Open its "
            f"folder in Finder and choose Download Now, then re-run."
        )
