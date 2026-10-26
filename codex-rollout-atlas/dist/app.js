"use strict";

const CATEGORY_META = {
  lifecycle: { label: "生命周期", short: "LF", color: "#8f99a7" },
  user: { label: "用户输入", short: "US", color: "#67d5df" },
  assistant: { label: "Agent 输出", short: "AI", color: "#72d3a3" },
  reasoning: { label: "推理", short: "RS", color: "#b79cff" },
  tool: { label: "工具", short: "TL", color: "#71a8ff" },
  security: { label: "安全 / 审批", short: "SC", color: "#ff7a83" },
  context: { label: "上下文", short: "CX", color: "#c493ff" },
  compaction: { label: "压缩", short: "CP", color: "#f3b562" },
  usage: { label: "用量", short: "TK", color: "#e2c86d" },
  automation: { label: "自动化", short: "AU", color: "#ef86ca" },
  collaboration: { label: "多 Agent", short: "MA", color: "#5ed0b5" },
  realtime: { label: "实时", short: "RT", color: "#76c4ff" },
  configuration: { label: "配置", short: "CF", color: "#9ba7b7" },
  error: { label: "错误 / 警告", short: "ER", color: "#ff7a83" },
  other: { label: "其他", short: "··", color: "#77818e" },
};

const CATEGORY_ORDER = Object.keys(CATEGORY_META);
const PAGE_SIZE = 180;
const MAX_BROWSER_FILE_BYTES = 256 * 1024 * 1024;

const DEMO_RECORDS = [
  {
    timestamp: "2026-10-15T01:42:11.084Z",
    ordinal: 0,
    type: "session_meta",
    payload: {
      session_id: "0199e5f2-05a4-7cb1-a8c1-2ff03f019a10",
      id: "0199e5f2-05a4-7cb1-a8c1-2ff03f019a10",
      timestamp: "2026-10-15T01:42:11.080Z",
      cwd: "/workspace/codex",
      runtime_workspace_roots: ["/workspace/codex"],
      originator: "codex_cli_rs",
      cli_version: "0.0.0-dev",
      source: "cli",
      model_provider: "openai",
      history_mode: "paginated",
      context_window: { window_id: "ctx_01" },
      git: { commit_hash: "7c45d1e", branch: "main", repository_url: "https://github.com/openai/codex" },
    },
  },
  {
    timestamp: "2026-10-15T01:42:11.098Z",
    ordinal: 1,
    type: "event_msg",
    payload: { type: "task_started", turn_id: "turn_01", model_context_window: 200000 },
  },
  {
    timestamp: "2026-10-15T01:42:11.102Z",
    ordinal: 2,
    type: "turn_context",
    payload: {
      turn_id: "turn_01",
      cwd: "/workspace/codex",
      current_date: "2026-10-15",
      timezone: "Asia/Shanghai",
      approval_policy: "on-request",
      approvals_reviewer: "guardian",
      sandbox_policy: { type: "workspace-write", writable_roots: ["/workspace/codex"] },
      permission_profile: {
        file_system: { type: "restricted", writable_roots: ["/workspace/codex"] },
        network: { type: "restricted" },
      },
      network: { allowed_domains: ["developers.openai.com"], denied_domains: [] },
      model: "gpt-codex",
      effort: "high",
      summary: "auto",
    },
  },
  {
    timestamp: "2026-10-15T01:42:11.110Z",
    ordinal: 3,
    type: "response_item",
    payload: {
      type: "message",
      id: "msg_user_01",
      role: "user",
      content: [{ type: "input_text", text: "梳理 Codex CLI 的执行闭环，并定位安全控制的源码。" }],
    },
  },
  {
    timestamp: "2026-10-15T01:42:11.824Z",
    ordinal: 4,
    type: "response_item",
    payload: {
      type: "reasoning",
      id: "rs_01",
      summary: [{ type: "summary_text", text: "先定位 rollout、session 与工具路由模块，再沿事件关联 ID 还原控制流。" }],
      encrypted_content: "gAAAAA…",
    },
  },
  {
    timestamp: "2026-10-15T01:42:12.013Z",
    ordinal: 5,
    type: "response_item",
    payload: {
      type: "function_call",
      id: "fc_01",
      name: "exec_command",
      arguments: "{\"cmd\":\"rg -n \\\"pub enum RolloutItem\\\" codex-rs\",\"workdir\":\"/workspace/codex\"}",
      call_id: "call_rg_01",
    },
  },
  {
    timestamp: "2026-10-15T01:42:12.019Z",
    ordinal: 6,
    type: "event_msg",
    payload: {
      type: "exec_approval_request",
      call_id: "call_rg_01",
      command: ["rg", "-n", "pub enum RolloutItem", "codex-rs"],
      cwd: "/workspace/codex",
      reason: "command falls inside the readable workspace and is non-mutating",
      proposed_execpolicy_amendment: null,
    },
  },
  {
    timestamp: "2026-10-15T01:42:12.244Z",
    ordinal: 7,
    type: "event_msg",
    payload: {
      type: "exec_command_begin",
      call_id: "call_rg_01",
      process_id: "48361",
      turn_id: "turn_01",
      started_at_ms: 1792028532244,
      command: ["rg", "-n", "pub enum RolloutItem", "codex-rs"],
      cwd: "/workspace/codex",
      parsed_cmd: [{ type: "search", query: "pub enum RolloutItem", path: "codex-rs" }],
      source: "agent",
    },
  },
  {
    timestamp: "2026-10-15T01:42:12.381Z",
    ordinal: 8,
    type: "event_msg",
    payload: {
      type: "exec_command_end",
      call_id: "call_rg_01",
      process_id: "48361",
      turn_id: "turn_01",
      completed_at_ms: 1792028532381,
      command: ["rg", "-n", "pub enum RolloutItem", "codex-rs"],
      cwd: "/workspace/codex",
      parsed_cmd: [{ type: "search", query: "pub enum RolloutItem", path: "codex-rs" }],
      source: "agent",
      stdout: "codex-rs/history/src/lib.rs:122:pub enum RolloutItem {\n",
      stderr: "",
      aggregated_output: "codex-rs/history/src/lib.rs:122:pub enum RolloutItem {\n",
      exit_code: 0,
      duration: { secs: 0, nanos: 137000000 },
      formatted_output: "codex-rs/history/src/lib.rs:122:pub enum RolloutItem {",
      status: "completed",
    },
  },
  {
    timestamp: "2026-10-15T01:42:12.388Z",
    ordinal: 9,
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "call_rg_01",
      name: "exec_command",
      output: "Chunk ID: d80e6a\nProcess exited with code 0\nFinal output:\ncodex-rs/history/src/lib.rs:122:pub enum RolloutItem {",
    },
  },
  {
    timestamp: "2026-10-15T01:42:13.204Z",
    ordinal: 10,
    type: "token_usage_record",
    payload: {
      thread_id: "0199e5f2-05a4-7cb1-a8c1-2ff03f019a10",
      turn_id: "turn_01",
      session_id: "0199e5f2-05a4-7cb1-a8c1-2ff03f019a10",
      root_turn_id: "turn_01",
      response_id: "resp_01",
      usage: { input_tokens: 48120, cached_input_tokens: 37120, output_tokens: 3810, reasoning_output_tokens: 1670, total_tokens: 51930 },
      turn_token_usage: { input_tokens: 48120, cached_input_tokens: 37120, output_tokens: 3810, reasoning_output_tokens: 1670, total_tokens: 51930 },
      thread_token_usage: { input_tokens: 48120, cached_input_tokens: 37120, output_tokens: 3810, reasoning_output_tokens: 1670, total_tokens: 51930 },
    },
  },
  {
    timestamp: "2026-10-15T01:42:13.410Z",
    ordinal: 11,
    type: "event_msg",
    payload: {
      type: "hook_started",
      turn_id: "turn_01",
      run: {
        id: "hook_precompact_01",
        event_name: "pre_compact",
        handler_type: "command",
        execution_mode: "sync",
        scope: "turn",
        source_path: ".codex/hooks/pre-compact.ps1",
        source: "project",
        display_order: 0,
        status: "running",
        started_at: 1792028533410,
        completed_at: null,
        duration_ms: null,
        entries: [],
      },
    },
  },
  {
    timestamp: "2026-10-15T01:42:14.916Z",
    ordinal: 12,
    type: "compacted",
    payload: {
      message: "已完成源码布局扫描；保留执行闭环、安全边界和事件 schema 的关键证据，后续从 history 与 protocol 模块继续追踪。",
      replacement_history: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "梳理 Codex CLI 的执行闭环。" }] },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "已定位 rollout 持久化入口。" }] },
      ],
      window_number: 1,
      first_window_id: "ctx_01",
      previous_window_id: "ctx_01",
      window_id: "ctx_02",
      compaction_response_id: "resp_compact_01",
    },
  },
  {
    timestamp: "2026-10-15T01:42:14.921Z",
    ordinal: 13,
    type: "event_msg",
    payload: { type: "context_compacted" },
  },
  {
    timestamp: "2026-10-15T01:42:14.929Z",
    ordinal: 14,
    type: "event_msg",
    payload: {
      type: "hook_completed",
      turn_id: "turn_01",
      run: {
        id: "hook_precompact_01",
        event_name: "pre_compact",
        handler_type: "command",
        execution_mode: "sync",
        scope: "turn",
        source_path: ".codex/hooks/pre-compact.ps1",
        source: "project",
        display_order: 0,
        status: "completed",
        started_at: 1792028533410,
        completed_at: 1792028534929,
        duration_ms: 1519,
        entries: [],
      },
    },
  },
  {
    timestamp: "2026-10-15T01:42:16.334Z",
    ordinal: 15,
    type: "response_item",
    payload: {
      type: "message",
      id: "msg_assistant_01",
      role: "assistant",
      phase: "final_answer",
      content: [{ type: "output_text", text: "执行过程已梳理清楚：用户请求由 Session 交给当前回合处理，模型响应记录为 ResponseItem，工具调用经过审批并在沙箱中执行，结果再写入对话历史。" }],
    },
  },
  {
    timestamp: "2026-10-15T01:42:16.349Z",
    ordinal: 16,
    type: "event_msg",
    payload: { type: "task_complete", turn_id: "turn_01", last_agent_message: "执行过程已梳理清楚。" },
  },
];

