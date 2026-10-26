#!/usr/bin/env node

/**
 * Build a browser-loadable bundle from Codex CLI rollout JSONL files.
 * Source rollouts are opened read-only and never rewritten.
 */

import {
  closeSync,
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import * as zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SCHEMA_VERSION = 2;
export const TOOL_VERSION = "1.1.0";

export class RolloutParseError extends Error {}

export function isRolloutPath(path) {
  const lower = path.toLowerCase();
  return lower.endsWith(".jsonl") || lower.endsWith(".jsonl.zst");
}

function canonicalPlainPath(path) {
  return path.toLowerCase().endsWith(".jsonl.zst") ? path.slice(0, -4) : path;
}

function walk(root, result) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) walk(path, result);
    else if (entry.isFile() && isRolloutPath(path) && entry.name.toLowerCase().startsWith("rollout-")) result.push(resolve(path));
  }
}

export function discoverRollouts(inputs) {
  const candidates = new Map();
  for (const supplied of inputs) {
    const path = resolve(supplied);
    if (!existsSync(path)) throw new RolloutParseError(`input does not exist: ${path}`);
    const discovered = [];
    if (lstatSync(path).isDirectory()) walk(path, discovered);
    else if (isRolloutPath(path)) discovered.push(path);
    else throw new RolloutParseError(`unsupported input (expected .jsonl or .jsonl.zst): ${path}`);

    for (const candidate of discovered) {
      const realCandidate = realpathSync(candidate);
      const canonical = canonicalPlainPath(realCandidate);
      const previous = candidates.get(canonical);
      if (!previous || (previous.toLowerCase().endsWith(".zst") && !realCandidate.toLowerCase().endsWith(".zst"))) candidates.set(canonical, realCandidate);
    }
  }
  return [...candidates.values()].sort((a, b) => a.localeCompare(b));
}

function readSource(path) {
  const sourceBytes = readFileSync(path);
  let logicalBytes = sourceBytes;
  if (!path.toLowerCase().endsWith(".zst")) {
    return { sourceBytes, logicalBytes, text: new TextDecoder("utf-8", { fatal: true }).decode(logicalBytes).replace(/^\uFEFF/, "") };
  }
  if (typeof zlib.zstdDecompressSync !== "function") {
    throw new RolloutParseError(
      `${path} is Zstandard-compressed. This Node runtime has no Zstandard decoder; ` +
        "use a current Node release with zstd support or the Python parser with the optional 'zstandard' package.",
    );
  }
  logicalBytes = zlib.zstdDecompressSync(sourceBytes);
  return { sourceBytes, logicalBytes, text: new TextDecoder("utf-8", { fatal: true }).decode(logicalBytes).replace(/^\uFEFF/, "") };
}

function idsFromName(name) {
  const stem = name.replace(/\.zst$/i, "").replace(/\.jsonl$/i, "");
  const matches = [...stem.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)].map((match) => match[0]);
  return { threadId: matches[0] || stem, rolloutId: matches.at(-1) || stem };
}

function extractTopLevelNumberLexeme(json, propertyName) {
  let depth = 0;
  for (let index = 0; index < json.length; index += 1) {
    const char = json[index];
    if (char === '"') {
      const start = index;
      index += 1;
      let escaped = false;
      while (index < json.length) {
        const current = json[index];
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === '"') break;
        index += 1;
      }
      if (index >= json.length || depth !== 1) continue;
      let key;
      try {
        key = JSON.parse(json.slice(start, index + 1));
      } catch {
        continue;
      }
      if (key !== propertyName) continue;
      let cursor = index + 1;
      while (/\s/.test(json[cursor] || "")) cursor += 1;
      if (json[cursor] !== ":") continue;
      cursor += 1;
      while (/\s/.test(json[cursor] || "")) cursor += 1;
      return json.slice(cursor).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)?.[0] || null;
    }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") depth -= 1;
  }
  return null;
}

function validateEnvelope(value, rawLine) {
  const errors = [];
  if (typeof value.timestamp !== "string" || !value.timestamp) errors.push("timestamp must be a non-empty string");
  if (typeof value.type !== "string" || !value.type) errors.push("type must be a non-empty string");
  if (!value.payload || typeof value.payload !== "object" || Array.isArray(value.payload)) errors.push("payload must be an object");
  if (value.ordinal !== undefined && value.ordinal !== null) {
    const lexeme = extractTopLevelNumberLexeme(rawLine, "ordinal");
    try {
      if (lexeme === null || !/^(?:0|[1-9]\d*)$/.test(lexeme) || BigInt(lexeme) > 18_446_744_073_709_551_615n) throw new Error("invalid u64");
    } catch {
      errors.push("ordinal must be a non-negative u64 integer when present");
    }
  }
  if (value.metadata !== undefined && value.metadata !== null && (typeof value.metadata !== "object" || Array.isArray(value.metadata))) {
    errors.push("metadata must be an object when present");
  }
  return errors;
}

