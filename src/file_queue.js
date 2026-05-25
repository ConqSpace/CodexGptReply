const fs = require("fs");
const path = require("path");

const RESULT_PREFIXES = {
  completed: "[codex-result]",
  failed: "[codex-result]",
  waiting_for_user: "[codex-question]",
  running: "[codex-status]",
};

class ResultValidationError extends Error {
  constructor(fileName, missingFields) {
    super(`${fileName} 결과 파일 필드가 부족합니다: ${missingFields.join(", ")}`);
    this.name = "ResultValidationError";
    this.fileName = fileName;
    this.missingFields = missingFields;
  }
}

function parseBooleanValue(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  return value === "true" || value === "yes" || value === "1";
}

function ensureRelayDirectories(config) {
  for (const directoryPath of [
    config.inboxDir,
    config.outboxDir,
    config.sentOutboxDir,
    config.stateDir,
    config.logsDir,
  ]) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

function sanitizeId(rawValue) {
  const normalizedValue = String(rawValue || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalizedValue || "unknown";
}

function extractTaskId(text) {
  const match = String(text || "").match(/^(task_id|task\s*id|작업\s*ID|작업\s*아이디)\s*:\s*(.+)$/im);
  if (!match) {
    return "";
  }

  return sanitizeId(match[2]);
}

function taskIdFromMessage(message) {
  const explicitTaskId = extractTaskId(message.text || "");
  if (explicitTaskId) {
    return explicitTaskId;
  }

  return sanitizeId(`slack-${message.ts || Date.now()}`);
}

function stripToCodexPrefix(text) {
  return String(text || "")
    .replace(/^\s*\[to-codex\]\s*/i, "")
    .replace(/^\s*Codex\s*요청(?:\s|$)/i, "")
    .replace(/^\s*Codex\s*request(?:\s|$)/i, "")
    .replace(/^\s*카를로스\s*요청(?:\s|$)/i, "")
    .replace(/^\s*카를로스에게\s*전달\s*:?\s*/i, "")
    .replace(/^\s*Carlos\s*request(?:\s|$)/i, "")
    .replace(/^\s*Codex에게\s*전달할\s*작업입니다\.?\s*/i, "")
    .trim();
}

function buildTaskFileContent({ channelId, message, taskId, detectedAt }) {
  const threadTs = message.thread_ts || message.ts;
  const author = message.user || message.bot_id || "unknown";
  const request = stripToCodexPrefix(message.text || "");

  return `# Codex 작업 요청

- task_id: ${taskId}
- channel: ${channelId}
- message_ts: ${message.ts}
- thread_ts: ${threadTs}
- author: ${author}
- detected_at: ${detectedAt}

## 원문 request

${request}
`;
}

function createInboxTaskFile({ config, channelId, message, detectedAt }) {
  const taskId = taskIdFromMessage(message);
  const fileName = `task_${taskId}.md`;
  const filePath = path.join(config.inboxDir, fileName);
  const content = buildTaskFileContent({
    channelId,
    message,
    taskId,
    detectedAt,
  });

  let created = false;
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, "utf8");
    created = true;
  }

  return {
    taskId,
    fileName,
    filePath,
    created,
  };
}

function parseScalarValue(rawValue) {
  const value = String(rawValue || "").trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseKeyValueBlock(lines) {
  const values = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    const rawValue = match[2];

    if (rawValue === "|" || rawValue === ">") {
      const blockLines = [];
      index += 1;

      while (index < lines.length) {
        const blockLine = lines[index];
        if (/^[A-Za-z0-9_-]+:\s*/.test(blockLine)) {
          index -= 1;
          break;
        }

        blockLines.push(blockLine.replace(/^\s{2,}/, ""));
        index += 1;
      }

      values[key] = blockLines.join("\n").trim();
      continue;
    }

    values[key] = parseScalarValue(rawValue);
  }

  return values;
}

function normalizeResultValues(values) {
  if (Object.prototype.hasOwnProperty.call(values, "needs_user")) {
    values.needs_user = parseBooleanValue(values.needs_user);
  }

  if (values.needs_user === true && !values.status) {
    values.status = "waiting_for_user";
  }

  return values;
}

function parseResultFileContent(content) {
  const text = String(content || "").replace(/^\uFEFF/, "");
  const frontmatterMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

  if (frontmatterMatch) {
    const values = parseKeyValueBlock(frontmatterMatch[1].split(/\r?\n/));
    if (!values.message && frontmatterMatch[2].trim()) {
      values.message = frontmatterMatch[2].trim();
    }
    return normalizeResultValues(values);
  }

  const values = parseKeyValueBlock(text.split(/\r?\n/));

  if (!values.message) {
    const parts = text.split(/\r?\n\r?\n/);
    const body = parts.slice(1).join("\n\n").trim();
    values.message = body;
  }

  return normalizeResultValues(values);
}

