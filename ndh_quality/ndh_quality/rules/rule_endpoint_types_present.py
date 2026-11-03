"""Control: both expected endpoint connection types are in the export. CC0 1.0."""
from ndh_quality.base import NdhRule, parquet_source


class EndpointTypesPresent(NdhRule):
    rule_id = "endpoint-types-present"
    rule_version = 1
    hypotheses = []
    relation = "control"
    measure_name = None
    severity = "pipeline"
    threshold = {"op": "==", "value": 1.0,
                 "source_text": "Both hl7-fhir-rest and direct-project endpoint types are present."}
    resources = ["endpoint"]

    @classmethod
    def measure_sql(cls, settings) -> str:
        src = parquet_source(settings["release_dir"], "endpoint")
        return f"""
select (count(*) filter (where _connection_type = 'hl7-fhir-rest') > 0)::int
     + (count(*) filter (where _connection_type = 'direct-project') > 0)::int as numerator,
       2 as denominator,
       count(_connection_type) as control_count,
       'fhir_rest=' || count(*) filter (where _connection_type = 'hl7-fhir-rest')
       || ' direct_project=' || count(*) filter (where _connection_type = 'direct-project') as detail
from {src}
"""