export function parseRollout(path, relativeTo = null) {
  const resolved = resolve(path);
  const before = statSync(resolved);
  const snapshot = readSource(resolved);
  const after = statSync(resolved);
  const { text } = snapshot;
  const records = [];
  const recordLines = [];
  const recordRawLines = [];
  const issues = [];
  let blankLines = 0;
  let parseErrors = 0;
  let schemaErrors = 0;
  let meta = {};

  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (!line.trim()) {
      blankLines += 1;
      return;
    }
    try {
      const value = JSON.parse(line);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("top-level JSON value must be an object");
      }
      records.push(value);
      recordLines.push(lineNumber);
      recordRawLines.push(line);
      const envelopeErrors = validateEnvelope(value, line);
      if (envelopeErrors.length) {
        schemaErrors += 1;
        issues.push({ line: lineNumber, kind: "schema", error: envelopeErrors.join("; "), preview: `${line.slice(0, 500)}${line.length > 500 ? "…" : ""}` });
      }
      if (!Object.keys(meta).length && value.type === "session_meta" && value.payload && typeof value.payload === "object") {
        meta = value.payload;
      }
    } catch (error) {
      parseErrors += 1;
      const message = error instanceof Error ? error.message : String(error);
      issues.push({ line: lineNumber, kind: "parse", error: message, preview: `${line.slice(0, 500)}${line.length > 500 ? "…" : ""}` });
      records.push({
        timestamp: null,
        type: "parse_error",
        payload: { line: lineNumber, error: message, raw: `${line.slice(0, 8000)}${line.length > 8000 ? "…" : ""}` },
        __atlas_invalid: true,
      });
      recordLines.push(lineNumber);
      recordRawLines.push(line);
    }
  });

  if (!records.length) {
    schemaErrors += 1;
    issues.push({ line: null, kind: "schema", error: "rollout contains no records", preview: "" });
  } else if (records[0].type !== "session_meta") {
    schemaErrors += 1;
    issues.push({ line: recordLines[0], kind: "schema", error: "first non-blank record must be session_meta", preview: recordRawLines[0].slice(0, 500) });
  }

  const unstableSnapshot = before.size !== after.size || before.mtimeMs !== after.mtimeMs;
  const displayPath = relativeTo ? relative(relativeTo, resolved) || basename(resolved) : resolved;
  return {
    id: String(meta.id || meta.session_id || idsFromName(basename(resolved)).threadId),
    rolloutId: idsFromName(basename(resolved)).rolloutId,
    fileName: basename(canonicalPlainPath(resolved)),
    source: {
      path: displayPath,
      size: snapshot.sourceBytes.length,
      logicalSize: snapshot.logicalBytes.length,
      sha256: createHash("sha256").update(snapshot.sourceBytes).digest("hex"),
      compressed: resolved.toLowerCase().endsWith(".zst"),
      readOnly: true,
      modifiedAt: after.mtime.toISOString(),
    },
    meta,
    records,
    recordLines,
    recordRawLines,
    diagnostics: {
      recordCount: records.length,
      parseErrors,
      schemaErrors,
      unstableSnapshot,
      blankLines,
      issues,
    },
  };
}

function commonParent(paths) {
  if (!paths.length) return null;
  let parts = dirname(resolve(paths[0])).split(/[\\/]/);
  for (const path of paths.slice(1)) {
    const next = dirname(resolve(path)).split(/[\\/]/);
    let index = 0;
    while (
      index < parts.length &&
      index < next.length &&
      (process.platform === "win32" ? parts[index].toLowerCase() === next[index].toLowerCase() : parts[index] === next[index])
    ) index += 1;
    parts = parts.slice(0, index);
  }
  if (!parts.length) return null;
  const joined = parts.join(process.platform === "win32" ? "\\" : "/");
  return isAbsolute(joined) ? joined : `${parts[0]}${process.platform === "win32" ? "\\" : "/"}${parts.slice(1).join(process.platform === "win32" ? "\\" : "/")}`;
}

