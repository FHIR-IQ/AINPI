"""Resolve organizations into health systems, and measure how well it works.

A health system is not one organization. UPMC is a hospital operator, a health
plan, a physician group under a different legal name, and a long tail of
practices that each hold their own organization NPI. The directory records the
leaves and, mostly, not the tree. That is why the connectivity ledger shows
University of Pittsburgh Physicians reaching no endpoint while UPMC's Epic
endpoint is published and public.

## The obvious method does not work, and this is the evidence

`OrganizationAffiliation` looks like the answer. It links one organization to
another, the directory asserts the edge, and grouping by connected component
would need no inference. It was built that way first, and the result was wrong.

The resources are bare. They carry `organization`, `participatingOrganization`
and `active` and **no `code`**, so an edge never says whether it means
ownership, network participation, or something else.

Ranking the Pennsylvania hubs by out-degree says what the edges mostly are:

    ECKERD CORPORATION                577 children
    THRIFTY PAYLESS INC               534
    PENNSYLVANIA CVS PHARMACY LLC     444
    RITE AID OF PENNSYLVANIA LLC      342
    THRIFT DRUG INC                   245
    THE GIANT COMPANY LLC             139
    GIANT EAGLE INC                   120
    WEIS MARKETS INC                  120

That is retail pharmacy corporate structure, parent company to store location.
Health systems are a minority of the graph. Worse, connected components merge
unrelated organizations through shared hubs: taking components produced a
160-organization "UPMC" cluster containing Corry Memorial Hospital and Indiana
Total Therapy, and it handed all 7,308 UPMC practitioners an athenahealth URL
belonging to an ambulatory surgery centre.

So connected components are not used for system identity. The affiliation graph
is still reported, as a measured description of what the resource contains,
because "the NDH's organization-to-organization resource is mostly pharmacy
chains and carries no relationship type" is itself worth publishing.

**Brand key (inferred).** What remains is grouping by a normalized leading token
of the name. It is inference and is labelled as such everywhere. It is wrong in
ways that matter, and the guard against the worst of them is in `brand_key`:
"UNIVERSITY OF PITTSBURGH PHYSICIANS" and "UNIVERSITY OF PENN-MEDICAL GROUP"
must not collapse to a shared opener.

**Third-party vendors are not systems.** On the 2026-08-20 release, 421
brand-tier organization NPIs holding Pennsylvania practitioners carry the name
"COBIUS HEALTHCARE SOLUTIONS", spread over 163 cities in 35 states. That is a
billing and revenue-cycle vendor whose name sits on its clients' records,
not an owner. Brand grouping made it the third-largest "system" in the state
(15,427 practitioners) and handed those practitioners endpoints belonging to
unrelated clients, including a Louisiana health system's Epic endpoint. Such
organizations are excluded from grouping (`third_party_reason`) and stay in the
ledger as standalone organizations.

**Labels name the system, not a member.** Labelling a group by its largest
member produced "AHN PRIMARY CARE MOBILE CLINIC" and "WELLSPAN DIGESTIVE
HEALTH" as system names. The label is the attested owner or NPPES parent when
there is one, otherwise the brand stem every member shares (`system_label`).

**Endpoints stay in state.** A system's endpoint list must not pull in an
endpoint carried by a member outside the state being processed, unless that
member is the system's own entity (`filter_system_endpoints`).

Cost: no BigQuery of its own. Operates on rows the caller already fetched.
"""
from __future__ import annotations

import collections

# Leading tokens too generic to identify a system on their own. Grouping on
# these merges unrelated organizations, which is worse than not grouping: a
# false merge silently attributes one system's endpoint to another's providers.
GENERIC_OPENERS = frozenset({
    "UNIVERSITY", "THE", "SAINT", "ST", "MEDICAL", "COMMUNITY", "REGIONAL",
    "MEMORIAL", "GENERAL", "CENTRAL", "NORTH", "SOUTH", "EAST", "WEST",
    "NEW", "FIRST", "AMERICAN", "NATIONAL", "ADVANCED", "ASSOCIATED",
    "ASSOCIATES", "FAMILY", "CHILDRENS", "CHILDREN", "GOOD", "HOLY",
    "MOUNT", "MT", "LAKE", "VALLEY", "RIVER", "PARK", "GREATER", "UPPER",
    "LOWER", "TRI", "MID", "CARE", "HEALTH", "PREMIER", "PRIME", "UNITED",
})

# Connectors carry no identity. Stopping on one produces keys like
# "UNIVERSITY OF" that merge unrelated systems.
CONNECTORS = frozenset({"OF", "AND", "FOR", "AT", "IN", "ON", "A", "THE"})

