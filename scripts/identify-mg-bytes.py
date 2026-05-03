#!/usr/bin/env python3
"""Identify which byte slice of a multi-byte hex column carries the live signal.

Reads one or more raw__*.csv files produced by obd2-logger, splits each
multi-byte column (≥3 bytes typical) into per-byte and adjacent-byte-pair
candidate signals, and reports for each:

  1. Pearson correlation against throttle_pos / engine_load / rpm / speed.
  2. Bucket means across idle / cruise / accel windows (bucketed by throttle_pos).
  3. (multi-file) Per-file range of each slice + best correlation across files.

The slice with the highest |correlation| against a state signal that *also*
splits cleanly across buckets is the live signal. Slices with range 0 are
markers; slices that drift slowly without correlating are counters.

Usage:
    scripts/identify-mg-bytes.py path/to/raw__SESSION.csv [more.csv ...]
"""

from __future__ import annotations

import csv
import math
import sys
from collections import OrderedDict
from pathlib import Path

REF_COLS = ("throttle_pos", "engine_load", "rpm", "speed")
IDLE_MAX = 0x29
CRUISE_MAX = 0x49
MIN_TARGET_BYTES = 3  # auto-pick columns whose median hex length is ≥ 6 chars


def hex_to_int(s: str) -> int | None:
    s = s.strip()
    if not s:
        return None
    try:
        return int(s, 16)
    except ValueError:
        return None


def slice_bytes(hex_str: str) -> list[int] | None:
    s = hex_str.strip()
    if not s or len(s) % 2:
        return None
    try:
        return [int(s[i : i + 2], 16) for i in range(0, len(s), 2)]
    except ValueError:
        return None


def pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 3:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx2 = sum((x - mx) ** 2 for x in xs)
    dy2 = sum((y - my) ** 2 for y in ys)
    if dx2 == 0 or dy2 == 0:
        return None
    return num / math.sqrt(dx2 * dy2)


def candidate_slices(byte_rows: list[list[int]]) -> dict[str, list[int]]:
    n = len(byte_rows[0])
    if any(len(r) != n for r in byte_rows):
        return {}
    labels = [chr(ord("A") + i) for i in range(n)]
    out: dict[str, list[int]] = OrderedDict()
    for i in range(n):
        out[labels[i]] = [r[i] for r in byte_rows]
    for i in range(n - 1):
        out[labels[i] + labels[i + 1]] = [(r[i] << 8) | r[i + 1] for r in byte_rows]
    return out


def bucket_label(t: int) -> str:
    if t <= IDLE_MAX:
        return "idle"
    if t <= CRUISE_MAX:
        return "cruise"
    return "accel"


