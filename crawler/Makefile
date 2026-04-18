# ainpi-probe — run the FHIR endpoint liveness crawl
#
# Inputs:  data/endpoints.parquet (columns: endpoint_id, url)
#          OR pass --input-resource path/to/endpoint.parquet (raw NDH shard)
#
# Outputs: out/liveness.parquet (one row per probed endpoint)
#
# Crawl etiquette is baked into the defaults: 1 rps per host, 4 concurrent
# globally, 10s connect / 30s read timeout, exponential backoff on 429/503,
# named User-Agent with contact info. Override only with reason.

PYTHON ?= python3

.PHONY: help install probe probe-sample test clean

help:
	@echo "ainpi-probe targets:"
	@echo "  make install       — install Python deps into .venv"
	@echo "  make probe         — run the crawl against data/endpoints.parquet"
	@echo "  make probe-sample  — probe the first 50 endpoints (useful for dev)"
	@echo "  make test          — run unit tests"
	@echo "  make clean         — remove out/ (keeps data/)"

install:
	$(PYTHON) -m venv .venv
	.venv/bin/pip install --upgrade pip
	.venv/bin/pip install -r requirements.txt

probe:
	mkdir -p out
	$(PYTHON) probe.py --input data/endpoints.parquet --output out/liveness.parquet

probe-sample:
	mkdir -p out
	$(PYTHON) probe.py --input data/endpoints.parquet --output out/liveness-sample.parquet --limit 50

test:
	$(PYTHON) -m pytest tests/ -v

clean:
	rm -rf out