const state = {
  sessions: [],
  activeSessionId: null,
  sessionQuery: "",
  eventQuery: "",
  categories: new Set(),
  expanded: new Set(),
  rawExpanded: new Set(),
  visibleLimit: PAGE_SIZE,
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  loadDemo();
});

function cacheElements() {
  [
    "openFilesButton",
    "fileInput",
    "resetDemoButton",
    "sessionCount",
    "sessionSearch",
    "sessionList",
    "dropZone",
    "sessionSource",
    "sessionFile",
    "sessionTitle",
    "sessionSubtitle",
    "sessionInfoButton",
    "metadataDrawer",
    "metricGrid",
    "eventSearch",
    "categoryFilters",
    "collapseAllButton",
    "resultSummary",
    "timeline",
    "loadMoreWrap",
    "loadMoreButton",
    "toastRegion",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.openFilesButton.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", (event) => importFiles([...event.target.files]));
  els.resetDemoButton.addEventListener("click", loadDemo);
  els.dropZone.addEventListener("click", () => els.fileInput.click());
  els.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      els.fileInput.click();
    }
  });

  ["dragenter", "dragover"].forEach((name) => {
    document.addEventListener(name, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("dragging");
    });
  });
  ["dragleave", "drop"].forEach((name) => {
    document.addEventListener(name, (event) => {
      event.preventDefault();
      if (name === "drop") importFiles([...event.dataTransfer.files]);
      els.dropZone.classList.remove("dragging");
    });
  });

  els.sessionSearch.addEventListener("input", (event) => {
    state.sessionQuery = event.target.value.trim().toLowerCase();
    renderSessionList();
  });
  els.eventSearch.addEventListener("input", (event) => {
    state.eventQuery = event.target.value.trim().toLowerCase();
    state.visibleLimit = PAGE_SIZE;
    renderTimeline();
  });
  els.sessionList.addEventListener("click", (event) => {
    const card = event.target.closest("[data-session-id]");
    if (card) activateSession(card.dataset.sessionId);
  });
  els.categoryFilters.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-category]");
    if (!chip) return;
    const session = activeSession();
    if (!session) return;
    const available = new Set(session.records.map((record) => record.category));
    const category = chip.dataset.category;
    if (category === "all") {
      const allSelected = [...available].every((item) => state.categories.has(item));
      state.categories = allSelected ? new Set() : available;
    } else if (state.categories.has(category)) {
      state.categories.delete(category);
    } else {
      state.categories.add(category);
    }
    state.visibleLimit = PAGE_SIZE;
    renderFilters();
    renderTimeline();
  });
  els.collapseAllButton.addEventListener("click", () => {
    state.expanded.clear();
    state.rawExpanded.clear();
    renderTimeline();
  });
  els.sessionInfoButton.addEventListener("click", () => {
    const next = els.metadataDrawer.hidden;
    els.metadataDrawer.hidden = !next;
    els.sessionInfoButton.setAttribute("aria-expanded", String(next));
  });
  els.loadMoreButton.addEventListener("click", () => {
    state.visibleLimit += PAGE_SIZE;
    renderTimeline();
  });
  els.timeline.addEventListener("click", handleTimelineClick);
  els.timeline.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches(".event-card")) {
      event.preventDefault();
      toggleEvent(event.target.dataset.eventKey);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      event.preventDefault();
      els.eventSearch.focus();
    }
  });
}

function loadDemo() {
  const session = buildSession("rollout-demo-codex-research.jsonl", DEMO_RECORDS, {
    kind: "demo",
    path: "人工编写 · 日志与实时事件的混合演示",
    size: JSON.stringify(DEMO_RECORDS).length,
  });
  state.sessions = [session];
  state.activeSessionId = session.uid;
  resetActiveView();
  renderAll();
  toast("已载入人工示例，并非真实运行记录；拖入文件即可替换。", "#72d3a3");
}

async function importFiles(files) {
  if (!files.length) return;
  const imported = [];
  const failures = [];

  for (const file of files) {
    const lower = file.name.toLowerCase();
    if (file.size > MAX_BROWSER_FILE_BYTES) {
      failures.push(`${file.name}：超过浏览器直读上限 256 MB；请用解析脚本分批生成 bundle`);
      continue;
    }
    if (lower.endsWith(".jsonl.zst") || lower.endsWith(".zst")) {
      failures.push(`${file.name}：浏览器不原生支持 Zstandard；请先用 scripts/parse_rollout.py 生成 bundle.json`);
      continue;
    }
    if (!lower.endsWith(".jsonl") && !lower.endsWith(".json")) continue;
    try {
      const text = await file.text();
      if (lower.endsWith(".json")) {
        const value = JSON.parse(text.replace(/^\uFEFF/, ""));
        const bundleSessions = sessionsFromBundle(value, file.name);
        imported.push(...bundleSessions);
        continue;
      }
      const parsed = parseJsonLines(text);
      imported.push(
        buildSession(file.name, parsed.records, {
          kind: "file",
          path: file.webkitRelativePath || file.name,
          size: file.size,
          lastModified: file.lastModified,
          parseErrors: parsed.errors,
          schemaErrors: parsed.schemaErrors,
          blankLines: parsed.blankLines,
          issues: parsed.issues,
        }),
      );
    } catch (error) {
      failures.push(`${file.name}：${error.message}`);
    }
  }

  if (imported.length) {
    state.sessions = dedupeSessions(imported);
    state.activeSessionId = state.sessions[0].uid;
    resetActiveView();
    renderAll();
    toast(`已在本地载入 ${imported.length} 个会话。`, "#72d3a3");
  }
  if (failures.length) {
    toast(failures.slice(0, 3).join("；"), "#ff7a83", 7200);
  }
  els.fileInput.value = "";
}

