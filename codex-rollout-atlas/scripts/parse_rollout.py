#!/usr/bin/env python3
"""Build a browser-loadable bundle from Codex CLI rollout JSONL files.

The parser opens source rollouts read-only and never rewrites, renames, truncates,
or deletes them. Output is a separate JSON bundle accepted by Rollout Atlas.
"""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import hashlib
import io
import json
import os
import sys
import tempfile
from pathlib import Path


SCHEMA_VERSION = 2
TOOL_VERSION = "1.1.0"
SUPPORTED_SUFFIXES = (".jsonl", ".jsonl.zst")


class RolloutParseError(RuntimeError):
    """Raised when a rollout cannot be safely parsed or bundled."""


def is_rollout_path(path: Path) -> bool:
    name = path.name.lower()
    return name.endswith(SUPPORTED_SUFFIXES)


def canonical_plain_path(path: Path) -> Path:
    if path.name.lower().endswith(".jsonl.zst"):
        return path.with_suffix("")
    return path


def discover_rollouts(inputs: list[Path]) -> list[Path]:
    """Discover rollouts and prefer a plain sibling over its compressed copy."""
    candidates: dict[Path, Path] = {}
    for supplied in inputs:
        path = supplied.expanduser().resolve()
        if not path.exists():
            raise RolloutParseError(f"input does not exist: {path}")
        if path.is_file():
            if not is_rollout_path(path):
                raise RolloutParseError(f"unsupported input (expected .jsonl or .jsonl.zst): {path}")
            discovered = [path]
        else:
            discovered = sorted(
                candidate
                for candidate in path.rglob("*")
                if candidate.is_file()
                and is_rollout_path(candidate)
                and candidate.name.lower().startswith("rollout-")
            )
        for candidate in discovered:
            resolved = candidate.resolve()
            canonical = canonical_plain_path(resolved)
            previous = candidates.get(canonical)
            if previous is None or (previous.name.endswith(".zst") and not resolved.name.endswith(".zst")):
                candidates[canonical] = resolved
    return sorted(candidates.values(), key=lambda item: str(item).lower())


def read_rollout_snapshot(path: Path) -> tuple[bytes, bytes, str]:
    """Read one immutable-in-memory snapshot and decode its logical JSONL."""
    source_bytes = path.read_bytes()
    logical_bytes = source_bytes
    if not path.name.lower().endswith(".zst"):
        return source_bytes, logical_bytes, logical_bytes.decode("utf-8-sig")

    # Python 3.14 ships compression.zstd; older runtimes can use `zstandard`.
    try:
        from compression import zstd  # type: ignore[attr-defined, import-not-found]

        logical_bytes = zstd.decompress(source_bytes)
        return source_bytes, logical_bytes, logical_bytes.decode("utf-8-sig")
    except ImportError:
        pass

    try:
        import zstandard  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RolloutParseError(
            f"{path} is Zstandard-compressed. Use Python 3.14+ or install the optional "
            "'zstandard' package; the source file was not modified."
        ) from exc

    reader = zstandard.ZstdDecompressor().stream_reader(io.BytesIO(source_bytes))
    with contextlib.closing(reader):
        logical_bytes = reader.read()
    return source_bytes, logical_bytes, logical_bytes.decode("utf-8-sig")


