"""FHIR REST endpoints that name an organization present in the file (H50). CC0 1.0."""
from ndh_quality.base import NdhRule, parquet_source


class EndpointOrgLinkage(NdhRule):
    rule_id = "endpoint-org-linkage"
    rule_version = 1
    hypotheses = ["H50"]
    relation = "implements"
    measure_name = "endpoint-org-linkage"
    severity = "monitor"
    threshold = None
    resources = ["endpoint", "organization"]

    @classmethod
    def measure_sql(cls, settings) -> str:
        d = settings["release_dir"]
        return f"""
with e as (select cast(_managing_org_id as varchar) m from {parquet_source(d, 'endpoint')}
           where _connection_type = 'hl7-fhir-rest'),
     o as (select distinct 'Organization/' || _id ref from {parquet_source(d, 'organization')})
select count(o.ref) as numerator,
       count(*) as denominator,
       count(*) as control_count,
       'with_reference=' || count(e.m) as detail
from e left join o on e.m = o.ref
"""