# Third-party billing, revenue-cycle, management and staffing vendors whose
# name appears on many unrelated providers' organization records. Matched on
# `brand_key`, so a misspelling of the same name ("COBIUS HEALTCARE
# SOLUTIONS", which is in the file) is caught too. Extend this only with
# evidence: a named entry removes every organization carrying it from brand
# grouping. Attested owner and parent tiers still apply to those NPIs.
THIRD_PARTY_BRANDS = frozenset({
    "COBIUS",
})

# Name terms typical of a vendor that sits beside providers rather than owning
# them. Deliberately narrow: SERVICES and PARTNERS were measured and rejected,
# because real systems use them ("PINNACLE HEALTH MEDICAL SERVICES", "ARIA
# HEALTH PHYSICIAN SERVICES").
THIRD_PARTY_TERMS = frozenset({
    "BILLING", "REVENUE", "RCM", "SOLUTIONS", "STAFFING", "LOCUM", "LOCUMS",
    "MANAGEMENT", "MSO",
})

# Clinical services whose names contain MANAGEMENT. Stripped before the term
# test so a pain management practice is not mistaken for a management company.
CLINICAL_MANAGEMENT = (
    "PAIN MANAGEMENT", "CARE MANAGEMENT", "WEIGHT MANAGEMENT",
    "DISEASE MANAGEMENT", "CASE MANAGEMENT", "UTILIZATION MANAGEMENT",
    "MEDICATION MANAGEMENT", "WOUND MANAGEMENT", "DIABETES MANAGEMENT",
)

# Heuristic thresholds for a brand group that is a vendor, tuned on the PA
# slice of the 2026-08-20 release. All four must hold: the dominant name
# carries a vendor term, most members share that exact name, there are enough
# members to be a pattern, and they are spread further than one operator's
# footprint. "SENTARA ADVANCED IMAGING SOLUTIONS" (half of six members) and
# "PT SOLUTIONS" (three of five) fail the name-share test and stay grouped.
THIRD_PARTY_MIN_NAME_SHARE = 0.8
THIRD_PARTY_MIN_MEMBERS = 5
THIRD_PARTY_MIN_CITIES = 10
THIRD_PARTY_MIN_STATES = 3

_SUFFIXES = (
    " INC", " LLC", " LLP", " PC", " LTD", " CORP", " CORPORATION", " CO",
    " COMPANY", " PLLC", " PA",
)


def normalize(name):
    """Uppercase, punctuation to spaces, collapse, drop legal-form suffixes."""
    if not name:
        return ""
    out = "".join(c if c.isalnum() else " " for c in name.upper())
    out = " ".join(out.split())
    changed = True
    while changed:
        changed = False
        for suffix in _SUFFIXES:
            if out.endswith(suffix):
                out = out[: -len(suffix)].strip()
                changed = True
    return out


def brand_key(name):
    """A guessed system key for an organization name.

    Consumes leading tokens until one is distinctive, meaning neither a generic
    opener nor a connector. Stopping at the first generic token instead is the
    trap: "UNIVERSITY OF PITTSBURGH PHYSICIANS" and "UNIVERSITY OF PENN-MEDICAL
    GROUP" both reduce to "UNIVERSITY OF", which merges two unrelated systems
    and would hand one system's endpoint to the other's providers. Carrying on
    to "UNIVERSITY OF PITTSBURGH" and "UNIVERSITY OF PENN" keeps them apart.

    Returns None when no distinctive token appears in the first four, because
    no group is better than a wrong one.
    """
    tokens = normalize(name).split()
    if not tokens:
        return None
    key = []
    for token in tokens[:4]:
        key.append(token)
        if (token not in GENERIC_OPENERS
                and token not in CONNECTORS
                and len(token) >= 3):
            return " ".join(key)
    return None


class Components:
    """Union-find over organization ids."""

    def __init__(self):
        self.parent = {}

    def find(self, x):
        self.parent.setdefault(x, x)
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:  # path compression
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra

    def groups(self):
        out = collections.defaultdict(list)
        for node in self.parent:
            out[self.find(node)].append(node)
        return out


def attested_components(edges):
    """Connected components of the affiliation graph.

    `edges` is an iterable of (org_id_a, org_id_b). Undirected on purpose: the
    resources carry no code, so direction cannot be read as parent-to-child
    without assuming a meaning the data does not state.
    """
    uf = Components()
    for a, b in edges:
        if a and b:
            uf.union(a, b)
    return uf.groups()


