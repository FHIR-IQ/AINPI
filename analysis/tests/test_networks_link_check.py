import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import networks_link_check as nlc  # noqa: E402

AS_OF = date(2026, 11, 6)


def src(url):
    return {"url": url, "title": "t", "accessed": "2026-11-01", "primary": True}


def net(id_, url, last_checked="2026-11-01"):
    return {"id": id_, "website": url, "last_checked": last_checked, "sources": [src(url)]}


def payload(*networks, routes=()):
    return {"routes": list(routes), "networks": list(networks)}


def test_classify():
    assert nlc.classify(200, 0) == "ok"
    assert nlc.classify(301, 0) == "ok"
    for s in (403, 401, 429):
        assert nlc.classify(s, 0) == "blocked"
    for s in (404, 410, 503):
        assert nlc.classify(s, 0) == "dead"
    assert nlc.classify(None, 28) == "unreachable"
    assert nlc.classify(0, 6) == "unreachable"


def test_dead_names_network_and_url():
    p = payload(net("acme", "https://a.example/x"))
    needs, body = nlc.build_report(p, {"https://a.example/x": ("dead", 404)}, AS_OF)
    assert needs and "acme" in body and "https://a.example/x" in body
    assert "Dead or moved" in body


def test_stale():
    old = (AS_OF - timedelta(days=181)).isoformat()
    p = payload(net("oldnet", "https://a.example/x", old))
    needs, body = nlc.build_report(p, {"https://a.example/x": ("ok", 200)}, AS_OF)
    assert needs and "oldnet" in body and "Stale entries" in body


def test_not_stale_at_180():
    d = (AS_OF - timedelta(days=180)).isoformat()
    p = payload(net("n", "https://a.example/x", d))
    needs, _ = nlc.build_report(p, {"https://a.example/x": ("ok", 200)}, AS_OF)
    assert not needs


def test_blocked_only():
    p = payload(net("n", "https://a.example/x"))
    needs, body = nlc.build_report(p, {"https://a.example/x": ("blocked", 403)}, AS_OF)
    assert needs and "Check by hand" in body
    assert "Dead or moved" not in body and "—" not in body


def test_all_ok():
    p = payload(net("n", "https://a.example/x"))
    needs, _ = nlc.build_report(p, {"https://a.example/x": ("ok", 200)}, AS_OF)
    assert not needs


def test_routes_checked():
    r = {"id": "r1", "sources": [src("https://r.example/")]}
    p = payload(routes=[r])
    needs, body = nlc.build_report(p, {"https://r.example/": ("dead", 404)}, AS_OF)
    assert needs and "r1" in body


def _write(tmp_path, data):
    f = tmp_path / "n.json"
    f.write_text(json.dumps(data))
    return f


def test_main_all_unreachable_fails(tmp_path, monkeypatch):
    f = _write(tmp_path, payload(net("a", "https://a.example/"), net("b", "https://b.example/")))
    monkeypatch.setattr(nlc, "check_url", lambda url, timeout=20: ("unreachable", None))
    body = tmp_path / "body.md"
    rc = nlc.main(["--networks", str(f), "--issue-body-file", str(body), "--as-of", "2026-11-06"])
    assert rc == 1 and not body.exists()


def test_main_zero_urls(tmp_path, monkeypatch):
    f = _write(tmp_path, payload())
    out = tmp_path / "out"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    monkeypatch.setattr(nlc, "check_url", lambda *a, **k: (_ for _ in ()).throw(AssertionError))
    body = tmp_path / "body.md"
    rc = nlc.main(["--networks", str(f), "--issue-body-file", str(body)])
    assert rc == 0 and "needs_attention=false" in out.read_text()
    assert "issue_title=" in out.read_text()


def test_main_writes_body(tmp_path, monkeypatch):
    f = _write(tmp_path, payload(net("a", "https://a.example/")))
    out = tmp_path / "out"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    monkeypatch.setattr(nlc, "check_url", lambda url, timeout=20: ("dead", 404))
    body = tmp_path / "body.md"
    rc = nlc.main(["--networks", str(f), "--issue-body-file", str(body), "--as-of", "2026-11-06"])
    assert rc == 0 and "needs_attention=true" in out.read_text()
    assert "issue_title=Network sources need re-verification 2026-11" in out.read_text()
    assert "a" in body.read_text()


def test_curl_argv_ends_options_before_url(monkeypatch):
    seen = {}

    class Done:
        stdout = "200"
        returncode = 0

    def fake_run(argv, **kwargs):
        seen["argv"] = argv
        return Done()

    monkeypatch.setattr(nlc.subprocess, "run", fake_run)
    assert nlc.check_url("-K/etc/passwd") == ("ok", 200)
    assert seen["argv"][-2:] == ["--", "-K/etc/passwd"]
