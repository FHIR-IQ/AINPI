# AINPI pipeline orchestration
#
# Inputs:
#   data/raw/<Resource>-*.ndjson.zst   — CMS NPD bulk export (you download these)
#
# Outputs:
#   out/shards/<resource>.parquet      — after `make shard`
#   out/edges.parquet                  — after `make edges`
#   out/npi_luhn.parquet               — after `make luhn`
#   out/meta_lastupdated.parquet       — after `make temporal`
#
# Acceptance: every target is reproducible from a clean checkout given the
# same pinned NPD release artifact in `data/raw/`.

PYTHON ?= python3
DUCKDB ?= duckdb
RAW_DIR ?= data/raw
OUT_DIR ?= out

.PHONY: help
help:
	@echo "AINPI pipeline targets:"
	@echo "  make install    — install Python deps into a local .venv"
	@echo "  make shard      — stage 0: shard NDJSON by resourceType → Parquet"
	@echo "  make edges      — stage 1: extract (source, type, refPath, target) tuples"
	@echo "  make luhn       — stage 2: NPI Luhn validity check"
	@echo "  make temporal   — stage 3: meta.lastUpdated CDF"
	@echo "  make all        — run all stages in dependency order"
	@echo "  make clean      — remove out/ (keeps data/)"

.PHONY: install
install:
	$(PYTHON) -m venv .venv
	.venv/bin/pip install --upgrade pip
	.venv/bin/pip install -r requirements.txt

$(OUT_DIR):
	mkdir -p $(OUT_DIR)/shards

.PHONY: shard
shard: $(OUT_DIR)
	$(PYTHON) 0_shard_by_type.py --input $(RAW_DIR) --output $(OUT_DIR)/shards

.PHONY: edges
edges: $(OUT_DIR)
	$(DUCKDB) -c ".read 1_extract_edges.sql"

.PHONY: luhn
luhn: $(OUT_DIR)
	$(PYTHON) 2_npi_luhn.py --shards $(OUT_DIR)/shards --output $(OUT_DIR)/npi_luhn.parquet

.PHONY: temporal
temporal: $(OUT_DIR)
	$(DUCKDB) -c ".read 3_meta_lastupdated.sql"

.PHONY: all
all: shard edges luhn temporal

.PHONY: clean
clean:
	rm -rf $(OUT_DIR)