function validateResult(result, fileName) {
  const requiredFields = ["task_id", "status", "thread_ts", "message"];
  const missingFields = requiredFields.filter((fieldName) => !result[fieldName]);

  if (missingFields.length > 0) {
    throw new ResultValidationError(fileName, missingFields);
  }

  if (result.needs_user === true && result.status !== "waiting_for_user") {
    throw new ResultValidationError(fileName, ["status(waiting_for_user)"]);
  }
}

function buildSlackResultText(result) {
  const prefix = RESULT_PREFIXES[result.status] || "[codex-result]";
  const needsUser = result.needs_user === true || result.status === "waiting_for_user";

  return `${prefix}
task_id: ${result.task_id}
status: ${result.status}
needs_user: ${needsUser ? "true" : "false"}

message:
${result.message}`;
}

function listOutboxCandidates(config) {
  if (!fs.existsSync(config.outboxDir)) {
    return [];
  }

  return fs
    .readdirSync(config.outboxDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => fileName.endsWith(".md") && !fileName.endsWith(".pending.md"))
    .sort()
    .map((fileName) => ({
      fileName,
      filePath: path.join(config.outboxDir, fileName),
    }));
}

function moveResultToSent(config, fileName) {
  const sourcePath = path.join(config.outboxDir, fileName);
  let targetPath = path.join(config.sentOutboxDir, fileName);

  if (fs.existsSync(targetPath)) {
    const parsedPath = path.parse(fileName);
    const movedAt = new Date().toISOString().replace(/[^0-9]/g, "");
    targetPath = path.join(config.sentOutboxDir, `${parsedPath.name}-${movedAt}${parsedPath.ext}`);
  }

  fs.renameSync(sourcePath, targetPath);
  return targetPath;
}

function taskStatusFromResultStatus(resultStatus) {
  if (resultStatus === "waiting_for_user" || resultStatus === "running" || resultStatus === "failed") {
    return resultStatus;
  }

  return "posted";
}

function recordOutboxFailure({ taskStore, candidate, result, error }) {
  if (!taskStore) {
    throw error;
  }

  const problemFields = Array.isArray(error.missingFields) ? error.missingFields : [];
  const taskId = result.task_id || `outbox-${sanitizeId(candidate.fileName)}`;
  const signature = JSON.stringify({
    file: candidate.fileName,
    message: error.message,
    problemFields,
  });

  if (!taskStore.shouldLogOutboxFailure(candidate.fileName, signature)) {
    return;
  }

  taskStore.recordFailure(taskId, {
    thread_ts: result.thread_ts || "",
    result_file: candidate.fileName,
    last_error: `${candidate.fileName}: ${error.message}`,
    problem_fields: problemFields,
  });
  taskStore.rememberOutboxFailure(candidate.fileName, signature);
}

async function processOutboxResults({ config, slackClient, postedStore, taskStore, options }) {
  const candidates = listOutboxCandidates(config);
  let postedCount = 0;

  for (const candidate of candidates) {
    if (postedStore.has(candidate.fileName)) {
      continue;
    }

    const content = fs.readFileSync(candidate.filePath, "utf8");
    const result = parseResultFileContent(content);

    try {
      validateResult(result, candidate.fileName);
    } catch (error) {
      recordOutboxFailure({ taskStore, candidate, result, error });
      continue;
    }

    if (taskStore) {
      taskStore.clearOutboxFailure(candidate.fileName);
      taskStore.transition(result.task_id, "outbox_ready", {
        thread_ts: result.thread_ts,
        result_file: candidate.fileName,
        last_error: "",
      });
    }

    const slackText = buildSlackResultText(result);

    if (options.dryRun) {
      console.log(`[dry-run] Slack 결과 전송 예정: file=${candidate.fileName}, thread_ts=${result.thread_ts}`);
      continue;
    }

    await slackClient.postThreadReply({
      channelId: config.slackChannelId,
      threadTs: result.thread_ts,
      text: slackText,
    });

    postedStore.add(candidate.fileName);
    moveResultToSent(config, candidate.fileName);
    if (taskStore) {
      taskStore.transition(result.task_id, taskStatusFromResultStatus(result.status), {
        thread_ts: result.thread_ts,
        result_file: candidate.fileName,
        last_error: "",
      });
    }
    postedCount += 1;
    console.log(`결과 전송 완료: file=${candidate.fileName}, thread_ts=${result.thread_ts}`);
  }

  return postedCount;
}

module.exports = {
  buildSlackResultText,
  buildTaskFileContent,
  createInboxTaskFile,
  ensureRelayDirectories,
  extractTaskId,
  listOutboxCandidates,
  parseResultFileContent,
  processOutboxResults,
  ResultValidationError,
  sanitizeId,
  taskIdFromMessage,
};