function sessionsFromBundle(value, sourceName) {
  const schemaVersion = value?.schemaVersion ?? value?.schema_version ?? null;
  if (schemaVersion !== null && ![1, 2].includes(Number(schemaVersion))) {
    throw new Error(`${sourceName}：不支持 bundle schema v${schemaVersion}`);
  }
  const candidates = Array.isArray(value?.sessions)
    ? value.sessions
    : Array.isArray(value)
      ? [{ fileName: sourceName, records: value }]
      : Array.isArray(value?.records)
        ? [value]
        : [];

  if (!candidates.length) throw new Error(`${sourceName}：不是 Rollout Atlas bundle（缺少 sessions/records）`);

  return candidates
    .filter((candidate) => Array.isArray(candidate.records))
    .map((candidate, index) =>
      buildSession(candidate.fileName || candidate.name || `${sourceName}#${index + 1}`, candidate.records, {
        kind: "bundle",
        path: candidate.source?.path ?? candidate.path ?? sourceName,
        size: candidate.source?.size ?? null,
        logicalSize: candidate.source?.logicalSize ?? null,
        sha256: candidate.source?.sha256 ?? null,
        compressed: candidate.source?.compressed ?? null,
        readOnly: candidate.source?.readOnly ?? true,
        modifiedAt: candidate.source?.modifiedAt ?? null,
        parseErrors: candidate.diagnostics?.parseErrors ?? candidate.parseErrors ?? 0,
        schemaErrors: candidate.diagnostics?.schemaErrors ?? candidate.schemaErrors ?? 0,
        blankLines: candidate.diagnostics?.blankLines ?? 0,
        issues: candidate.diagnostics?.issues ?? [],
        bundleSchemaVersion: schemaVersion,
        recordLines: candidate.recordLines ?? candidate.record_lines ?? null,
        recordRawLines: candidate.recordRawLines ?? candidate.record_raw_lines ?? null,
        rolloutId: candidate.rolloutId ?? candidate.rollout_id ?? null,
      }),
    );
}

function parseJsonLines(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const records = [];
  const issues = [];
  let errors = 0;
  let schemaErrors = 0;
  let blankLines = 0;

  lines.forEach((line, index) => {
    if (!line.trim()) {
      blankLines += 1;
      return;
    }
    try {
      const value = JSON.parse(line);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("顶层 JSON 必须是对象");
      }
      Object.defineProperty(value, "__atlas_line", { value: index + 1, enumerable: false });
      Object.defineProperty(value, "__atlas_raw_line", { value: line, enumerable: false });
      const envelopeErrors = validateEnvelopeShape(value, line);
      if (envelopeErrors.length) {
        schemaErrors += 1;
        const message = envelopeErrors.join("; ");
        Object.defineProperty(value, "__atlas_schema_error", { value: message, enumerable: false, configurable: true });
        issues.push({ line: index + 1, kind: "schema", error: message, preview: line.slice(0, 500) });
      }
      records.push(value);
    } catch (error) {
      errors += 1;
      issues.push({ line: index + 1, kind: "parse", error: error.message, preview: line.slice(0, 500) });
      records.push({
        timestamp: null,
        type: "parse_error",
        payload: {
          line: index + 1,
          error: error.message,
          raw: line.length > 8000 ? `${line.slice(0, 8000)}…` : line,
        },
        __atlas_invalid: true,
      });
    }
  });

  if (!records.length) {
    schemaErrors += 1;
    issues.push({ line: null, kind: "schema", error: "rollout contains no records", preview: "" });
  } else if (records[0].type !== "session_meta") {
    schemaErrors += 1;
    const message = "first non-blank record must be session_meta";
    const previous = records[0].__atlas_schema_error;
    Object.defineProperty(records[0], "__atlas_schema_error", {
      value: previous ? `${previous}; ${message}` : message,
      enumerable: false,
      configurable: true,
    });
    issues.push({ line: records[0].__atlas_line || records[0].payload?.line || null, kind: "schema", error: message, preview: records[0].__atlas_raw_line?.slice(0, 500) || "" });
  }
  return { records, errors, schemaErrors, blankLines, issues };
}

function validateEnvelopeShape(value, rawText = null) {
  const errors = [];
  if (typeof value?.timestamp !== "string" || !value.timestamp) errors.push("timestamp must be a non-empty string");
  if (typeof value?.type !== "string" || !value.type) errors.push("type must be a non-empty string");
  if (!value?.payload || typeof value.payload !== "object" || Array.isArray(value.payload)) errors.push("payload must be an object");
  if (value?.ordinal !== undefined && value.ordinal !== null) {
    const lexeme = extractTopLevelNumberLexeme(rawText, "ordinal");
    if (lexeme !== null) {
      try {
        if (!/^(?:0|[1-9]\d*)$/.test(lexeme) || BigInt(lexeme) > 18_446_744_073_709_551_615n) throw new Error("invalid u64");
      } catch {
        errors.push("ordinal must be a non-negative u64 integer");
      }
    } else if (!Number.isSafeInteger(value.ordinal) || value.ordinal < 0) {
      errors.push("ordinal must be a non-negative safe integer when its raw token is unavailable");
    }
  }
  return errors;
}

function buildSession(fileName, rawRecords, source = {}) {
  const seed = `${fileName}|${source.path || ""}|${source.size || 0}|${source.lastModified || 0}`;
  const provisionalUid = `session-${hash32(seed)}`;
  const schemaIssueByLine = new Map(
    (Array.isArray(source.issues) ? source.issues : [])
      .filter((issue) => issue?.kind === "schema" && Number.isFinite(Number(issue.line)))
      .map((issue) => [Number(issue.line), String(issue.error || "schema-invalid envelope")]),
  );
  const records = rawRecords.map((raw, index) => {
    const recordedLine = Array.isArray(source.recordLines) ? source.recordLines[index] : null;
    const recordedRawLine = Array.isArray(source.recordRawLines) ? source.recordRawLines[index] : null;
    const line = Number(recordedLine || raw?.__atlas_line || raw?.payload?.line || index + 1);
    const normalizedLine = Number.isFinite(line) && line > 0 ? line : index + 1;
    return normalizeRecord(
      raw,
      normalizedLine,
      provisionalUid,
      recordedRawLine || raw?.__atlas_raw_line || raw?.payload?.raw || null,
      index,
      schemaIssueByLine.get(normalizedLine) || raw?.__atlas_schema_error || null,
    );
  });
  records.sort(compareRecords);
  const metaRecord = records.find((record) => record.outerType === "session_meta");
  const meta = metaRecord?.payload || {};
  const inferredIds = inferIdsFromFileName(fileName);
  const id = String(meta.id || meta.session_id || inferredIds.threadId || provisionalUid);
  const rolloutId = String(source.rolloutId || inferredIds.rolloutId || id);
  const uid = `session-${source.sha256 || hash32(`${id}|${rolloutId}|${seed}`)}`;
  records.forEach((record) => {
    record.key = `${uid}:${record.line}:${record.sequence}`;
  });
  const firstUser = records.find((record) => record.category === "user");
  const session = {
    uid,
    id,
    rolloutId,
    fileName,
    source,
    meta,
    records,
    preview: firstUser ? firstUser.summary : "未找到用户消息",
    startMs: firstFinite(records.map((record) => record.timeMs)),
    endMs: lastFinite(records.map((record) => record.timeMs)),
    callIndex: new Map(),
  };
  buildCallIndex(session);
  return session;
}

