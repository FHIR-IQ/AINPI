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


def build_systems(org_rows, parent_by_npi=None, owner_by_npi=None,
                  min_practitioners=1, min_members=2):
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

    A group needs at least two organizations. One organization is not a system,
    and emitting it as one inflates the count with noise.
    """
    parent_by_npi = parent_by_npi or {}
    owner_by_npi = owner_by_npi or {}
    groups = collections.defaultdict(
        lambda: {"members": [], "practitioners": 0, "bases": set()})
    for o in org_rows:
        npi = o["org_npi"] or ""
        owner = owner_by_npi.get(npi)
        parent = parent_by_npi.get(npi)
        if owner:
            key, basis = f"owner:{normalize(owner)}", "cms-ownership"
        elif parent:
            key, basis = f"parent:{normalize(parent)}", "nppes-parent"
        else:
            bk = brand_key(o["org_name"])
            if not bk:
                continue
            key, basis = f"brand:{bk}", "brand-name"
        entry = groups[key]
        entry["members"].append(o)
        entry["practitioners"] += o["practitioners"]
        entry["bases"].add(basis)

    out = []
    for key, entry in groups.items():
        if (entry["practitioners"] < min_practitioners
                or len(entry["members"]) < min_members):
            continue
        # Label by the member holding the most practitioners: it is the
        # recognisable one, and it avoids inventing a name nobody uses.
        lead = max(entry["members"], key=lambda o: o["practitioners"])
        out.append({
            "system_key": key,
            "label": lead["org_name"],
            "basis": ("cms-ownership" if "cms-ownership" in entry["bases"]
                      else "nppes-parent" if "nppes-parent" in entry["bases"]
                      else "brand-name"),
            "organizations": len(entry["members"]),
            "practitioners": entry["practitioners"],
            "member_org_ids": [o["org_id"] for o in entry["members"]],
        })
    out.sort(key=lambda s: -s["practitioners"])
    return out
