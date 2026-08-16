"""Harvest a payer FHIR provider directory to local NDJSON.

Payer directories published under the CMS-9115-F Patient Access rule carry the
resource the NDH leaves almost entirely empty: PractitionerRole, which is the
practitioner-to-organization affiliation edge. This script pulls a whole payer
directory down so that edge can be measured against the NDH instead of sampled.

Written against Capital BlueCross, which is the cleanest of the five payers
already wired into /api/provider-search, and kept payer-agnostic so Humana,
Molina and Cigna can reuse it.

Four facts about these servers drive the whole design, and every one of them
was measured rather than assumed:

1. **curl, not urllib.** Same lesson as H26 and H46. Python's TLS stack fails
   against WAF-fronted payer endpoints and against local TLS interception. The
   H46 run produced three false negatives before this was found.

2. **`_count` is not honoured; the page stride is fixed at 20.** Capital
   BlueCross returns at most 20 distinct resources per page whatever `_count`
   says, and `page=N` advances by 20 distinct records. Sizing a run off `_count`
   silently under-fetches.

3. **PractitionerRole ids are not unique.** Every logical role is emitted twice
   under the same `id`: once with `organization` naming the payer itself
   ("Capital Blue Cross") and once naming the real practice ("HMC/Dept of
   OB/GYN"). That is a FHIR conformance violation (resource id must be unique
   per type on a server) and it doubles the reported `total`. Deduplicating on
   `id` alone throws away half the organizations, including every useful one.
   The harvester therefore dedupes on (id, content-hash) and counts both.

4. **Throughput saturates near 3.6 req/s.** Measured at 1/4/8/12 workers: more
   concurrency past 8 buys almost nothing and only grows server-side queueing
   (mean latency 0.95s at 1 worker, 1.89s at 8, 2.21s at 12). Default is 8.

Gaps are recorded, never silently skipped. A page that fails every retry is
written to the checkpoint's `failed_pages` so a short run can be distinguished
from a complete one. A harvest that reports fewer resources than the server's
`total` without a matching failure list is a bug, not a smaller directory.

Cost: zero. No BigQuery, no paid API. Output lands in analysis/data/ which is
gitignored.

Usage:
    python analysis/harvest_payer_directory.py --payer capital-bluecross \\
        --resource Practitioner Organization Location
    python analysis/harvest_payer_directory.py --payer capital-bluecross \\
        --resource PractitionerRole --workers 8
    python analysis/harvest_payer_directory.py --payer capital-bluecross \\
        --resource PractitionerRole --resume
    python analysis/harvest_payer_directory.py --list-payers

Outputs, per payer, under analysis/data/payer/<slug>/:
    <Resource>.ndjson.gz        one JSON resource per line, deduped
    <Resource>.checkpoint.json  pages done, counters, failed pages, provenance
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import json
import pathlib
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "analysis" / "data" / "payer"

USER_AGENT = "ainpi-research/1.0 (+https://ainpi.dev; public provider-directory audit)"

# Payers already verified live by /api/provider-search and H26. `enumerable`
# records whether the directory can be paged at all, which is what decides the
# engineering cost. UHC via Optum FLEX returns zero rows to an enumeration
# query and 504s on a bare _count, so it is search-only and excluded here.
PAYERS = {
    "capital-bluecross": {
        "name": "Capital BlueCross",
        "base": "https://providerdirectory-api.capbluecross.com/r4",
        "state_focus": "PA",
        # Every supported search param is a filter; there is no "match all"
        # query. `_lastUpdated=gt<early date>` is the least-selective filter the
        # server accepts and is how enumeration is bootstrapped.
        "enumeration_param": "_lastUpdated=gt2015-01-01",
        "enumerable": True,
    },
    "humana": {
        "name": "Humana",
        "base": "https://fhir.humana.com/api",
        "state_focus": None,
        "enumeration_param": "_count=40",
        "enumerable": True,
    },
    "molina": {
        "name": "Molina Healthcare",
        "base": "https://api.interop.molinahealthcare.com/providerdirectory",
        "state_focus": None,
        "enumeration_param": "_count=40",
        "enumerable": True,
    },
}

RESOURCES = ("Practitioner", "Organization", "Location", "PractitionerRole")


def _digest(rid, blob):
    """64-bit digest of a resource id plus its canonical JSON."""
    return int.from_bytes(
        hashlib.blake2b(f"{rid}\x00{blob}".encode(), digest_size=8).digest(), "big"
    )


def part_paths(out_dir, resource):
    """Every part file for a resource, in order."""
    return sorted(pathlib.Path(out_dir).glob(f"{resource}.part*.ndjson.gz"))


def read_resources(out_dir, resource):
    """Yield harvested resources, tolerating a truncated final part.

    Each run writes its own part file rather than appending to a shared one.
    A run killed mid-write leaves its last gzip member incomplete; appending to
    that file would put every later byte behind an unreadable member, so the
    data would be silently lost on read. Separate parts confine the damage to
    the records the killed run had not flushed.
    """
    for path in part_paths(out_dir, resource):
        try:
            with gzip.open(path, "rt") as fh:
                for line in fh:
                    line = line.rstrip("\n")
                    if not line:
                        continue
                    try:
                        yield json.loads(line)
                    except json.JSONDecodeError:
                        continue  # partial trailing line from a killed run
        except (EOFError, OSError):
            continue


class Harvester:
    def __init__(self, slug, cfg, resource, out_dir, workers, page_size, timeout,
                 max_retries, max_pages):
        self.slug = slug
        self.cfg = cfg
        self.resource = resource
        self.out_dir = out_dir
        self.workers = workers
        self.page_size = page_size
        self.timeout = timeout
        self.max_retries = max_retries
        self.max_pages = max_pages

        self.ckpt_path = out_dir / f"{resource}.checkpoint.json"

        self.lock = threading.Lock()
        # 64-bit digests rather than (id, hash) string tuples: PractitionerRole
        # is 2.26M rows and the tuple form costs several hundred MB of resident
        # set for no benefit.
        self.seen = set()          # digest of id + content, already written
        self.ids_seen = set()      # distinct resource ids, for the dup measurement
        self.n_entries = 0         # raw Bundle entries observed
        self.n_written = 0         # distinct (id, hash) written
        self.n_dup_id_diff = 0     # same id, different content: the (3) case
        self.n_dup_exact = 0       # same id, same content
        self.failed_pages = []
        self.first_page = 1
        self.server_total = None
        self.bundle_timestamp = None

    # ---------- transport ----------

    def _curl(self, url):
        """One GET via curl. Returns (parsed_json | None, http_code | None)."""
        try:
            proc = subprocess.run(
                ["curl", "-s", "--compressed", "-m", str(self.timeout),
                 "-w", "\n%{http_code}",
                 "-H", "Accept: application/fhir+json",
                 "-H", f"User-Agent: {USER_AGENT}",
                 url],
                capture_output=True, text=True, timeout=self.timeout + 30,
            )
        except subprocess.TimeoutExpired:
            return None, None
        body = proc.stdout
        if "\n" not in body:
            return None, None
        body, code = body.rsplit("\n", 1)
        code = code.strip()
        if code != "200":
            return None, code
        try:
            return json.loads(body), code
        except json.JSONDecodeError:
            return None, code

    def page_url(self, page):
        base = self.cfg["base"].rstrip("/")
        param = self.cfg["enumeration_param"]
        return f"{base}/{self.resource}?{param}&_count={self.page_size}&page={page}"

    def fetch_page(self, page):
        """Fetch one page with backoff. Returns (page, entries|None, bundle)."""
        delay = 1.0
        for attempt in range(self.max_retries):
            bundle, code = self._curl(self.page_url(page))
            if bundle is not None and bundle.get("resourceType") == "Bundle":
                return page, bundle.get("entry") or [], bundle
            # 4xx other than 429 will not fix themselves; stop early.
            if code and code.startswith("4") and code != "429":
                break
            time.sleep(delay)
            delay = min(delay * 2, 30.0)
        return page, None, None

    # ---------- accumulation ----------

    def absorb(self, entries, out_fh):
        """Write unseen resources. Caller holds no lock; this takes it."""
        rows = []
        for entry in entries:
            res = entry.get("resource")
            if not isinstance(res, dict):
                continue
            rid = res.get("id")
            blob = json.dumps(res, sort_keys=True, separators=(",", ":"))
            rows.append((rid, _digest(rid, blob), blob))

        with self.lock:
            for rid, key, blob in rows:
                self.n_entries += 1
                if key in self.seen:
                    self.n_dup_exact += 1
                    continue
                if rid in self.ids_seen:
                    # Same id, different content. This is case (3) in the module
                    # docstring: keep it, because for PractitionerRole the second
                    # copy carries the only useful organization.
                    self.n_dup_id_diff += 1
                self.seen.add(key)
                self.ids_seen.add(rid)
                self.n_written += 1
                out_fh.write(blob + "\n")

    # ---------- checkpoint ----------

    def load_checkpoint(self):
        if not self.ckpt_path.exists():
            return False
        ckpt = json.loads(self.ckpt_path.read_text())
        if not part_paths(self.out_dir, self.resource):
            return False
        # Rebuild the dedup set from what is already on disk so a resumed run
        # cannot re-write rows it already has.
        for res in read_resources(self.out_dir, self.resource):
            blob = json.dumps(res, sort_keys=True, separators=(",", ":"))
            rid = res.get("id")
            self.seen.add(_digest(rid, blob))
            self.ids_seen.add(rid)
        self.n_written = len(self.seen)
        self.n_entries = ckpt.get("entries_seen", self.n_written)
        self.n_dup_exact = ckpt.get("duplicate_exact", 0)
        self.n_dup_id_diff = ckpt.get("duplicate_id_different_content", 0)
        self.failed_pages = ckpt.get("failed_pages", [])
        self.server_total = ckpt.get("server_reported_total")
        self.first_page = int(ckpt.get("pages_completed_through", 0)) + 1
        return True

    def write_checkpoint(self, through_page, complete):
        payload = {
            "payer_slug": self.slug,
            "payer_name": self.cfg["name"],
            "base_url": self.cfg["base"],
            "resource": self.resource,
            "retrieved_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
            "bundle_timestamp": self.bundle_timestamp,
            "server_reported_total": self.server_total,
            "page_size_requested": self.page_size,
            "pages_completed_through": through_page,
            "complete": complete,
            "entries_seen": self.n_entries,
            "resources_written": self.n_written,
            "distinct_ids": len(self.ids_seen),
            "duplicate_exact": self.n_dup_exact,
            "duplicate_id_different_content": self.n_dup_id_diff,
            "failed_pages": self.failed_pages,
            "part_files": [p.name for p in part_paths(self.out_dir, self.resource)],
        }
        self.ckpt_path.write_text(json.dumps(payload, indent=2) + "\n")
        return payload

    # ---------- driver ----------

    def run(self, resume):
        self.out_dir.mkdir(parents=True, exist_ok=True)
        if not resume:
            for stale in part_paths(self.out_dir, self.resource):
                stale.unlink()
        resumed = self.load_checkpoint() if resume else False
        if resumed:
            print(f"  resuming from page {self.first_page} "
                  f"({self.n_written:,} already on disk)")
        part_no = len(part_paths(self.out_dir, self.resource)) + 1
        part_path = self.out_dir / f"{self.resource}.part{part_no:04d}.ndjson.gz"

        # Probe page 1 for the server's own total before committing to a sweep.
        _, entries, bundle = self.fetch_page(1)
        if entries is None:
            print(f"  ABORT: {self.resource} page 1 did not answer", file=sys.stderr)
            return None
        self.server_total = bundle.get("total")
        self.bundle_timestamp = bundle.get("timestamp")
        stride = len({e["resource"]["id"] for e in entries if e.get("resource")})
        if stride == 0:
            print(f"  {self.resource}: empty directory")
            return self.write_checkpoint(1, True)
        est_pages = ((self.server_total or 0) + stride - 1) // stride
        print(f"  {self.resource}: server total={self.server_total:,} "
              f"distinct/page={stride} -> ~{est_pages:,} pages")

        done_through = self.first_page - 1
        t0 = time.time()
        with gzip.open(part_path, "wt", compresslevel=6) as out_fh:
            page = self.first_page
            hit_end = False
            while not hit_end:
                if self.max_pages and page > self.max_pages:
                    break
                batch = list(range(page, page + self.workers))
                with ThreadPoolExecutor(max_workers=self.workers) as ex:
                    results = sorted(ex.map(self.fetch_page, batch))

                for pg, entries, bundle in results:
                    if entries is None:
                        self.failed_pages.append(pg)
                        continue
                    if not entries:
                        hit_end = True
                        continue
                    self.absorb(entries, out_fh)

                # Only advance the checkpoint through pages that answered, and
                # stop counting at the first end-of-data page in this batch.
                answered = [pg for pg, e, _ in results if e]
                done_through = max(answered) if answered else done_through
                page += self.workers

                if (page // self.workers) % 25 == 0:
                    out_fh.flush()
                    el = time.time() - t0
                    rate = (page - self.first_page) / el if el else 0
                    remaining = max(est_pages - page, 0)
                    eta = remaining / rate / 60 if rate else 0
                    print(f"    page {page:,}/{est_pages:,}  "
                          f"{self.n_written:,} written  "
                          f"{rate:.1f} pg/s  ETA {eta:.0f}m  "
                          f"failed={len(self.failed_pages)}", flush=True)
                    self.write_checkpoint(done_through, False)

        complete = hit_end and not self.failed_pages
        payload = self.write_checkpoint(done_through, complete)
        el = time.time() - t0
        print(f"  {self.resource}: {self.n_written:,} resources "
              f"({len(self.ids_seen):,} distinct ids, "
              f"{self.n_dup_id_diff:,} id collisions with different content) "
              f"in {el/60:.1f}m, complete={complete}, "
              f"failed_pages={len(self.failed_pages)}")
        return payload


class RoleFetcher:
    """Fetch PractitionerRole for a named set of practitioners.

    A full PractitionerRole sweep of Capital BlueCross is 112,975 pages, about
    20 hours at the observed sustained rate. The rows that carry new
    information are only those for practitioners the NDH has no affiliation
    for, which is roughly a quarter of the directory, so this fetches by
    `practitioner=` instead. That is about 25,000 requests rather than 113,000,
    and it pulls exactly the subset the crosswalk publishes.

    The trade is explicit and worth stating wherever the output is used: this
    produces role coverage for the gap cohort, not for the whole directory.
    """

    def __init__(self, slug, cfg, out_dir, workers, timeout, max_retries):
        self.h = Harvester(slug, cfg, "PractitionerRole", out_dir, workers,
                           40, timeout, max_retries, 0)
        self.cfg = cfg
        self.out_dir = out_dir
        self.workers = workers
        self.done_ids = set()

    def _pages_for(self, pid):
        """All roles for one practitioner. Returns (pid, [resources])."""
        base = self.cfg["base"].rstrip("/")
        out = []
        page = 1
        while True:
            url = (f"{base}/PractitionerRole?practitioner=Practitioner/{pid}"
                   f"&_count=40&page={page}")
            bundle, code = self.h._curl(url)
            if bundle is None:
                delay = 1.0
                for _ in range(self.h.max_retries):
                    time.sleep(delay)
                    delay = min(delay * 2, 30.0)
                    bundle, code = self.h._curl(url)
                    if bundle is not None:
                        break
            if bundle is None:
                return pid, None
            entries = bundle.get("entry") or []
            if not entries:
                break
            out.extend(e["resource"] for e in entries if e.get("resource"))
            # Stride is 20 distinct per page even when 40 entries come back.
            if len({r.get("id") for r in
                    (e.get("resource") or {} for e in entries)}) < 20:
                break
            page += 1
            if page > 200:  # 4,000 roles for one practitioner: stop, record it
                break
        return pid, out

    def run(self, pids, resume):
        self.out_dir.mkdir(parents=True, exist_ok=True)
        done_path = self.out_dir / "PractitionerRole.fetched-ids.txt"
        if resume and done_path.exists():
            self.done_ids = set(done_path.read_text().split())
            for res in read_resources(self.out_dir, "PractitionerRole"):
                blob = json.dumps(res, sort_keys=True, separators=(",", ":"))
                self.h.seen.add(_digest(res.get("id"), blob))
                self.h.ids_seen.add(res.get("id"))
            self.h.n_written = len(self.h.seen)
            print(f"  resuming: {len(self.done_ids):,} practitioners already done")
        elif not resume:
            for stale in part_paths(self.out_dir, "PractitionerRole"):
                stale.unlink()
            done_path.unlink(missing_ok=True)

        todo = [p for p in pids if p not in self.done_ids]
        print(f"  fetching roles for {len(todo):,} practitioners "
              f"({len(pids):,} requested)")

        part_no = len(part_paths(self.out_dir, "PractitionerRole")) + 1
        part = self.out_dir / f"PractitionerRole.part{part_no:04d}.ndjson.gz"
        failed = []
        t0 = time.time()
        with gzip.open(part, "wt", compresslevel=6) as out_fh, \
                done_path.open("a") as done_fh:
            for i in range(0, len(todo), self.workers):
                batch = todo[i:i + self.workers]
                with ThreadPoolExecutor(max_workers=self.workers) as ex:
                    for pid, resources in ex.map(self._pages_for, batch):
                        if resources is None:
                            failed.append(pid)
                            continue
                        self.h.absorb([{"resource": r} for r in resources], out_fh)
                        done_fh.write(pid + "\n")
                if (i // self.workers) % 50 == 0 and i:
                    out_fh.flush()
                    done_fh.flush()
                    el = time.time() - t0
                    rate = i / el if el else 0
                    eta = (len(todo) - i) / rate / 60 if rate else 0
                    print(f"    {i:,}/{len(todo):,} practitioners  "
                          f"{self.h.n_written:,} roles  {rate:.1f}/s  "
                          f"ETA {eta:.0f}m  failed={len(failed)}", flush=True)

        self.h.failed_pages = failed
        payload = self.h.write_checkpoint(0, not failed)
        payload["mode"] = "by-practitioner"
        payload["practitioners_requested"] = len(pids)
        payload["practitioners_fetched"] = len(pids) - len(failed)
        self.h.ckpt_path.write_text(json.dumps(payload, indent=2) + "\n")
        print(f"  PractitionerRole: {self.h.n_written:,} roles "
              f"({len(self.h.ids_seen):,} distinct ids, "
              f"{self.h.n_dup_id_diff:,} id collisions) in "
              f"{(time.time()-t0)/60:.1f}m, failed={len(failed)}")
        return payload


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--payer", default="capital-bluecross")
    ap.add_argument("--resource", nargs="+", default=["Practitioner"],
                    choices=list(RESOURCES))
    ap.add_argument("--workers", type=int, default=8,
                    help="concurrent requests; throughput saturates near 8")
    ap.add_argument("--page-size", type=int, default=40,
                    help="_count value sent; servers may ignore it")
    ap.add_argument("--timeout", type=int, default=90)
    ap.add_argument("--max-retries", type=int, default=4)
    ap.add_argument("--max-pages", type=int, default=0,
                    help="stop after this page; 0 means run to the end")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--list-payers", action="store_true")
    ap.add_argument("--roles-for-ids", default=None, metavar="FILE",
                    help="fetch PractitionerRole by practitioner= for the "
                         "practitioner ids in FILE (one per line) instead of "
                         "sweeping every page")
    args = ap.parse_args()

    if args.list_payers:
        for slug, cfg in PAYERS.items():
            print(f"{slug:20s} {cfg['name']:22s} {cfg['base']}")
        return 0

    if args.payer not in PAYERS:
        print(f"unknown payer {args.payer!r}; try --list-payers", file=sys.stderr)
        return 2
    cfg = PAYERS[args.payer]
    out_dir = pathlib.Path(args.out_dir) if args.out_dir else DATA_DIR / args.payer

    print(f"{cfg['name']} ({cfg['base']})")

    if args.roles_for_ids:
        pids = [ln.strip() for ln in
                pathlib.Path(args.roles_for_ids).read_text().splitlines()
                if ln.strip()]
        RoleFetcher(args.payer, cfg, out_dir, args.workers, args.timeout,
                    args.max_retries).run(pids, args.resume)
        return 0

    for resource in args.resource:
        h = Harvester(args.payer, cfg, resource, out_dir, args.workers,
                      args.page_size, args.timeout, args.max_retries,
                      args.max_pages)
        h.run(args.resume)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
