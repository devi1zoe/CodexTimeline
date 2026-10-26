import json
import tempfile
import unittest
from pathlib import Path

import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import parse_rollout  # noqa: E402


class ParseRolloutTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixtures = PROJECT_ROOT / "tests" / "fixtures"

    def test_native_rollout_preserves_records_and_meta(self) -> None:
        path = self.fixtures / "native-rollout.jsonl"
        session = parse_rollout.parse_rollout(path)

        self.assertEqual(session["id"], "0199e5f2-05a4-7cb1-a8c1-2ff03f019a10")
        self.assertEqual(session["diagnostics"]["recordCount"], 11)
        self.assertEqual(session["diagnostics"]["parseErrors"], 0)
        self.assertEqual(session["diagnostics"]["schemaErrors"], 0)
        self.assertFalse(session["diagnostics"]["unstableSnapshot"])
        self.assertEqual(session["records"][0]["type"], "session_meta")
        self.assertEqual(session["recordLines"], list(range(1, 12)))
        self.assertEqual(len(session["recordRawLines"]), len(session["records"]))
        self.assertTrue(session["source"]["readOnly"])
        self.assertEqual(len(session["source"]["sha256"]), 64)
        self.assertEqual(session["source"]["logicalSize"], session["source"]["size"])

    def test_malformed_line_becomes_visible_diagnostic(self) -> None:
        path = self.fixtures / "malformed-rollout.jsonl"
        session = parse_rollout.parse_rollout(path)

        self.assertEqual(session["diagnostics"]["parseErrors"], 1)
        self.assertEqual(session["records"][1]["type"], "parse_error")
        self.assertEqual(session["records"][2]["payload"]["role"], "user")
        self.assertEqual(session["recordLines"], [1, 2, 3])

    def test_strict_bundle_rejects_malformed_input(self) -> None:
        path = self.fixtures / "malformed-rollout.jsonl"
        with self.assertRaises(parse_rollout.RolloutParseError):
            parse_rollout.build_bundle([path], strict=True)

    def test_u64_ordinal_bounds_are_enforced(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            valid = root / "rollout-u64.jsonl"
            invalid = root / "rollout-overflow.jsonl"
            valid.write_text(
                '{"timestamp":"2026-01-01T00:00:00Z","ordinal":18446744073709551615,"type":"session_meta","payload":{"id":"thread"}}\n',
                encoding="utf-8",
            )
            invalid.write_text(
                '{"timestamp":"2026-01-01T00:00:00Z","ordinal":18446744073709551616,"type":"session_meta","payload":{"id":"thread"}}\n',
                encoding="utf-8",
            )
            self.assertEqual(parse_rollout.parse_rollout(valid)["diagnostics"]["schemaErrors"], 0)
            self.assertEqual(parse_rollout.parse_rollout(invalid)["diagnostics"]["schemaErrors"], 1)
            with self.assertRaises(parse_rollout.RolloutParseError):
                parse_rollout.build_bundle([invalid], strict=True)

    def test_plain_rollout_wins_over_compressed_sibling(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plain = root / "rollout-example.jsonl"
            compressed = root / "rollout-example.jsonl.zst"
            plain.write_text("{}\n", encoding="utf-8")
            compressed.write_bytes(b"not-zstd")

            self.assertEqual(parse_rollout.discover_rollouts([root]), [plain.resolve()])

    def test_atomic_bundle_is_browser_loadable(self) -> None:
        source = self.fixtures / "native-rollout.jsonl"
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "bundle.json"
            bundle = parse_rollout.build_bundle([source])
            parse_rollout.write_bundle(bundle, output, force=False, pretty=False)
            loaded = json.loads(output.read_text(encoding="utf-8"))

            self.assertEqual(loaded["schemaVersion"], 2)
            self.assertEqual(loaded["diagnostics"]["sessionCount"], 1)
            self.assertEqual(len(loaded["sessions"][0]["records"]), 11)
            original = output.read_text(encoding="utf-8")
            with self.assertRaises(parse_rollout.RolloutParseError):
                parse_rollout.write_bundle(bundle, output, force=False, pretty=False)
            self.assertEqual(output.read_text(encoding="utf-8"), original)


if __name__ == "__main__":
    unittest.main()
