"""Offline benchmark reproduction; raw data and DuckDB are supplied explicitly."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
BENCHMARK = HERE.parent


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_inputs(raw_dir, sources):
    for item in sources["dataset"]["files"]:
        path = raw_dir / item["path"]
        if not path.is_file() or path.stat().st_size != item["bytes"]:
            raise ValueError(f"Missing or wrong-size raw input: {path}")
        if file_sha256(path) != item["sha256"]:
            raise ValueError(f"Checksum mismatch: {path}")
    print("Raw input checksums: PASS", flush=True)


def compare_subset(expected, actual, label="root"):
    """Allow only floating-point interpolation noise, never missing keys/counts."""
    if isinstance(expected, dict):
        for key, value in expected.items():
            if key not in actual:
                raise AssertionError(f"Missing {label}.{key}")
            compare_subset(value, actual[key], f"{label}.{key}")
    elif isinstance(expected, list):
        if len(expected) != len(actual):
            raise AssertionError(f"Length mismatch: {label}")
        for index, value in enumerate(expected):
            compare_subset(value, actual[index], f"{label}[{index}]")
    elif isinstance(expected, float):
        if not isinstance(actual, (int, float)) or not math.isclose(expected, actual, rel_tol=1e-9, abs_tol=1e-9):
            raise AssertionError(f"Value mismatch: {label}: {expected} != {actual}")
    elif expected != actual:
        raise AssertionError(f"Mismatch: {label}: {expected} != {actual}")


def collect(work):
    files = {"comparison": "comparison.json", "sensitivity": "sensitivity.json",
             "native_exposure": "native-exposure.json", "candle_structure": "candle-structure.json",
             "hours_sensitivity": "hours-sensitivity.json"}
    return {key: read_json(work / name) for key, name in files.items()}


def compact_metrics(result):
    """One small reusable view, with explicit event/native exposure denominators."""
    additional = ["direction_changes_per_100_trades", "direction_changes_per_100_trades_by_path",
                  "buy_quote_sol_per_exposure_second", "sell_quote_sol_per_exposure_second",
                  "trades_per_active_episode_second_bin", "transaction_quote_sol",
                  "buy_transaction_quote_sol", "sell_transaction_quote_sol",
                  "buy_run_length_trades", "sell_run_length_trades"]
    datasets = {}
    for name, data in result["comparison"].items():
        paths = {}
        for stage, metrics in data["metrics"].items():
            paths[stage] = {key: metrics[key] for key in additional}
            paths[stage].update({key: metrics[key] for key in ["paths", "trades", "duration_sec",
                               "buy_count_share", "buy_volume_share", "drawdown_trade_pct"]})
        native = {}
        for stage, metrics in result["native_exposure"][name].items():
            candle = result["sensitivity"][name]["native_candles"][stage]
            native[stage] = {**metrics,
                "trades_per_active_native_second_bin": metrics["trades"] / metrics["active"] if metrics["active"] else None,
                "buy_quote_sol_per_native_exposed_second_bin": candle["buy_quote_sol"] / metrics["bins"] if metrics["bins"] else None,
                "sell_quote_sol_per_native_exposed_second_bin": candle["sell_quote_sol"] / metrics["bins"] if metrics["bins"] else None}
        datasets[name] = {"active_noninstant": data["active_noninstant"], "paths": paths, "native_seconds": native}
    return {"schemaVersion": 1, "sourceManifest": "sources.json", "definitions": "README.md#metric-contract",
            "availability": {"direction_changes_per_100_trades": True, "side_quote_per_second": True,
                             "trades_per_active_second": True, "individual_trade_sizes": True,
                             "buy_sell_streak_lengths": True},
            "unavailable": {"real_true_readiness": "No transfer-complete holder balances or launch-mode flags",
                            "real_intrasecond_waits": "Block timestamps have one-second resolution"},
            "datasets": datasets}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--duckdb", type=Path)
    parser.add_argument("--stage", choices=["prepare", "analyze", "verify", "all"], default="all")
    args = parser.parse_args()
    work, raw = args.work_dir.resolve(), args.raw_dir.resolve()
    # Large or partial outputs must never overwrite the versioned reference.
    if work == BENCHMARK or BENCHMARK in work.parents:
        parser.error("work-dir must be outside the versioned benchmark directory")
    work.mkdir(parents=True, exist_ok=True)
    sources = read_json(BENCHMARK / "sources.json")
    if args.stage in ["prepare", "all"]:
        if not args.duckdb:
            parser.error("--duckdb is required for Parquet preparation")
        verify_inputs(raw, sources)
        def sql_path(path):
            return path.as_posix().replace("'", "''")
        for filename in ["build.sql", "export.sql"]:
            sql = (HERE / filename).read_text(encoding="utf-8-sig")
            # Read raw Parquets separately from generated CSV/database outputs.
            for directory in ["data", "launches", "events", "graduations"]:
                sql = sql.replace(f"@WORK@/{directory}/", f"{sql_path(raw)}/{directory}/")
            sql = sql.replace("@WORK@", sql_path(work))
            subprocess.run([str(args.duckdb.resolve()), "-no-agent", str(work / "market.duckdb"), "-c", sql], check=True)
        checks = json.loads(subprocess.run(
            [str(args.duckdb.resolve()), "-no-agent", str(work / "market.duckdb"), "-json", "-c",
             (HERE / "validate.sql").read_text(encoding="utf-8")],
            capture_output=True, text=True, check=True).stdout)[0]
        for key in ["duplicate_keys", "backward_timestamps", "invalid_rows", "standard_invalid_progress"]:
            if checks[key] != 0:
                raise ValueError(f"Raw sequence integrity failed: {key}={checks[key]}")
        if checks["token_delta_error_max"] > 1e-5 or checks["standard_quote_delta_error_max"] > 1e-6:
            raise ValueError("Raw reserve/amount conservation failed")
        (work / "data-validation.json").write_text(json.dumps(checks, indent=2) + "\n", encoding="utf-8")
        print("Raw sequence integrity: PASS", flush=True)
    if args.stage in ["analyze", "all"]:
        for variant in ["A", "B"]:
            if not (work / f"sim-{variant}-tapes.json").is_file():
                parser.error(f"Missing {variant} tape; run extract-sim.mjs --work-dir first")
        env = {**os.environ, "SIM01_WORK_DIR": str(work), "PYTHONDONTWRITEBYTECODE": "1"}
        for filename in ["analyze.py", "sensitivity.py", "candle-structure.py", "native-exposure.py", "hours-sensitivity.py"]:
            subprocess.run([sys.executable, str(HERE / filename)], env=env, check=True)
    if args.stage in ["analyze", "verify", "all"]:
        result = collect(work)
        reference = read_json(BENCHMARK / "research-results.json")
        for key, value in result.items():
            compare_subset(reference[key], value, key)
        metrics = compact_metrics(result)
        normalized_reference = BENCHMARK / "metrics.json"
        if normalized_reference.exists():
            compare_subset(read_json(normalized_reference), metrics, "normalized_metrics")
        (work / "metrics.json").write_text(json.dumps(metrics, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        (work / "research-results.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        provenance = {"schemaVersion": 1, "python": sys.version,
                      "sourceManifestSha256": file_sha256(BENCHMARK / "sources.json"),
                      "scriptsSha256": {p.name: file_sha256(p) for p in sorted(HERE.iterdir()) if p.is_file()},
                      "resultsSha256": {name: file_sha256(work / name) for name in ["metrics.json", "research-results.json"]}}
        (work / "reproduction.json").write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
        print("Historical research values reproduced: PASS", flush=True)


if __name__ == "__main__":
    main()
