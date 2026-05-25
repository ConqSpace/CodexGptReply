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

  for (const project of config.projects || []) {
    fs.mkdirSync(projectInboxDir(config, project.id), { recursive: true });
    fs.mkdirSync(projectOutboxDir(config, project.id), { recursive: true });
    fs.mkdirSync(projectSentOutboxDir(config, project.id), { recursive: true });
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

function taskIdFromMessage(message, project) {
  const explicitTaskId = extractTaskId(message.text || "");
  if (explicitTaskId) {
    return explicitTaskId;
  }

  const projectPrefix = project && project.id ? `${project.id}-` : "";
  return sanitizeId(`${projectPrefix}slack-${message.ts || Date.now()}`);
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

function buildTaskFileContent({ channelId, message, taskId, detectedAt, project }) {
  const threadTs = message.thread_ts || message.ts;
  const author = message.user || message.bot_id || "unknown";
  const request = stripToCodexPrefix(message.text || "");
  const projectId = project && project.id ? project.id : "default";
  const projectName = project && project.name ? project.name : projectId;
  const repoPath = project && project.repoPath ? project.repoPath : "";
  const githubUrl = project && project.githubUrl ? project.githubUrl : "";
  const notion = project && project.notion ? project.notion : { mode: "none" };
  const notionTarget = notion.databaseName || notion.pageName || notion.mode || "none";

  return `# Codex 작업 요청

- task_id: ${taskId}
- project_id: ${projectId}
- project_name: ${projectName}
- repo_path: ${repoPath}
- github_url: ${githubUrl}
- notion_target: ${notionTarget}
- channel: ${channelId}
- message_ts: ${message.ts}
- thread_ts: ${threadTs}
- author: ${author}
- detected_at: ${detectedAt}

## 원문 request

${request}
`;
}

function projectInboxDir(config, projectId) {
  return path.join(config.inboxDir, sanitizeId(projectId));
}

function projectOutboxDir(config, projectId) {
  return path.join(config.outboxDir, sanitizeId(projectId));
}

function projectSentOutboxDir(config, projectId) {
  return path.join(config.sentOutboxDir, sanitizeId(projectId));
}

function createInboxTaskFile({ config, channelId, message, detectedAt, project }) {
  const taskId = taskIdFromMessage(message, project);
  const projectId = project && project.id ? project.id : config.defaultProjectId || "default";
  const fileName = `task_${taskId}.md`;
  const inboxDir = projectInboxDir(config, projectId);
  const filePath = path.join(inboxDir, fileName);
  const content = buildTaskFileContent({
    channelId,
    message,
    taskId,
    detectedAt,
    project,
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

  const candidates = [];
  const projects = config.projects && config.projects.length > 0
    ? config.projects
    : [{ id: config.defaultProjectId || "default", slackChannelId: config.slackChannelId }];
  const defaultProject = projects.find((project) => project.id === config.defaultProjectId) || projects[0];

  for (const entry of fs.readdirSync(config.outboxDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.endsWith(".pending.md")) {
      continue;
    }

    candidates.push({
      project: defaultProject,
      projectId: defaultProject.id,
      fileName: entry.name,
      storeKey: `${defaultProject.id}/${entry.name}`,
      filePath: path.join(config.outboxDir, entry.name),
    });
  }

  for (const project of projects) {
    const outboxDir = projectOutboxDir(config, project.id);
    if (!fs.existsSync(outboxDir)) {
      continue;
    }

    for (const entry of fs.readdirSync(outboxDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name.endsWith(".pending.md")) {
        continue;
      }

      candidates.push({
        project,
        projectId: project.id,
        fileName: entry.name,
        storeKey: `${project.id}/${entry.name}`,
        filePath: path.join(outboxDir, entry.name),
      });
    }
  }

  return candidates.sort((left, right) => left.storeKey.localeCompare(right.storeKey));
}

function moveResultToSent(config, candidate) {
  const sourcePath = candidate.filePath;
  const sentDir = projectSentOutboxDir(config, candidate.projectId || config.defaultProjectId || "default");
  fs.mkdirSync(sentDir, { recursive: true });
  let targetPath = path.join(sentDir, candidate.fileName);

  if (fs.existsSync(targetPath)) {
    const parsedPath = path.parse(candidate.fileName);
    const movedAt = new Date().toISOString().replace(/[^0-9]/g, "");
    targetPath = path.join(sentDir, `${parsedPath.name}-${movedAt}${parsedPath.ext}`);
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
    if (postedStore.has(candidate.storeKey)) {
      continue;
    }

    const content = fs.readFileSync(candidate.filePath, "utf8");
    const result = parseResultFileContent(content);
    result.project_id = result.project_id || candidate.projectId;

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
      channelId: candidate.project.slackChannelId,
      threadTs: result.thread_ts,
      text: slackText,
    });

    postedStore.add(candidate.storeKey);
    moveResultToSent(config, candidate);
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
  projectInboxDir,
  projectOutboxDir,
  projectSentOutboxDir,
  ResultValidationError,
  sanitizeId,
  taskIdFromMessage,
};
