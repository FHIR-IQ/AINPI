import random
import re

from ndh_quality.base import open_engine
from ndh_quality.rules.rule_npi_check_digit import NpiCheckDigit


def run(release_dir, tables, types=None):
    d = release_dir(tables, types)
    return NpiCheckDigit.measure(open_engine(), {"release_dir": str(d)})


def npi_row(vals):
    return [{"_npi": v} for v in vals]


def test_valid_npis_pass(release_dir):
    m = run(release_dir, {"practitioner": npi_row(["1234567893"]), "organization": []})
    assert m["status"] == "pass"
    assert m["numerator"] == m["denominator"] == 1


def test_bad_check_digit_fails(release_dir):
    vals = ["1234567893"] * 500 + ["1234567894"] * 500
    m = run(release_dir, {"practitioner": npi_row(vals), "organization": []})
    assert m["value"] == 0.5
    assert m["status"] == "fail"


def test_malformed_counts_invalid_not_crash(release_dir):
    m = run(release_dir, {"practitioner": npi_row(["12345678ab", "123", "1234567893"]), "organization": []})
    assert (m["numerator"], m["denominator"]) == (1, 3)


def test_empty_field_control_failed(release_dir):
    m = run(release_dir, {"practitioner": npi_row([None, None]),
                          "organization": []})
    assert m["status"] == "control_failed"


def h9_validate(npi):
    """Reimplementation of validate() in analysis/h9_npi_luhn.py: ^[12]\\d{9}$ plus Luhn on 80840 + NPI."""
    if not npi:
        return False
    if not re.match(r"^[12]\d{9}$", npi):
        return False
    total = 0
    for i, ch in enumerate(reversed("80840" + npi)):
        n = int(ch)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def luhn_only(npi):
    total = 0
    for i, ch in enumerate(reversed("80840" + npi)):
        n = int(ch)
        if i % 2 == 1:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def with_check(body9):
    for c in range(10):
        if luhn_only(body9 + str(c)):
            return body9 + str(c)
    raise AssertionError


def test_matches_h9_python(release_dir):
    rng = random.Random(9)

    def body(first):
        return first + "".join(str(rng.randrange(10)) for _ in range(8))

    npis = [with_check(body(rng.choice("12"))) for _ in range(2000)]
    for i in range(200):
        n = npis[i]
        npis[i] = n[:9] + str((int(n[9]) + 1) % 10)
    negatives = [with_check(body(rng.choice("0345678 9".replace(" ", "")))) for _ in range(100)]
    assert all(luhn_only(n) and not h9_validate(n) for n in negatives)
    npis += negatives + ["123", "abcdefghij", "12345678ab"]
    expected = sum(h9_validate(n) for n in npis)
    assert 1700 < expected < 1900
    m = run(release_dir, {"practitioner": npi_row(npis), "organization": []})
    assert m["numerator"] == expected
    assert m["denominator"] == len(npis)


def test_luhn_valid_first_digit_3_is_invalid(release_dir):
    n = with_check("312345678")
    assert luhn_only(n)
    m = run(release_dir, {"practitioner": npi_row([n, "1234567893"]), "organization": []})
    assert (m["numerator"], m["denominator"]) == (1, 2)
