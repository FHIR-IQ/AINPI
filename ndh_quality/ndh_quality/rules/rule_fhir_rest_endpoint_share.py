"""Share of endpoints an integrator can GET (H28). CC0 1.0."""
from ndh_quality.base import NdhRule, parquet_source


class FhirRestEndpointShare(NdhRule):
    rule_id = "fhir-rest-endpoint-share"
    rule_version = 1
    hypotheses = ["H28"]
    relation = "implements"
    measure_name = "fhir-rest-endpoint-share"
    severity = "monitor"
    threshold = None
    resources = ["endpoint"]

    @classmethod
    def measure_sql(cls, settings) -> str:
        src = parquet_source(settings["release_dir"], "endpoint")
        return f"""
select count(*) filter (where _connection_type = 'hl7-fhir-rest') as numerator,
       count(*) as denominator,
       count(_connection_type) as control_count,
       'typed=' || count(_connection_type) as detail
from {src}
"""
