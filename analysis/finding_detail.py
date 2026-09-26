"""Pure helpers for refreshing a published finding's `detail` block in place.

Some findings are written in two halves by two scripts. H49 is the case that
prompted this: h49_recheck_release.py writes the headline, chart and notes,
and h49_ndh_payer_endpoints.py measures `detail` from BigQuery. The recheck
path never touched `detail`, and a full BigQuery run would have replaced the
current headline with an older template, so nothing refreshed `detail` at all
and it kept the 2026-05-08 values under a 2026-08-20 headline.

merge_detail() is the narrow write: it replaces only the keys it was given,
under `detail`, and leaves every other field of the public /api/v1 contract as
it is. The controls refuse to publish a measurement that could not have seen
anything. No BigQuery import here, so these are unit-tested directly.
"""
from __future__ import annotations


class RefreshRefused(RuntimeError):
    """A positive control failed; the measured values must not be published."""


def merge_detail(payload: dict, measured: dict) -> dict:
    """Replace `measured` keys under payload['detail']; touch nothing else."""
    detail = payload.get("detail")
    if not isinstance(detail, dict):
        detail = {}
    detail.update(measured)
    payload["detail"] = detail
    return payload


def type_codings_control(rows, *, payer_orgs: int) -> list[dict]:
    """Organization.type[].coding[] counts in the published shape, or refuse.

    `rows` are {code, display, n} from walking type[].coding[] in the raw
    resource JSON. Three checks, each a way this walk could return a plausible
    but wrong table:
      - no rows at all (the path moved, or the query read nothing);
      - no `prov` row (prov is the whole provider population; its absence
        means the walk is broken, not that providers left);
      - fewer `pay` codings than the payer PIN watch found payer-typed
        organizations, walking the same field in a separate query.
    """
    if not rows:
        raise RefreshRefused("Organization.type walk returned no codings")
    out = [{"code": r["code"], "display": r["display"], "count": int(r["n"])} for r in rows]
    counts: dict = {}
    for r in out:
        counts[r["code"]] = counts.get(r["code"], 0) + r["count"]
    if counts.get("prov", 0) <= 0:
        raise RefreshRefused("Organization.type walk found no 'prov' coding; "
                             "the population control failed")
    if counts.get("pay", 0) < payer_orgs:
        raise RefreshRefused(
            f"Organization.type walk found {counts.get('pay', 0)} 'pay' codings "
            f"but the payer PIN watch found {payer_orgs} payer-typed organizations")
    return out


def control_probe_usable(controls) -> bool:
    """True only if every control directory probe got an HTTP answer.

    probe() returns (0, 0) on any curl failure. Publishing that would turn a
    network error into `live_public: false` and `live_but_absent_from_ndh: 0`,
    which reads as a finding. A 4xx or 5xx is still an answer and is kept.
    """
    if not controls:
        return False
    return all(int(c.get("http_status") or 0) > 0 for c in controls)