def describe_affiliation_graph(edges, name_by_id, top_n=10):
    """Describe what the affiliation graph actually contains.

    Reported instead of being used for grouping. The out-degree ranking is the
    evidence that the resource is mostly retail pharmacy corporate structure,
    and the largest connected component shows how badly transitive closure
    behaves on an untyped edge set.
    """
    out_degree = collections.Counter()
    nodes = set()
    for a, b in edges:
        if not (a and b):
            continue
        out_degree[a] += 1
        nodes.add(a)
        nodes.add(b)

    comps = attested_components(edges)
    sizes = sorted((len(m) for m in comps.values()), reverse=True)

    return {
        "note": (
            "OrganizationAffiliation carries no `code`, so an edge does not "
            "state what the relationship is. The hubs below show the resource "
            "is dominated by retail pharmacy corporate structure, so connected "
            "components are not health systems and are not used as such."
        ),
        "edges": sum(1 for a, b in edges if a and b),
        "organizations_in_graph": len(nodes),
        "components": len(comps),
        "largest_component_size": sizes[0] if sizes else 0,
        "top_hubs": [
            {"name": name_by_id.get(oid), "children": n}
            for oid, n in out_degree.most_common(top_n)
        ],
    }


def has_third_party_term(name):
    """True when a name carries a vendor term, ignoring clinical MANAGEMENT."""
    text = f" {normalize(name)} "
    for phrase in CLINICAL_MANAGEMENT:
        text = text.replace(f" {phrase} ", " ")
    return any(tok in THIRD_PARTY_TERMS for tok in text.split())


def is_listed_third_party(name):
    """True when an organization name belongs to a named third-party vendor."""
    return brand_key(name) in THIRD_PARTY_BRANDS


def third_party_reason(members):
    """Why a brand group is a third-party vendor rather than a system, or None.

    `members` are organization rows (`org_name`, `org_city`, `org_state`). The
    explicit list wins. Otherwise the group is a vendor when its dominant name
    carries a vendor term, most members share that exact name, and the members
    are spread across many cities or states. A real system's subsidiaries
    rarely share one name across 160 cities; a vendor's clients do, because the
    vendor's name is the one written on their records.
    """
    if not members:
        return None
    if any(is_listed_third_party(o["org_name"]) for o in members):
        return "listed third-party vendor"
    if len(members) < THIRD_PARTY_MIN_MEMBERS:
        return None
    names = collections.Counter(normalize(o["org_name"]) for o in members)
    top_name, top_n = names.most_common(1)[0]
    if top_n / len(members) < THIRD_PARTY_MIN_NAME_SHARE:
        return None
    if not has_third_party_term(top_name):
        return None
    cities = {(o.get("org_state"), (o.get("org_city") or "").upper())
              for o in members if o.get("org_city")}
    states = {o.get("org_state") for o in members if o.get("org_state")}
    if (len(cities) >= THIRD_PARTY_MIN_CITIES
            or len(states) >= THIRD_PARTY_MIN_STATES):
        return (f"vendor-type name shared by {top_n} of {len(members)} "
                f"members across {len(cities)} cities in {len(states)} states")
    return None


def system_label(basis, key, members, parent_by_npi=None, owner_by_npi=None):
    """The name a system is shown under.

    Attested tiers use the owner or parent name as CMS or NPPES records it,
    taking the most frequent raw spelling among members. The brand tier uses
    the brand stem, which every member shares by construction. Never a
    member's own name: labelling by the largest member is how "AHN PRIMARY
    CARE MOBILE CLINIC" came to name Allegheny Health Network.
    """
    lookup = {"cms-ownership": owner_by_npi or {},
              "nppes-parent": parent_by_npi or {}}.get(basis)
    if lookup is not None:
        raw = collections.Counter(
            lookup[o["org_npi"]].strip() for o in members
            if lookup.get(o.get("org_npi") or "")
        )
        if raw:
            return raw.most_common(1)[0][0]
    return key.split(":", 1)[1] if ":" in key else key


def filter_system_endpoints(state, label, candidates):
    """Keep a system's endpoints in state, and report what is dropped.

    `candidates` are dicts carrying at least `url`, `via_member` (the member
    organization's name) and `member_state`. An endpoint is dropped when its
    member is in another state, unless that member is the system's own entity
    (its normalized name equals the label's). A member with no recorded state
    is kept, because it cannot be shown to be out of state, and is counted.

    Returns (kept, dropped, unknown_state_count).
    """
    state = (state or "").upper()
    own = normalize(label)
    kept, dropped, unknown = [], [], 0
    for c in candidates:
        member_state = (c.get("member_state") or "").upper()
        if not member_state:
            unknown += 1
            kept.append(c)
        elif member_state == state or normalize(c.get("via_member")) == own:
            kept.append(c)
        else:
            dropped.append(c)
    return kept, dropped, unknown