export function buildBundle(paths, { strict = false } = {}) {
  const base = commonParent(paths);
  const sessions = paths.map((path) => parseRollout(path, base));
  const parseErrors = sessions.reduce((sum, session) => sum + session.diagnostics.parseErrors, 0);
  const schemaErrors = sessions.reduce((sum, session) => sum + session.diagnostics.schemaErrors, 0);
  const unstableSnapshots = sessions.filter((session) => session.diagnostics.unstableSnapshot).length;
  if (strict && parseErrors + schemaErrors + unstableSnapshots) {
    throw new RolloutParseError(
      `strict mode rejected ${parseErrors} malformed, ${schemaErrors} schema-invalid, and ` +
        `${unstableSnapshots} concurrently-changing rollout(s) across ${sessions.length} input(s)`,
    );
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    generator: { name: "codex-rollout-atlas-parser", version: TOOL_VERSION, runtime: "node" },
    sourcePolicy: { readOnly: true, description: "Inputs were opened read-only and were not changed." },
    diagnostics: {
      sessionCount: sessions.length,
      recordCount: sessions.reduce((sum, session) => sum + session.records.length, 0),
      parseErrors,
      schemaErrors,
      unstableSnapshots,
    },
    sessions,
  };
}

export function writeBundle(bundle, outputPath, { force = false, pretty = false } = {}) {
  const output = resolve(outputPath);
  if (existsSync(output) && !force) throw new RolloutParseError(`output already exists (pass --force to replace it): ${output}`);
  mkdirSync(dirname(output), { recursive: true });
  const temporary = join(dirname(output), `.${basename(output)}.${process.pid}.${randomBytes(5).toString("hex")}.tmp`);
  const json = `${JSON.stringify(bundle, null, pretty ? 2 : 0)}\n`;
  let descriptor = null;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, json, "utf8");
    closeSync(descriptor);
    descriptor = null;
    if (!force) {
      // Atomic no-clobber publication: the hard-link operation fails if a
      // target appeared after the earlier existence check.
      linkSync(temporary, output);
    } else {
      try {
        renameSync(temporary, output);
      } catch (error) {
        if (!existsSync(output) || !["EEXIST", "EPERM", "EACCES"].includes(error?.code)) throw error;
        // Windows cannot atomically rename over an existing file. Preserve the
        // old bundle until the new one is in place, and restore it on failure.
        const backup = join(dirname(output), `.${basename(output)}.${process.pid}.${randomBytes(5).toString("hex")}.bak`);
        renameSync(output, backup);
        try {
          renameSync(temporary, output);
          rmSync(backup, { force: true });
        } catch (replacementError) {
          if (!existsSync(output) && existsSync(backup)) renameSync(backup, output);
          throw replacementError;
        }
      }
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function usage() {
  return `Usage: node scripts/parse-rollout.mjs <file-or-directory> [...] -o <bundle.json> [options]

Options:
  -o, --output <path>  Separate output bundle (required)
  --force              Replace an existing output bundle
  --strict             Fail on malformed JSON, invalid envelopes, or changing inputs
  --pretty             Indent output JSON
  -h, --help           Show this help

Inputs are opened read-only and never modified.`;
}

function parseArgs(argv) {
  const options = { inputs: [], output: null, force: false, strict: false, pretty: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") return { help: true };
    if (arg === "-o" || arg === "--output") {
      options.output = argv[index + 1];
      index += 1;
    } else if (arg === "--force") options.force = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--pretty") options.pretty = true;
    else if (arg.startsWith("-")) throw new RolloutParseError(`unknown option: ${arg}`);
    else options.inputs.push(arg);
  }
  if (!options.output) throw new RolloutParseError("--output is required");
  if (!options.inputs.length) throw new RolloutParseError("at least one input file or directory is required");
  return options;
}

export function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      console.log(usage());
      return 0;
    }
    const paths = discoverRollouts(args.inputs);
    if (!paths.length) throw new RolloutParseError("no rollout .jsonl or .jsonl.zst files were found");
    const output = resolve(args.output);
    const outputIdentity = existsSync(output) ? realpathSync(output) : output;
    if (new Set(paths.map((path) => realpathSync(path))).has(outputIdentity)) {
      throw new RolloutParseError("output path resolves to an input rollout; refusing to overwrite a source file");
    }
    const bundle = buildBundle(paths, { strict: args.strict });
    writeBundle(bundle, output, { force: args.force, pretty: args.pretty });
    const diagnostics = bundle.diagnostics;
    console.log(
      `wrote ${output} — ${diagnostics.sessionCount} session(s), ` +
        `${diagnostics.recordCount} record(s), ${diagnostics.parseErrors} parse error(s), ` +
        `${diagnostics.schemaErrors} schema error(s)`,
    );
    console.log("source rollouts were opened read-only and were not modified");
    return 0;
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) process.exitCode = main();