function normalizeRecord(raw, line, sessionUid, rawText = null, sequence = 0, schemaError = null) {
  const outerType = normalizeType(raw?.type || "unknown");
  const payload = raw?.payload && typeof raw.payload === "object" ? raw.payload : {};
  const innerType = normalizeType(payload?.type || "");
  const category = classifyEvent(outerType, innerType, payload, raw);
  const timestamp = raw?.timestamp || (outerType === "session_meta" ? payload.timestamp : null);
  const parsedMs = timestamp ? Date.parse(timestamp) : Number.NaN;
  const eventType = displayEventType(outerType, innerType, payload);
  const summary = summarizeRecord(outerType, innerType, payload, raw);
  const ids = extractIds(payload, raw);

  return {
    key: `${sessionUid}:${line}:${sequence}`,
    line,
    sequence,
    raw,
    rawText,
    payload,
    outerType,
    innerType,
    eventType,
    category,
    timestamp,
    timeMs: Number.isFinite(parsedMs) ? parsedMs : null,
    ordinal: Number.isSafeInteger(raw?.ordinal) && raw.ordinal >= 0 ? raw.ordinal : null,
    ordinalText: extractTopLevelNumberLexeme(rawText, "ordinal") || (Number.isSafeInteger(raw?.ordinal) && raw.ordinal >= 0 ? String(raw.ordinal) : null),
    summary,
    ids,
    schemaError,
    invalid: Boolean(raw?.__atlas_invalid || schemaError || outerType === "parse_error"),
    searchBlob: null,
  };
}

function compareRecords(a, b) {
  // Physical line order is canonical and remains a total order even when a
  // malformed paginated rollout has missing, duplicate, or unsafe ordinals.
  // Ordinals and timestamps are validation/display data, never sort keys.
  return a.line - b.line;
}

function turnItemType(payload) {
  return normalizeType(payload?.item?.type || "");
}

function categoryForTurnItem(type) {
  if (type === "user_message") return "user";
  if (type === "agent_message") return "assistant";
  if (type === "reasoning") return "reasoning";
  if (type === "context_compaction") return "compaction";
  if (/^(collab_agent_tool_call|sub_agent_activity)$/.test(type)) return "collaboration";
  if (/^(entered_review_mode|exited_review_mode|plan|hook_prompt)$/.test(type)) return "automation";
  if (/^(function_call_output|command_execution|dynamic_tool_call|web_search|image_view|extension|image_generation|file_change|mcp_tool_call)$/.test(type)) return "tool";
  return "lifecycle";
}

function classifyEvent(outer, inner, payload) {
  if (outer === "parse_error") return "error";
  if (outer === "session_meta") return "lifecycle";
  if (outer === "turn_context") return "configuration";
  if (outer === "token_usage_record") return "usage";
  if (outer === "compacted") return "compaction";
  if (outer === "world_state" || outer === "retained_context") return "context";
  if (outer === "security_risk_score") return "security";
  if (outer === "inter_agent_communication" || outer === "inter_agent_communication_metadata") return "collaboration";
  if (outer === "realtime_item") return "realtime";

  if (outer === "response_item") {
    if (inner === "message") {
      if (payload.role === "user") return "user";
      if (payload.role === "assistant") return "assistant";
      return "configuration";
    }
    if (inner === "agent_message") return "collaboration";
    if (inner === "reasoning") return "reasoning";
    if (/^(function_call|custom_tool_call|local_shell_call|tool_search_call|tool_search_output|web_search_call|image_generation_call|function_call_output|custom_tool_call_output)$/.test(inner)) return "tool";
    if (/compaction/.test(inner)) return "compaction";
    if (inner === "configuration_update" || inner === "additional_tools") return "configuration";
  }

  if (outer === "event_msg") {
    if (inner === "guardian_warning" || /approval|permission|guardian_assessment|moderation|safety_buffering|model_verification/.test(inner)) return "security";
    if (/^(error|warning|stream_error|deprecation_notice)$/.test(inner)) return "error";
    if (/^(task_started|turn_started|task_complete|turn_complete|turn_aborted|session_configured|thread_settings_applied|shutdown_complete|auth_recovery_started|auth_recovery_completed|environment_connected|environment_disconnected|model_reroute)$/.test(inner)) return "lifecycle";
    if (/^(user_message)$/.test(inner)) return "user";
    if (/^(agent_message|agent_message_content_delta)$/.test(inner)) return "assistant";
    if (/reasoning/.test(inner)) return "reasoning";
    if (/^(exec_|terminal_interaction|mcp_tool|mcp_startup|web_search|image_generation|view_image|dynamic_tool|elicitation|patch_apply)/.test(inner)) return "tool";
    if (/context_compacted|thread_rolled_back/.test(inner)) return "compaction";
    if (/token_count/.test(inner)) return "usage";
    if (/^realtime_/.test(inner)) return "realtime";
    if (/^collab_|sub_agent_activity/.test(inner)) return "collaboration";
    if (/hook_|review_mode|plan_|entered_review|exited_review|thread_goal|thread_queue|request_user_input/.test(inner)) return "automation";
    if (/^(item_started|item_completed)$/.test(inner)) return categoryForTurnItem(turnItemType(payload));
    if (/raw_response|turn_diff/.test(inner)) return "lifecycle";
  }

  return "other";
}

function displayEventType(outer, inner, payload) {
  if (outer === "response_item" && inner === "message") return `message:${payload.role || "unknown"}`;
  if (outer === "event_msg" && /^(item_started|item_completed)$/.test(inner)) {
    return `${inner}:${turnItemType(payload) || "unknown"}`;
  }
  if ((outer === "realtime_item" || outer === "retained_context") && inner) return `${outer}:${inner}`;
  if ((outer === "response_item" || outer === "event_msg") && inner) return inner;
  return outer;
}

