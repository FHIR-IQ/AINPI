"""NPI structural validity (H9). CC0 1.0."""
from ndh_quality.base import NdhRule, parquet_source


class NpiCheckDigit(NdhRule):
    rule_id = "npi-check-digit"
    rule_version = 1
    hypotheses = ["H9"]
    relation = "partial"  # H9 also covers NPPES agreement
    measure_name = "npi-validation-failures"
    severity = "expect"
    threshold = {"op": ">=", "value": 0.999, "source_text": "NPI structural validity is ≥99.9%"}
    resources = ["practitioner", "organization"]

    @classmethod
    def measure_sql(cls, settings) -> str:
        pr = parquet_source(settings["release_dir"], "practitioner")
        org = parquet_source(settings["release_dir"], "organization")
        return f"""
with n as (
  select cast(_npi as varchar) npi from {pr} where _npi is not null
  union all
  select cast(_npi as varchar) npi from {org} where _npi is not null
), v as (
  select coalesce(
    regexp_full_match(npi, '[0-9]{{10}}') and
    (10 - (24 + list_sum(list_transform(range(1, 10), lambda i:
       case when i % 2 = 1
            then (try_cast(substr(npi, i, 1) as int) * 2) // 10
               + (try_cast(substr(npi, i, 1) as int) * 2) % 10
            else try_cast(substr(npi, i, 1) as int) end))) % 10) % 10
    = try_cast(substr(npi, 10, 1) as int), false) ok
  from n
)
select count(*) filter (where ok) as numerator,
       count(*) as denominator,
       count(*) as control_count,
       'invalid=' || count(*) filter (where not ok) as detail
from v
"""