def rollup_system_endpoints(state, label, candidates):
    """Apply the in-state guard per (url, member) pair, then dedupe by URL.

    The guard must run before the dedup. One vendor tenant URL is often
    attached to many NPIs; deduping first lets an out-of-state member that
    happens to come first shadow an in-state member carrying the same URL, and
    the system loses an endpoint it reaches legitimately. A URL is reported as
    dropped only when no in-state copy survived.

    Returns (kept, dropped, unknown_state_count), each list one entry per URL
    in first-seen order.
    """
    kept_all, dropped_all, unknown = filter_system_endpoints(
        state, label, candidates)
    kept, kept_urls = [], set()
    for c in kept_all:
        if c["url"] not in kept_urls:
            kept_urls.add(c["url"])
            kept.append(c)
    dropped, dropped_urls = [], set()
    for c in dropped_all:
        if c["url"] in kept_urls or c["url"] in dropped_urls:
            continue
        dropped_urls.add(c["url"])
        dropped.append(c)
    return kept, dropped, unknown


def build_systems(org_rows, parent_by_npi=None, owner_by_npi=None,
                  min_practitioners=1, min_members=2, excluded=None):
    """Group organizations into health systems, best evidence first.

    Tier 1, attested ownership: CMS enrollment ownership data. It states
    ownership, names holding companies and chain home offices explicitly, and
    joins to an NPI with no loss. Hospitals only; it does not cover physician
    groups. See analysis/ingest_cms_ownership.py.

    Tier 2, attested subpart: NPPES `parent_organization_lbn`. CMS's own
    subpart-to-parent relationship. Real but sparse, sometimes stale, and
    sometimes a program rather than an owner, so it sits below tier 1.

    Tier 3, inferred: brand key from the organization name. Covers the rest and
    is labelled as inference everywhere it surfaces.

    The affiliation graph is used for neither: see the module docstring for why
    connected components of an untyped edge set produced a UPMC cluster
    containing Corry Memorial Hospital.

    Third-party vendors are never grouped by name. An organization on the
    explicit list is never brand-grouped, and a brand group matching the vendor
    heuristic is dropped whole; either way those organizations stay in the
    caller's rows as standalone organizations. The attested tiers still apply,
    because they describe the NPI rather than the name written on it: 44 PA
    organizations carrying the Cobius name have an NPPES parent such as
    Lancaster General Hospital or St. Clair Hospital, and that parent is
    evidence the vendor name is not. Pass a list as `excluded` to receive one
    row per excluded group.

    A group needs at least two organizations. One organization is not a system,
    and emitting it as one inflates the count with noise.
    """
    parent_by_npi = parent_by_npi or {}
    owner_by_npi = owner_by_npi or {}
    groups = collections.defaultdict(
        lambda: {"members": [], "practitioners": 0, "bases": set()})
    listed = collections.defaultdict(list)
    for o in org_rows:
        npi = o["org_npi"] or ""
        owner = owner_by_npi.get(npi)
        parent = parent_by_npi.get(npi)
        if owner:
            key, basis = f"owner:{normalize(owner)}", "cms-ownership"
        elif parent:
            key, basis = f"parent:{normalize(parent)}", "nppes-parent"
        elif is_listed_third_party(o["org_name"]):
            listed[brand_key(o["org_name"])].append(o)
            continue
        else:
            bk = brand_key(o["org_name"])
            if not bk:
                continue
            key, basis = f"brand:{bk}", "brand-name"
        entry = groups[key]
        entry["members"].append(o)
        entry["practitioners"] += o["practitioners"]
        entry["bases"].add(basis)

    exclusions = [
        {"system_key": f"brand:{bk}", "label": bk,
         "reason": "listed third-party vendor",
         "organizations": len(members),
         "practitioners": sum(o["practitioners"] for o in members)}
        for bk, members in listed.items()
    ]

    out = []
    for key, entry in groups.items():
        basis = ("cms-ownership" if "cms-ownership" in entry["bases"]
                 else "nppes-parent" if "nppes-parent" in entry["bases"]
                 else "brand-name")
        # Attested tiers state ownership, so the vendor heuristic is applied
        # to inferred brand groups only.
        if basis == "brand-name":
            reason = third_party_reason(entry["members"])
            if reason:
                exclusions.append({
                    "system_key": key,
                    "label": system_label(basis, key, entry["members"]),
                    "reason": reason,
                    "organizations": len(entry["members"]),
                    "practitioners": entry["practitioners"],
                })
                continue
        if (entry["practitioners"] < min_practitioners
                or len(entry["members"]) < min_members):
            continue
        out.append({
            "system_key": key,
            "label": system_label(basis, key, entry["members"],
                                  parent_by_npi, owner_by_npi),
            "basis": basis,
            "organizations": len(entry["members"]),
            "practitioners": entry["practitioners"],
            "member_org_ids": [o["org_id"] for o in entry["members"]],
        })
    out.sort(key=lambda s: -s["practitioners"])
    if excluded is not None:
        exclusions.sort(key=lambda r: -r["practitioners"])
        excluded.extend(exclusions)
    return out