function summarizeRecord(outer, inner, payload, raw) {
  if (outer === "parse_error") return `第 ${payload.line || "?"} 行无法解析：${payload.error || "未知错误"}`;
  if (outer === "session_meta") return [payload.originator, payload.cli_version, payload.cwd].filter(Boolean).join(" · ") || "会话元数据";
  if (outer === "turn_context") {
    const sandbox = typeof payload.sandbox_policy === "string" ? payload.sandbox_policy : payload.sandbox_policy?.type;
    return [payload.model && `model=${payload.model}`, sandbox && `sandbox=${sandbox}`, payload.approval_policy && `approval=${payload.approval_policy}`]
      .filter(Boolean)
      .join(" · ") || "本轮运行上下文";
  }
  if (outer === "token_usage_record") {
    const usage = payload.thread_token_usage || payload.turn_token_usage || payload.usage || {};
    return `累计 ${formatNumber(usage.total_tokens || 0)} tokens · 输入 ${formatNumber(usage.input_tokens || 0)} · 输出 ${formatNumber(usage.output_tokens || 0)}`;
  }
  if (outer === "compacted") {
    const prefix = payload.window_number !== undefined ? `窗口 #${payload.window_number}` : "上下文压缩";
    return `${prefix} · ${preview(payload.message || "已写入替换历史", 240)}`;
  }
  if (outer === "security_risk_score") {
    return `风险评分 ${Object.entries(payload.scores || {}).map(([key, value]) => `${key}=${value}`).join(" · ") || "已记录"}`;
  }
  if (outer === "world_state") return `${payload.full ? "完整快照" : "增量补丁"} · ${Object.keys(payload.state || {}).length} 个字段`;
  if (outer === "retained_context") return preview(firstText(payload) || "持久上下文更新", 240);
  if (outer === "inter_agent_communication") return preview(firstText(payload) || "Agent 间通信", 240);

  if (outer === "response_item") {
    if (inner === "message" || inner === "agent_message") return preview(contentToText(payload.content) || "空消息", 300);
    if (inner === "reasoning") return preview(contentToText(payload.summary) || contentToText(payload.content) || "加密推理内容", 300);
    if (inner === "function_call" || inner === "custom_tool_call") {
      const args = parsedArguments(payload.arguments || payload.input);
      return preview(`${payload.namespace ? `${payload.namespace}.` : ""}${payload.name || "tool"} ${compactJson(args)}`, 300);
    }
    if (inner === "local_shell_call") return preview(commandText(payload.action) || compactJson(payload.action), 300);
    if (inner === "tool_search_call") return preview(`${payload.execution || "tool_search"} ${compactJson(payload.arguments)}`, 300);
    if (inner === "tool_search_output") return `${payload.status || "completed"} · ${payload.tools?.length || 0} 个工具`;
    if (/output$/.test(inner)) return preview(outputToText(payload.output) || "工具返回空输出", 300);
    if (inner === "web_search_call") return preview(firstText(payload.action) || compactJson(payload.action) || "Web search", 300);
    if (inner === "image_generation_call") return preview(payload.revised_prompt || `${payload.status || "completed"} image generation`, 300);
    if (/compaction/.test(inner)) return payload.encrypted_content ? "服务端加密压缩项" : "压缩控制项";
    if (inner === "configuration_update") return preview(compactJson(payload), 300);
  }

  if (outer === "event_msg") {
    if (/^(task_started|turn_started)$/.test(inner)) return `开始 turn ${payload.turn_id || payload.id || ""}`.trim();
    if (/^(task_complete|turn_complete)$/.test(inner)) return preview(payload.last_agent_message || `完成 turn ${payload.turn_id || ""}`, 300);
    if (inner === "turn_aborted") return `中止：${payload.reason || payload.turn_id || "unknown"}`;
    if (/exec_command_(begin|end)/.test(inner)) {
      const command = commandText(payload.command) || firstText(payload.parsed_cmd);
      const duration = formatWireDuration(payload.duration ?? payload.duration_ms);
      const suffix = inner.endsWith("end") ? ` · exit=${payload.exit_code ?? "?"}${duration ? ` · ${duration}` : ""}` : "";
      return preview(`${command || "执行命令"}${suffix}`, 300);
    }
    if (inner === "exec_command_output_delta") return preview(payload.chunk || payload.delta || "命令输出片段", 300);
    if (/approval_request|request_permissions/.test(inner)) return preview(commandText(payload.command) || payload.reason || firstText(payload) || "等待用户授权", 300);
    if (/mcp_tool_call/.test(inner)) {
      const invocation = payload.invocation || payload;
      return preview(`${invocation.server || invocation.server_name || "MCP"} · ${invocation.tool || invocation.tool_name || "tool"}`, 300);
    }
    if (/web_search/.test(inner)) return preview(payload.query || firstText(payload) || "Web search", 300);
    if (/image_generation/.test(inner)) return preview(payload.prompt || payload.revised_prompt || "Image generation", 300);
    if (/patch_apply/.test(inner)) return preview(payload.path || payload.patch || payload.changes || "应用补丁", 300);
    if (/hook_/.test(inner)) {
      const run = payload.run || payload;
      return `${run.event_name || run.hook_event || "hook"}${run.handler_type ? ` · ${run.handler_type}` : ""}${run.duration_ms !== undefined && run.duration_ms !== null ? ` · ${run.duration_ms}ms` : ""}`;
    }
    if (inner === "context_compacted") return `上下文窗口已压缩${payload.window_number !== undefined ? ` · #${payload.window_number}` : ""}`;
    if (inner === "token_count") {
      const usage = payload.info?.total_token_usage || payload.total_token_usage || {};
      return `累计 ${formatNumber(usage.total_tokens || 0)} tokens`;
    }
    if (/agent_message/.test(inner)) return preview(payload.message || payload.delta || payload.text || firstText(payload), 300);
    if (/user_message/.test(inner)) return preview(payload.message || payload.text || firstText(payload), 300);
    if (/reasoning/.test(inner)) return preview(payload.delta || payload.text || firstText(payload) || "推理更新", 300);
    if (/error|warning/.test(inner)) return preview(payload.message || payload.error || firstText(payload) || inner, 300);
    if (/collab_|sub_agent/.test(inner)) return preview([payload.agent_path, payload.agent_id, payload.status, payload.message].filter(Boolean).join(" · ") || firstText(payload), 300);
    if (/^(item_started|item_completed)$/.test(inner)) return summarizeTurnItem(payload.item, inner);
    if (/review_mode/.test(inner) || /review/.test(inner)) return preview(firstText(payload.review_output || payload.review || payload.target || payload.message) || inner, 300);
    if (inner === "plan_update" || inner === "plan_delta") return preview(payload.explanation || payload.delta || firstText(payload) || "计划更新", 300);
    if (inner === "raw_response_item") return `原始 Responses item · ${payload.item?.type || "unknown"}`;
  }

  return preview(firstText(payload) || compactJson(payload) || raw?.type || "未知事件", 300);
}

function extractIds(payload, raw) {
  const result = {};
  const candidateKeys = ["call_id", "item_id", "turn_id", "root_turn_id", "response_id", "thread_id", "session_id", "id", "process_id", "invocation_id"];
  candidateKeys.forEach((key) => {
    const value = payload?.[key] ?? raw?.[key];
    if (value !== undefined && value !== null && typeof value !== "object") result[key] = String(value);
  });
  if (payload?.item?.id && !result.item_id) result.item_id = String(payload.item.id);
  const nestedItemType = normalizeType(payload?.item?.type || "");
  if (payload?.item?.id && /^(command_execution|dynamic_tool_call|mcp_tool_call|collab_agent_tool_call)$/.test(nestedItemType) && !result.call_id) {
    result.call_id = String(payload.item.id);
  }
  if (payload?.item?.process_id && !result.process_id) result.process_id = String(payload.item.process_id);
  if (payload?.run?.id && !result.invocation_id) result.invocation_id = String(payload.run.id);
  return result;
}

function summarizeTurnItem(item, lifecycle) {
  if (!item || typeof item !== "object") return `${lifecycle} · unknown item`;
  const type = normalizeType(item.type || "unknown");
  const state = lifecycle === "item_started" ? "开始" : "完成";
  if (type === "user_message" || type === "agent_message") return preview(contentToText(item.content) || `${state}消息`, 300);
  if (type === "reasoning") return preview(contentToText(item.summary_text) || contentToText(item.raw_content) || `${state}推理`, 300);
  if (type === "plan") return preview(item.text || `${state}计划`, 300);
  if (type === "command_execution") return preview(`${commandText(item.command) || "执行命令"} · ${item.status || state}${item.exit_code !== undefined && item.exit_code !== null ? ` · exit=${item.exit_code}` : ""}`, 300);
  if (type === "dynamic_tool_call") return preview(`${item.namespace ? `${item.namespace}.` : ""}${item.tool || "dynamic tool"} · ${item.status || state}`, 300);
  if (type === "mcp_tool_call") return preview(`${item.server || "MCP"} · ${item.tool || "tool"} · ${item.status || state}`, 300);
  if (type === "file_change") return `${state}文件变更 · ${Object.keys(item.changes || {}).length} 个路径${item.status ? ` · ${item.status}` : ""}`;
  if (type === "context_compaction") return `${state}上下文压缩`;
  if (type === "collab_agent_tool_call") return `${item.tool || "Agent 协作"} · ${item.status || state}`;
  if (type === "sub_agent_activity") return `${item.agent_path || item.agent_thread_id || "Sub-agent"} · ${item.kind || state}`;
  if (type === "web_search") return preview(`${item.query || "Web search"} · ${firstText(item.action)}`, 300);
  if (type === "image_view") return preview(item.path || "查看图片", 300);
  if (type === "image_generation") return preview(item.revised_prompt || `${item.status || state} image generation`, 300);
  if (type === "function_call_output") return preview(`${item.name || "tool"} · ${outputToText(item.output) || "空输出"}`, 300);
  if (type === "entered_review_mode") return preview(firstText(item.target) || item.user_facing_hint || "进入 Review", 300);
  if (type === "exited_review_mode") return preview(firstText(item.review_output) || "退出 Review", 300);
  return preview(`${state} ${type} · ${firstText(item) || compactJson(item)}`, 300);
}

function buildCallIndex(session) {
  session.callIndex.clear();
  session.records.forEach((record) => {
    const correlationIds = [["call_id", record.ids.call_id], ["process_id", record.ids.process_id], ["invocation_id", record.ids.invocation_id]].filter(([, value]) => Boolean(value));
    correlationIds.forEach(([kind, id]) => {
      const key = `${kind}:${id}`;
      if (!session.callIndex.has(key)) session.callIndex.set(key, []);
      session.callIndex.get(key).push(record);
    });
  });
}

function dedupeSessions(sessions) {
  const seen = new Map();
  sessions.forEach((session) => seen.set(session.uid, session));
  return [...seen.values()].sort((a, b) => (b.startMs || 0) - (a.startMs || 0));
}