def discover_target_cols(rows: list[dict[str, str]]) -> list[str]:
    """Pick columns whose median non-empty hex length is ≥ MIN_TARGET_BYTES * 2."""
    if not rows:
        return []
    cols: list[str] = []
    for col in rows[0].keys():
        if col in REF_COLS or col in {"timestamp_utc", "session_elapsed_ms",
                                      "session_id", "vehicle_slug", "profile_id"}:
            continue
        lengths = [len(r.get(col, "").strip()) for r in rows if r.get(col, "").strip()]
        if not lengths:
            continue
        lengths.sort()
        median = lengths[len(lengths) // 2]
        if median >= MIN_TARGET_BYTES * 2:
            cols.append(col)
    return cols


def analyze_column(rows: list[dict[str, str]], col: str) -> dict | None:
    per_row = [slice_bytes(r.get(col, "")) for r in rows]
    keep = [i for i, b in enumerate(per_row) if b is not None]
    if not keep:
        return None
    byte_rows = [per_row[i] for i in keep]
    slices = candidate_slices(byte_rows)
    if not slices:
        return None

    refs = {name: [hex_to_int(rows[i].get(name, "")) for i in keep] for name in REF_COLS}

    corrs: dict[str, dict[str, float | None]] = {}
    for sname, svals in slices.items():
        corrs[sname] = {}
        for ref in REF_COLS:
            paired = [(svals[i], refs[ref][i]) for i in range(len(svals)) if refs[ref][i] is not None]
            if len(paired) < 3:
                corrs[sname][ref] = None
                continue
            corrs[sname][ref] = pearson([p[0] for p in paired], [p[1] for p in paired])

    throttle = refs["throttle_pos"]
    buckets: dict[str, list[int]] = {"idle": [], "cruise": [], "accel": []}
    for i, t in enumerate(throttle):
        if t is not None:
            buckets[bucket_label(t)].append(i)
    bucket_means: dict[str, dict[str, float]] = {}
    for sname, svals in slices.items():
        bucket_means[sname] = {
            b: (sum(svals[i] for i in idxs) / len(idxs)) if idxs else float("nan")
            for b, idxs in buckets.items()
        }

    return {
        "n_rows": len(byte_rows),
        "n_bytes": len(byte_rows[0]),
        "slices": slices,
        "corrs": corrs,
        "bucket_sizes": {b: len(idxs) for b, idxs in buckets.items()},
        "bucket_means": bucket_means,
    }


def fmt_corr(c: float | None) -> str:
    if c is None:
        return "flat"
    return f"{c:+.2f}"


def best_corr(corrs: dict[str, float | None]) -> tuple[str, float] | None:
    candidates = [(ref, c) for ref, c in corrs.items() if c is not None]
    if not candidates:
        return None
    ref, c = max(candidates, key=lambda x: abs(x[1]))
    return ref, c


def print_file(path: Path, file_data: dict[str, dict]) -> None:
    print(f"\n{'=' * 78}\n{path.name}\n{'=' * 78}")
    for col, data in file_data.items():
        print(f"\n[{col}]  {data['n_rows']} rows × {data['n_bytes']} bytes")
        slices = data["slices"]
        corrs = data["corrs"]
        print("  " + f"{'slice':<6}" + "".join(f"{r:>10}" for r in REF_COLS) +
              f"  {'min':>6}{'max':>6}{'range':>7}")
        for sname, svals in slices.items():
            line = f"  {sname:<6}"
            for ref in REF_COLS:
                line += f"{fmt_corr(corrs[sname][ref]):>10}"
            line += f"  {min(svals):>6}{max(svals):>6}{max(svals) - min(svals):>7}"
            print(line)
        sizes = data["bucket_sizes"]
        if all(sizes.values()):
            print(f"  bucket means (idle n={sizes['idle']}, cruise n={sizes['cruise']}, accel n={sizes['accel']}):")
            print(f"    {'slice':<6}{'idle':>10}{'cruise':>10}{'accel':>10}{'Δaccel-idle':>14}")
            for sname in slices:
                m = data["bucket_means"][sname]
                print(f"    {sname:<6}{m['idle']:>10.1f}{m['cruise']:>10.1f}{m['accel']:>10.1f}{m['accel'] - m['idle']:>+14.1f}")
        else:
            empty = [b for b, n in sizes.items() if n == 0]
            print(f"  (skipping bucket means: empty {empty})")


def classify(slice_ranges: list[int], best: tuple[str, float] | None) -> str:
    """Heuristic classification for a slice given its per-file ranges + best corr."""
    max_range = max(slice_ranges) if slice_ranges else 0
    if max_range == 0:
        return "MARKER (constant)"
    if best is not None and abs(best[1]) >= 0.7:
        return f"SIGNAL ({best[0]} {best[1]:+.2f})"
    if best is not None and abs(best[1]) >= 0.4:
        return f"likely signal ({best[0]} {best[1]:+.2f})"
    if max_range <= 8:
        return "drift/counter"
    if max_range >= 200 and (best is None or abs(best[1]) < 0.2):
        return "noise / LSB"
    return "—"


def print_comparison(per_file: dict[Path, dict[str, dict]]) -> None:
    print(f"\n\n{'#' * 78}\n# Cross-file comparison ({len(per_file)} files)\n{'#' * 78}")

    all_cols: dict[str, list[Path]] = OrderedDict()
    for path, data in per_file.items():
        for col in data:
            all_cols.setdefault(col, []).append(path)

    paths = list(per_file.keys())
    short_names = [p.name.replace("raw__", "").replace(".csv", "") for p in paths]
    name_w = max(len(n) for n in short_names)

    for col, files_with in all_cols.items():
        present_in = len(files_with)
        marker = "" if present_in == len(paths) else f"   (only in {present_in}/{len(paths)} files)"
        print(f"\n[{col}]{marker}")

        # Collect data per file (None where missing)
        per_file_data = [per_file[p].get(col) for p in paths]

        # Slice union (some files may have different byte counts; warn if so)
        byte_counts = [d["n_bytes"] for d in per_file_data if d is not None]
        if len(set(byte_counts)) > 1:
            print(f"  inconsistent byte counts across files: {byte_counts} — skipping")
            continue

        if not per_file_data or all(d is None for d in per_file_data):
            continue
        ref_data = next(d for d in per_file_data if d is not None)
        slice_names = list(ref_data["slices"].keys())

        # Header: slice | per-file [min,max] | best corr (which file)
        hdr = f"  {'slice':<6}"
        for n in short_names:
            hdr += f" {n:>{name_w + 2}}"
        hdr += f"  {'best corr':>20}  class"
        print(hdr)

        for sname in slice_names:
            line = f"  {sname:<6}"
            ranges: list[int] = []
            best_overall: tuple[str, float] | None = None
            for d in per_file_data:
                if d is None:
                    line += f" {'—':>{name_w + 2}}"
                    continue
                svals = d["slices"][sname]
                lo, hi = min(svals), max(svals)
                ranges.append(hi - lo)
                if hi == lo:
                    cell = f"={lo}"
                else:
                    cell = f"[{lo},{hi}]"
                line += f" {cell:>{name_w + 2}}"
                b = best_corr(d["corrs"][sname])
                if b is not None and (best_overall is None or abs(b[1]) > abs(best_overall[1])):
                    best_overall = b
            best_str = f"{best_overall[0]}:{best_overall[1]:+.2f}" if best_overall else "—"
            line += f"  {best_str:>20}  {classify(ranges, best_overall)}"
            print(line)


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2

    per_file: dict[Path, dict[str, dict]] = OrderedDict()
    for arg in sys.argv[1:]:
        path = Path(arg)
        with path.open() as f:
            rows = list(csv.DictReader(f))
        target_cols = discover_target_cols(rows)
        file_data: dict[str, dict] = OrderedDict()
        for col in target_cols:
            d = analyze_column(rows, col)
            if d is not None:
                file_data[col] = d
        per_file[path] = file_data
        print_file(path, file_data)

    if len(per_file) > 1:
        print_comparison(per_file)
    return 0


if __name__ == "__main__":
    sys.exit(main())