def parse_rollout(path: Path, *, relative_to: Path | None = None) -> dict:
    before_stat = path.stat()
    source_bytes, logical_bytes, text = read_rollout_snapshot(path)
    after_stat = path.stat()
    records: list[dict] = []
    record_lines: list[int] = []
    record_raw_lines: list[str] = []
    issues: list[dict] = []
    blank_lines = 0
    parse_errors = 0
    schema_errors = 0
    meta: dict = {}

    def validate_envelope(value: dict) -> list[str]:
        errors: list[str] = []
        if not isinstance(value.get("timestamp"), str) or not value.get("timestamp"):
            errors.append("timestamp must be a non-empty string")
        if not isinstance(value.get("type"), str) or not value.get("type"):
            errors.append("type must be a non-empty string")
        if not isinstance(value.get("payload"), dict):
            errors.append("payload must be an object")
        ordinal = value.get("ordinal")
        if ordinal is not None and (
            not isinstance(ordinal, int)
            or isinstance(ordinal, bool)
            or ordinal < 0
            or ordinal > 18_446_744_073_709_551_615
        ):
            errors.append("ordinal must be a non-negative u64 integer when present")
        metadata = value.get("metadata")
        if metadata is not None and not isinstance(metadata, dict):
            errors.append("metadata must be an object when present")
        return errors

    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.strip():
            blank_lines += 1
            continue
        try:
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError("top-level JSON value must be an object")
            records.append(value)
            record_lines.append(line_number)
            record_raw_lines.append(line)
            envelope_errors = validate_envelope(value)
            if envelope_errors:
                schema_errors += 1
                issues.append(
                    {
                        "line": line_number,
                        "kind": "schema",
                        "error": "; ".join(envelope_errors),
                        "preview": line[:500] + ("…" if len(line) > 500 else ""),
                    }
                )
            if not meta and value.get("type") == "session_meta" and isinstance(value.get("payload"), dict):
                meta = value["payload"]
        except (json.JSONDecodeError, ValueError) as exc:
            parse_errors += 1
            issue = {
                "line": line_number,
                "kind": "parse",
                "error": str(exc),
                "preview": line[:500] + ("…" if len(line) > 500 else ""),
            }
            issues.append(issue)
            records.append(
                {
                    "timestamp": None,
                    "type": "parse_error",
                    "payload": {
                        "line": line_number,
                        "error": str(exc),
                        "raw": line[:8000] + ("…" if len(line) > 8000 else ""),
                    },
                    "__atlas_invalid": True,
                }
            )
            record_lines.append(line_number)
            record_raw_lines.append(line)

    if not records:
        schema_errors += 1
        issues.append({"line": None, "kind": "schema", "error": "rollout contains no records", "preview": ""})
    elif records[0].get("type") != "session_meta":
        schema_errors += 1
        issues.append(
            {
                "line": record_lines[0],
                "kind": "schema",
                "error": "first non-blank record must be session_meta",
                "preview": record_raw_lines[0][:500],
            }
        )

    unstable_snapshot = (
        before_stat.st_size != after_stat.st_size
        or before_stat.st_mtime_ns != after_stat.st_mtime_ns
    )
    try:
        display_path = str(path.relative_to(relative_to)) if relative_to else str(path)
    except ValueError:
        display_path = str(path)
    inferred_thread_id, inferred_rollout_id = infer_ids_from_name(path.name)
    session_id = str(meta.get("id") or meta.get("session_id") or inferred_thread_id)
    return {
        "id": session_id,
        "rolloutId": inferred_rollout_id,
        "fileName": canonical_plain_path(path).name,
        "source": {
            "path": display_path,
            "size": len(source_bytes),
            "logicalSize": len(logical_bytes),
            "sha256": hashlib.sha256(source_bytes).hexdigest(),
            "compressed": path.name.lower().endswith(".zst"),
            "readOnly": True,
            "modifiedAt": dt.datetime.fromtimestamp(after_stat.st_mtime, tz=dt.timezone.utc).isoformat(),
        },
        "meta": meta,
        "records": records,
        "recordLines": record_lines,
        "recordRawLines": record_raw_lines,
        "diagnostics": {
            "recordCount": len(records),
            "parseErrors": parse_errors,
            "schemaErrors": schema_errors,
            "unstableSnapshot": unstable_snapshot,
            "blankLines": blank_lines,
            "issues": issues,
        },
    }


