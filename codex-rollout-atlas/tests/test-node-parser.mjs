import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  RolloutParseError,
  buildBundle,
  discoverRollouts,
  parseRollout,
  writeBundle,
} from "../scripts/parse-rollout.mjs";

const projectRoot = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const fixtures = join(projectRoot, "tests", "fixtures");

test("native rollout preserves records, metadata, and source digest", () => {
  const session = parseRollout(join(fixtures, "native-rollout.jsonl"));
  assert.equal(session.id, "0199e5f2-05a4-7cb1-a8c1-2ff03f019a10");
  assert.equal(session.diagnostics.recordCount, 11);
  assert.equal(session.diagnostics.parseErrors, 0);
  assert.equal(session.diagnostics.schemaErrors, 0);
  assert.equal(session.diagnostics.unstableSnapshot, false);
  assert.equal(session.records[0].type, "session_meta");
  assert.deepEqual(session.recordLines, Array.from({ length: 11 }, (_, index) => index + 1));
  assert.equal(session.recordRawLines.length, session.records.length);
  assert.equal(session.recordRawLines[0], readFileSync(join(fixtures, "native-rollout.jsonl"), "utf8").split(/\r?\n/)[0]);
  assert.equal(session.source.readOnly, true);
  assert.equal(session.source.sha256.length, 64);
  assert.equal(session.source.logicalSize, session.source.size);
});

test("malformed lines remain visible and parsing continues", () => {
  const session = parseRollout(join(fixtures, "malformed-rollout.jsonl"));
  assert.equal(session.diagnostics.parseErrors, 1);
  assert.equal(session.records[1].type, "parse_error");
  assert.equal(session.records[2].payload.role, "user");
  assert.deepEqual(session.recordLines, [1, 2, 3]);
});

test("strict mode rejects malformed input", () => {
  assert.throws(
    () => buildBundle([join(fixtures, "malformed-rollout.jsonl")], { strict: true }),
    RolloutParseError,
  );
});

test("u64 ordinals are validated from the original numeric token", () => {
  const root = mkdtempSync(join(tmpdir(), "rollout-atlas-"));
  try {
    const valid = join(root, "rollout-u64.jsonl");
    const invalid = join(root, "rollout-overflow.jsonl");
    writeFileSync(valid, '{"timestamp":"2026-01-01T00:00:00Z","ordinal":18446744073709551615,"type":"session_meta","payload":{"id":"thread"}}\n', "utf8");
    writeFileSync(invalid, '{"timestamp":"2026-01-01T00:00:00Z","ordinal":18446744073709551616,"type":"session_meta","payload":{"id":"thread"}}\n', "utf8");
    const validSession = parseRollout(valid);
    assert.equal(validSession.diagnostics.schemaErrors, 0);
    assert.match(validSession.recordRawLines[0], /18446744073709551615/);
    assert.equal(parseRollout(invalid).diagnostics.schemaErrors, 1);
    assert.throws(() => buildBundle([invalid], { strict: true }), RolloutParseError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plain rollout wins over a compressed sibling", () => {
  const root = mkdtempSync(join(tmpdir(), "rollout-atlas-"));
  try {
    const plain = join(root, "rollout-example.jsonl");
    writeFileSync(plain, "{}\n", "utf8");
    writeFileSync(`${plain}.zst`, "not-zstd", "utf8");
    assert.deepEqual(discoverRollouts([root]), [resolve(plain)]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("atomic output is browser-loadable", () => {
  const root = mkdtempSync(join(tmpdir(), "rollout-atlas-"));
  try {
    const output = join(root, "bundle.json");
    const bundle = buildBundle([join(fixtures, "native-rollout.jsonl")]);
    writeBundle(bundle, output);
    const loaded = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(loaded.schemaVersion, 2);
    assert.equal(loaded.diagnostics.sessionCount, 1);
    assert.equal(loaded.sessions[0].records.length, 11);
    const original = readFileSync(output, "utf8");
    assert.throws(() => writeBundle(bundle, output), RolloutParseError);
    assert.equal(readFileSync(output, "utf8"), original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