function resetActiveView() {
  state.eventQuery = "";
  state.expanded.clear();
  state.rawExpanded.clear();
  state.visibleLimit = PAGE_SIZE;
  els.eventSearch.value = "";
  const session = activeSession();
  state.categories = new Set(session ? session.records.map((record) => record.category) : []);
  els.metadataDrawer.hidden = true;
  els.sessionInfoButton.setAttribute("aria-expanded", "false");
}

function activateSession(uid) {
  if (uid === state.activeSessionId) return;
  state.activeSessionId = uid;
  resetActiveView();
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function activeSession() {
  return state.sessions.find((session) => session.uid === state.activeSessionId) || null;
}

function renderAll() {
  renderSessionList();
  renderHero();
  renderMetrics();
  renderFilters();
  renderTimeline();
}

function renderSessionList() {
  const query = state.sessionQuery;
  const sessions = state.sessions.filter((session) => {
    if (!query) return true;
    return [session.id, session.fileName, session.source.path, session.meta.cwd, session.meta.originator, session.preview]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
  els.sessionCount.textContent = String(sessions.length);
  if (!sessions.length) {
    els.sessionList.innerHTML = '<div class="empty-state"><strong>没有匹配会话</strong><p>调整搜索条件或导入新文件。</p></div>';
    return;
  }
  els.sessionList.innerHTML = sessions
    .map((session) => {
      const source = String(session.meta.source || session.source.kind || "rollout").toUpperCase();
      return `<button class="session-card${session.uid === state.activeSessionId ? " active" : ""}" type="button" data-session-id="${escapeAttr(session.uid)}">
        <span class="session-topline">
          <span class="session-name">${escapeHtml(shortId(session.id))}</span>
          <span class="session-time">${escapeHtml(formatSessionDate(session.startMs))}</span>
        </span>
        <span class="session-preview">${escapeHtml(session.preview)}</span>
        <span class="session-foot">
          <span class="mini-tag">${escapeHtml(source)}</span>
          <span>${formatNumber(session.records.length)} events</span>
          ${countInvalid(session) ? `<span>· ${countInvalid(session)} errors</span>` : ""}
        </span>
      </button>`;
    })
    .join("");
}

function renderHero() {
  const session = activeSession();
  if (!session) return;
  const meta = session.meta;
  els.sessionSource.textContent = String(meta.source || session.source.kind || "rollout").toUpperCase();
  els.sessionFile.textContent = session.source.path || session.fileName;
  els.sessionTitle.textContent = session.id;
  const model = findLatestTurnContext(session)?.payload?.model || meta.model_provider || "model unknown";
  const cwd = meta.cwd || findLatestTurnContext(session)?.payload?.cwd || "cwd unknown";
  els.sessionSubtitle.textContent = `${model} · ${cwd} · ${formatNumber(session.records.length)} 条持久化记录`;
  renderMetadata(session);
}

function renderMetadata(session) {
  const turn = findLatestTurnContext(session)?.payload || {};
  const meta = session.meta || {};
  const sandbox = typeof turn.sandbox_policy === "string" ? turn.sandbox_policy : turn.sandbox_policy?.type;
  const fields = [
    ["thread / session", `${meta.id || session.id}${meta.session_id && meta.session_id !== meta.id ? ` / ${meta.session_id}` : ""}`],
    ["rollout / revision", session.rolloutId || "—"],
    ["originator / version", [meta.originator, meta.cli_version].filter(Boolean).join(" / ") || "—"],
    ["source / provider", [meta.source, meta.model_provider].filter(Boolean).join(" / ") || "—"],
    ["cwd", meta.cwd || turn.cwd || "—"],
    ["model / effort", [turn.model, stringifySmall(turn.effort)].filter(Boolean).join(" / ") || "—"],
    ["approval / reviewer", [stringifySmall(turn.approval_policy), stringifySmall(turn.approvals_reviewer)].filter(Boolean).join(" / ") || "—"],
    ["sandbox", sandbox || stringifySmall(turn.permission_profile?.file_system?.type) || "—"],
    ["network", turn.network ? `${turn.network.allowed_domains?.length || 0} allow / ${turn.network.denied_domains?.length || 0} deny` : "—"],
    ["parser diagnostics", `${session.source.parseErrors || 0} parse / ${session.source.schemaErrors || 0} schema`],
    ["source digest", session.source.sha256 || "未计算（浏览器直接读取）"],
  ];
  els.metadataDrawer.innerHTML = `<div class="metadata-grid">${fields
    .map(([label, value]) => `<div class="metadata-item"><span>${escapeHtml(label)}</span><code title="${escapeAttr(String(value))}">${escapeHtml(String(value))}</code></div>`)
    .join("")}</div>`;
}

function renderMetrics() {
  const session = activeSession();
  if (!session) return;
  const stats = sessionStats(session);
  const cards = [
    ["持久化记录", formatNumber(session.records.length), `${formatBytes(session.source.size)}`, "#8f99a7"],
    ["会话跨度", formatDuration(stats.durationMs), stats.durationMs ? `${formatClock(session.startMs)} → ${formatClock(session.endMs)}` : "时间戳不足", "#67d5df"],
    ["工具调用", formatNumber(stats.toolCalls), `${stats.toolEvents} 条工具事件`, "#71a8ff"],
    ["审批 / 安全", formatNumber(stats.securityEvents), stats.riskScores ? `${stats.riskScores} 个风险快照` : "显式安全事件", "#ff7a83"],
    ["上下文压缩", formatNumber(stats.compactions), stats.latestWindow ? `最新窗口 #${stats.latestWindow}` : "未见压缩窗口", "#f3b562"],
    ["累计 Tokens", compactNumber(stats.totalTokens), stats.cachedTokens ? `${compactNumber(stats.cachedTokens)} cached` : "以最新记录为准", "#e2c86d"],
  ];
  els.metricGrid.innerHTML = cards
    .map(
      ([label, value, subvalue, color]) => `<div class="metric-card" style="--metric-color:${color}">
        <div class="metric-label"><span>${escapeHtml(label)}</span><i class="metric-swatch"></i></div>
        <span class="metric-value">${escapeHtml(String(value))}</span><span class="metric-subvalue">${escapeHtml(String(subvalue || ""))}</span>
      </div>`,
    )
    .join("");
}

function sessionStats(session) {
  const callIds = new Set();
  let toolFallback = 0;
  let toolEvents = 0;
  let securityEvents = 0;
  let riskScores = 0;
  let compactedRecords = 0;
  let compactedMarkers = 0;
  let latestWindow = null;
  let totalTokens = 0;
  let cachedTokens = 0;

  session.records.forEach((record) => {
    if (record.category === "tool") {
      toolEvents += 1;
      if (record.ids.call_id) callIds.add(record.ids.call_id);
      else if (/(_begin|_call)$/.test(record.eventType) || /^(function_call|custom_tool_call|local_shell_call)$/.test(record.innerType)) toolFallback += 1;
    }
    if (record.category === "security") securityEvents += 1;
    if (record.outerType === "security_risk_score") riskScores += 1;
    if (record.outerType === "compacted") {
      compactedRecords += 1;
      latestWindow = Math.max(latestWindow || 0, Number(record.payload.window_number) || 0) || latestWindow;
    }
    if (record.outerType === "event_msg" && record.innerType === "context_compacted") compactedMarkers += 1;
    const usage = tokenUsageFromRecord(record);
    if (usage) {
      totalTokens = Math.max(totalTokens, Number(usage.total_tokens) || 0);
      cachedTokens = Math.max(cachedTokens, Number(usage.cached_input_tokens) || 0);
    }
  });

  return {
    durationMs: session.startMs !== null && session.endMs !== null ? Math.max(0, session.endMs - session.startMs) : 0,
    toolCalls: callIds.size + toolFallback,
    toolEvents,
    securityEvents,
    riskScores,
    compactions: compactedRecords || compactedMarkers,
    latestWindow,
    totalTokens,
    cachedTokens,
  };
}

function renderFilters() {
  const session = activeSession();
  if (!session) return;
  const counts = new Map();
  session.records.forEach((record) => counts.set(record.category, (counts.get(record.category) || 0) + 1));
  const categories = CATEGORY_ORDER.filter((category) => counts.has(category));
  const allSelected = categories.length > 0 && categories.every((category) => state.categories.has(category));
  const chips = [
    `<button class="filter-chip${allSelected ? " active" : ""}" type="button" data-category="all" style="--chip-color:#edf1f5">全部<span class="filter-count">${session.records.length}</span></button>`,
    ...categories.map((category) => {
      const meta = CATEGORY_META[category];
      return `<button class="filter-chip${state.categories.has(category) ? " active" : ""}" type="button" data-category="${category}" style="--chip-color:${meta.color}">${meta.label}<span class="filter-count">${counts.get(category)}</span></button>`;
    }),
  ];
  els.categoryFilters.innerHTML = chips.join("");
}

function renderTimeline() {
  const session = activeSession();
  if (!session) return;
  const filtered = filteredRecords(session);
  const visible = filtered.slice(0, state.visibleLimit);
  els.resultSummary.textContent = `显示 ${formatNumber(visible.length)} / ${formatNumber(filtered.length)} 条 · 文件共 ${formatNumber(session.records.length)} 条`;
  els.loadMoreWrap.hidden = visible.length >= filtered.length;
  els.loadMoreButton.textContent = `继续显示（剩余 ${formatNumber(filtered.length - visible.length)}）`;

  if (!visible.length) {
    els.timeline.innerHTML = '<div class="empty-state"><strong>当前筛选没有结果</strong><p>启用其他类型，或清除搜索关键词。</p></div>';
    return;
  }
  els.timeline.innerHTML = visible.map((record) => renderTimelineItem(record, session)).join("");
}

function filteredRecords(session) {
  const query = state.eventQuery;
  return session.records.filter((record) => {
    if (!state.categories.has(record.category)) return false;
    if (!query) return true;
    if (!record.searchBlob) {
      let rawText = "";
      try {
        rawText = record.rawText || JSON.stringify(record.raw);
      } catch {
        rawText = String(record.raw);
      }
      record.searchBlob = `${record.eventType} ${record.category} ${record.summary} ${Object.values(record.ids).join(" ")} ${rawText}`.toLowerCase();
    }
    return record.searchBlob.includes(query);
  });
}

function renderTimelineItem(record, session) {
  const meta = CATEGORY_META[record.category] || CATEGORY_META.other;
  const expanded = state.expanded.has(record.key);
  const rawExpanded = state.rawExpanded.has(record.key);
  const badges = primaryBadges(record);
  return `<article class="timeline-item${record.invalid ? " invalid-event" : ""}" id="${escapeAttr(domId(record.key))}" style="--event-color:${meta.color}">
    <time class="timeline-time" datetime="${escapeAttr(record.timestamp || "")}" title="${escapeAttr(record.timestamp || "无有效时间戳")}">${escapeHtml(formatRecordTime(record))}</time>
    <i class="timeline-node" aria-hidden="true"></i>
    <div class="event-card${expanded ? " expanded" : ""}" data-event-key="${escapeAttr(record.key)}" tabindex="0" role="button" aria-expanded="${expanded}">
      <div class="event-summary" data-toggle-event="${escapeAttr(record.key)}">
        <div class="event-heading">
          <span class="event-icon">${meta.short}</span>
          <span class="event-type-wrap">
            <span class="event-category">${escapeHtml(meta.label)}</span>
            <span class="event-type" title="${escapeAttr(record.eventType)}">${escapeHtml(record.eventType)}</span>
          </span>
        </div>
        <p class="event-text" title="${escapeAttr(record.summary)}">${escapeHtml(record.summary)}</p>
        <div class="event-meta">
          ${badges.map((badge) => `<span class="event-badge" title="${escapeAttr(badge)}">${escapeHtml(badge)}</span>`).join("")}
          <svg class="event-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        </div>
      </div>
      ${expanded ? renderEventDetail(record, session, rawExpanded) : ""}
    </div>
  </article>`;
}

function renderEventDetail(record, session, rawExpanded) {
  const fields = detailFields(record, session);
  const raw = rawExpanded ? syntaxHighlightRecord(record) : "";
  return `<div class="event-detail" data-detail-for="${escapeAttr(record.key)}">
    <div class="detail-grid">
      ${fields.map((field) => renderDetailField(field)).join("")}
    </div>
    <div class="detail-actions">
      <button class="raw-toggle" type="button" data-toggle-raw="${escapeAttr(record.key)}">${rawExpanded ? "隐藏原始 JSON" : "查看原始 JSON"}</button>
      <button class="copy-button" type="button" data-copy-event="${escapeAttr(record.key)}">复制 JSON</button>
    </div>
    ${rawExpanded ? `<pre class="raw-json"><code>${raw}</code></pre>` : ""}
  </div>`;
}

function detailFields(record, session) {
  const fields = [
    { label: "rollout type", value: record.outerType },
    { label: "event type", value: record.eventType },
    { label: "position", value: record.ordinalText !== null ? `ordinal ${record.ordinalText} · line ${record.line}` : `line ${record.line}` },
  ];
  if (record.schemaError) fields.push({ label: "schema diagnostic", value: record.schemaError });
  Object.entries(record.ids).slice(0, 4).forEach(([key, value]) => fields.push({ label: key, value }));
  ["status", "role", "phase", "exit_code", "duration_ms", "cwd", "model", "approval_policy"].forEach((key) => {
    if (record.payload?.[key] !== undefined && record.payload?.[key] !== null) fields.push({ label: key, value: stringifySmall(record.payload[key]) });
  });
  const correlation = [["call_id", record.ids.call_id], ["process_id", record.ids.process_id], ["invocation_id", record.ids.invocation_id]].find(([, value]) => Boolean(value));
  if (correlation) {
    const related = (session.callIndex.get(`${correlation[0]}:${correlation[1]}`) || []).filter((candidate) => candidate.key !== record.key);
    related.slice(0, 4).forEach((candidate, index) => {
      fields.push({ label: `相关记录 ${index + 1}`, value: `${candidate.eventType} · #${candidate.ordinalText ?? candidate.line}`, link: candidate.key });
    });
  }
  return fields.slice(0, 12);
}

function renderDetailField(field) {
  const value = String(field.value ?? "—");
  return `<div class="detail-field"><span>${escapeHtml(field.label)}</span>${
    field.link
      ? `<button type="button" data-focus-event="${escapeAttr(field.link)}" title="${escapeAttr(value)}">${escapeHtml(value)}</button>`
      : `<code title="${escapeAttr(value)}">${escapeHtml(value)}</code>`
  }</div>`;
}

function primaryBadges(record) {
  const values = [];
  if (record.ids.call_id) values.push(`call ${shortId(record.ids.call_id, 12)}`);
  else if (record.ids.turn_id) values.push(`turn ${shortId(record.ids.turn_id, 12)}`);
  if (record.ordinalText !== null) values.push(`#${record.ordinalText}`);
  else values.push(`L${record.line}`);
  return values.slice(0, 2);
}

function handleTimelineClick(event) {
  const focusButton = event.target.closest("[data-focus-event]");
  if (focusButton) {
    event.stopPropagation();
    focusEvent(focusButton.dataset.focusEvent);
    return;
  }
  const copyButton = event.target.closest("[data-copy-event]");
  if (copyButton) {
    event.stopPropagation();
    copyEvent(copyButton.dataset.copyEvent);
    return;
  }
  const rawButton = event.target.closest("[data-toggle-raw]");
  if (rawButton) {
    event.stopPropagation();
    const key = rawButton.dataset.toggleRaw;
    if (state.rawExpanded.has(key)) state.rawExpanded.delete(key);
    else state.rawExpanded.add(key);
    renderTimeline();
    requestAnimationFrame(() => document.getElementById(domId(key))?.scrollIntoView({ block: "nearest" }));
    return;
  }
  const summary = event.target.closest("[data-toggle-event]");
  if (summary) toggleEvent(summary.dataset.toggleEvent);
}

function toggleEvent(key) {
  if (state.expanded.has(key)) {
    state.expanded.delete(key);
    state.rawExpanded.delete(key);
  } else {
    state.expanded.add(key);
  }
  renderTimeline();
  requestAnimationFrame(() => document.getElementById(domId(key))?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
}

function focusEvent(key) {
  const session = activeSession();
  const record = session?.records.find((candidate) => candidate.key === key);
  if (!record) return;
  state.categories.add(record.category);
  state.eventQuery = "";
  els.eventSearch.value = "";
  const filtered = filteredRecords(session);
  const position = filtered.findIndex((candidate) => candidate.key === key);
  if (position >= state.visibleLimit) state.visibleLimit = position + 20;
  state.expanded.add(key);
  renderFilters();
  renderTimeline();
  requestAnimationFrame(() => document.getElementById(domId(key))?.scrollIntoView({ block: "center", behavior: "smooth" }));
}

async function copyEvent(key) {
  const record = activeSession()?.records.find((candidate) => candidate.key === key);
  if (!record) return;
  const text = record.rawText || JSON.stringify(record.raw, null, 2);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  toast("已复制原始 JSON。", "#72d3a3");
}

function tokenUsageFromRecord(record) {
  if (record.outerType === "token_usage_record") return record.payload.thread_token_usage || record.payload.turn_token_usage || record.payload.usage;
  if (record.outerType === "event_msg" && record.innerType === "token_count") return record.payload.info?.total_token_usage || record.payload.total_token_usage;
  return null;
}

function findLatestTurnContext(session) {
  for (let index = session.records.length - 1; index >= 0; index -= 1) {
    if (session.records[index].outerType === "turn_context") return session.records[index];
  }
  return null;
}

function countInvalid(session) {
  const observed = session.records.filter((record) => record.invalid).length;
  const diagnosed = Number(session.source.parseErrors || 0) + Number(session.source.schemaErrors || 0);
  return Math.max(observed, diagnosed);
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (typeof item === "string") return item;
      return item?.text || item?.content || item?.summary_text || item?.input_text || item?.output_text || item?.name || "";
    })
    .filter(Boolean)
    .join("\n");
}

function outputToText(output) {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return contentToText(output);
  if (!output || typeof output !== "object") return "";
  if (typeof output.content === "string") return output.content;
  if (Array.isArray(output.content_items)) return contentToText(output.content_items);
  return compactJson(output);
}

function firstText(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstText(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value === "object") {
    for (const key of ["message", "text", "delta", "summary", "content", "reason", "error", "query", "command", "name"]) {
      if (key in value) {
        const found = firstText(value[key], depth + 1);
        if (found) return found;
      }
    }
    for (const child of Object.values(value)) {
      const found = firstText(child, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function commandText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => (typeof part === "string" ? quoteArg(part) : compactJson(part))).join(" ");
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value.command)) return commandText(value.command);
  if (typeof value.command === "string") return value.command;
  if (Array.isArray(value.cmd)) return commandText(value.cmd);
  if (typeof value.cmd === "string") return value.cmd;
  return "";
}

function formatWireDuration(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return `${value}ms`;
  if (typeof value === "object" && Number.isFinite(Number(value.secs))) {
    const milliseconds = Number(value.secs) * 1000 + Number(value.nanos || 0) / 1_000_000;
    return milliseconds < 1000 ? `${milliseconds.toFixed(milliseconds % 1 ? 1 : 0)}ms` : `${(milliseconds / 1000).toFixed(2)}s`;
  }
  return compactJson(value);
}

function quoteArg(value) {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function parsedArguments(value) {
  if (typeof value !== "string") return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// Read a top-level numeric token without round-tripping it through JavaScript's
// IEEE-754 Number. This keeps paginated u64 ordinals exact in the UI while the
// parsed object remains convenient for all other derived views.
function extractTopLevelNumberLexeme(json, propertyName) {
  if (typeof json !== "string" || !json) return null;
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
      let key = null;
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

function compactJson(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function stringifySmall(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return compactJson(value);
}

function syntaxHighlightRecord(record) {
  let json = "";
  if (record.rawText && record.outerType !== "parse_error") json = prettyPrintJsonText(record.rawText);
  else if (record.rawText) return escapeHtml(record.rawText);
  else {
    try {
      json = JSON.stringify(record.raw, null, 2);
    } catch {
      json = String(record.raw);
    }
  }
  return highlightJsonText(json);
}

function highlightJsonText(json) {
  const tokenPattern = /"(?:\\u[a-fA-F0-9]{4}|\\.|[^"\\])*"(?=\s*:)|"(?:\\u[a-fA-F0-9]{4}|\\.|[^"\\])*"|\b(?:true|false)\b|\bnull\b|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let output = "";
  let cursor = 0;
  for (const match of json.matchAll(tokenPattern)) {
    output += escapeHtml(json.slice(cursor, match.index));
    const token = match[0];
    let className = "json-number";
    if (token.startsWith('"')) className = /^\s*:/.test(json.slice(match.index + token.length)) ? "json-key" : "json-string";
    else if (token === "true" || token === "false") className = "json-boolean";
    else if (token === "null") className = "json-null";
    output += `<span class="${className}">${escapeHtml(token)}</span>`;
    cursor = match.index + token.length;
  }
  output += escapeHtml(json.slice(cursor));
  return output;
}

// Pretty-print JSON lexically instead of parse/stringify so integer and
// arbitrary-precision number tokens remain byte-for-byte intact.
function prettyPrintJsonText(text) {
  let output = "";
  let indent = 0;
  let inString = false;
  let escaped = false;
  const source = String(text).trim();
  const indentation = () => "  ".repeat(Math.max(0, indent));
  const nextNonWhitespace = (start) => {
    for (let index = start; index < source.length; index += 1) if (!/\s/.test(source[index])) return source[index];
    return "";
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }
    if (/\s/.test(character)) continue;
    if (character === "{" || character === "[") {
      output += character;
      const closer = character === "{" ? "}" : "]";
      if (nextNonWhitespace(index + 1) !== closer) {
        indent += 1;
        output += `\n${indentation()}`;
      }
    } else if (character === "}" || character === "]") {
      const opener = character === "}" ? "{" : "[";
      if (!output.endsWith(opener)) {
        indent = Math.max(0, indent - 1);
        output = output.replace(/[ \t]+$/g, "");
        output += `\n${indentation()}`;
      }
      output += character;
    } else if (character === ",") {
      output += `,\n${indentation()}`;
    } else if (character === ":") {
      output += ": ";
    } else {
      output += character;
    }
  }
  return output;
}

function normalizeType(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function inferIdsFromFileName(fileName) {
  const matches = String(fileName).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
  return { threadId: matches[0] || null, rolloutId: matches.at(-1) || null };
}

function firstFinite(values) {
  for (const value of values) if (Number.isFinite(value)) return value;
  return null;
}

function lastFinite(values) {
  for (let index = values.length - 1; index >= 0; index -= 1) if (Number.isFinite(values[index])) return values[index];
  return null;
}

function formatRecordTime(record) {
  if (record.timeMs === null) return record.ordinalText !== null ? `#${record.ordinalText}` : `L${record.line}`;
  const date = new Date(record.timeMs);
  const base = date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${base}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function formatSessionDate(ms) {
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function formatClock(ms) {
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
}

function compactNumber(value) {
  const number = Number(value) || 0;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)}M`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(number >= 100_000 ? 0 : 1)}K`;
  return String(number);
}

function formatBytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "源文件只读";
  if (number < 1024) return `${number} B`;
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KB`;
  return `${(number / (1024 * 1024)).toFixed(1)} MB`;
}

function shortId(value, max = 18) {
  const string = String(value || "—");
  return string.length > max ? `${string.slice(0, Math.max(8, max - 7))}…${string.slice(-6)}` : string;
}

function preview(value, max = 240) {
  const compact = String(value || "").replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

function hash32(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function domId(key) {
  return `event-${hash32(key)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function toast(message, color = "#72d3a3", timeout = 3600) {
  const node = document.createElement("div");
  node.className = "toast";
  node.style.setProperty("--toast-color", color);
  node.textContent = message;
  els.toastRegion.appendChild(node);
  window.setTimeout(() => node.remove(), timeout);
}
