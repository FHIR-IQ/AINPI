"""PractitionerRole references resolve inside the export (H6-H8, role side). CC0 1.0."""
from ndh_quality.base import NdhRule, parquet_source


class RoleReferencesResolve(NdhRule):
    rule_id = "role-references-resolve"
    rule_version = 1
    hypotheses = ["H6", "H7", "H8"]
    relation = "partial"  # role references only
    measure_name = None
    severity = "expect"
    threshold = {"op": ">=", "value": 0.99,
                 "source_text": "Cross-resource references resolve at ≥99% inside the bulk export."}
    resources = ["practitioner_role", "practitioner", "organization"]

    @classmethod
    def measure_sql(cls, settings) -> str:
        d = settings["release_dir"]
        return f"""
with r as (select cast(_practitioner_id as varchar) pid, cast(_org_id as varchar) oid
           from {parquet_source(d, 'practitioner_role')}),
     p as (select distinct 'Practitioner/' || _id ref from {parquet_source(d, 'practitioner')}),
     o as (select distinct 'Organization/' || _id ref from {parquet_source(d, 'organization')}),
     j as (select r.pid, r.oid, p.ref pref, o.ref oref
           from r left join p on r.pid = p.ref left join o on r.oid = o.ref),
     c as (select count(pid) prefs,
                  count(oid) orefs,
                  count(*) filter (where pid is not null and pref is null) dp,
                  count(*) filter (where oid is not null and oref is null) do_
           from j)
select (prefs - dp) + (orefs - do_) as numerator,
       prefs + orefs as denominator,
       prefs as control_count,
       'dangling_practitioner=' || dp || ' dangling_org=' || do_ as detail
from c
"""