def infer_ids_from_name(name: str) -> tuple[str, str]:
    stem = name.removesuffix(".zst").removesuffix(".jsonl")
    import re

    matches = re.findall(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", stem)
    return (matches[0] if matches else stem, matches[-1] if matches else stem)


def common_parent(paths: list[Path]) -> Path | None:
    if not paths:
        return None
    try:
        return Path(os.path.commonpath([str(path.parent) for path in paths]))
    except ValueError:
        return None


def build_bundle(paths: list[Path], *, strict: bool = False) -> dict:
    base = common_parent(paths)
    sessions = [parse_rollout(path, relative_to=base) for path in paths]
    parse_error_count = sum(session["diagnostics"]["parseErrors"] for session in sessions)
    schema_error_count = sum(session["diagnostics"]["schemaErrors"] for session in sessions)
    unstable_snapshot_count = sum(bool(session["diagnostics"]["unstableSnapshot"]) for session in sessions)
    if strict and parse_error_count + schema_error_count + unstable_snapshot_count:
        raise RolloutParseError(
            f"strict mode rejected {parse_error_count} malformed, {schema_error_count} schema-invalid, "
            f"and {unstable_snapshot_count} concurrently-changing rollout(s) across {len(sessions)} input(s)"
        )
    return {
        "schemaVersion": SCHEMA_VERSION,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "generator": {"name": "codex-rollout-atlas-parser", "version": TOOL_VERSION},
        "sourcePolicy": {
            "readOnly": True,
            "description": "Inputs were opened read-only and were not changed.",
        },
        "diagnostics": {
            "sessionCount": len(sessions),
            "recordCount": sum(len(session["records"]) for session in sessions),
            "parseErrors": parse_error_count,
            "schemaErrors": schema_error_count,
            "unstableSnapshots": unstable_snapshot_count,
        },
        "sessions": sessions,
    }


def write_bundle(bundle: dict, output: Path, *, force: bool, pretty: bool) -> None:
    output = output.expanduser().resolve()
    if output.exists() and not force:
        raise RolloutParseError(f"output already exists (pass --force to replace it): {output}")
    output.parent.mkdir(parents=True, exist_ok=True)

    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            newline="\n",
            dir=output.parent,
            prefix=f".{output.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_name = handle.name
            json.dump(
                bundle,
                handle,
                ensure_ascii=False,
                indent=2 if pretty else None,
                separators=None if pretty else (",", ":"),
            )
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        if force:
            os.replace(temporary_name, output)
        else:
            # Atomic no-clobber publication. If a target appeared after the
            # preflight check, link() fails and the existing file is preserved.
            os.link(temporary_name, output)
            Path(temporary_name).unlink()
        temporary_name = None
    finally:
        if temporary_name:
            with contextlib.suppress(OSError):
                Path(temporary_name).unlink()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Read Codex rollout JSONL files and create a Rollout Atlas bundle.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("inputs", nargs="+", type=Path, help="rollout .jsonl/.jsonl.zst files or directories")
    parser.add_argument("-o", "--output", required=True, type=Path, help="new bundle.json path")
    parser.add_argument("--force", action="store_true", help="replace an existing output bundle")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="fail on malformed JSON, invalid envelopes, or changing inputs",
    )
    parser.add_argument("--pretty", action="store_true", help="indent the output JSON for inspection")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        paths = discover_rollouts(args.inputs)
        if not paths:
            raise RolloutParseError("no rollout .jsonl or .jsonl.zst files were found")
        output = args.output.expanduser().resolve()
        source_paths = {path.resolve() for path in paths}
        if output in source_paths:
            raise RolloutParseError("output path resolves to an input rollout; refusing to overwrite a source file")
        bundle = build_bundle(paths, strict=args.strict)
        write_bundle(bundle, output, force=args.force, pretty=args.pretty)
    except (OSError, UnicodeError, RolloutParseError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    diagnostics = bundle["diagnostics"]
    print(
        f"wrote {output} — {diagnostics['sessionCount']} session(s), "
        f"{diagnostics['recordCount']} record(s), {diagnostics['parseErrors']} parse error(s), "
        f"{diagnostics['schemaErrors']} schema error(s)"
    )
    print("source rollouts were opened read-only and were not modified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
