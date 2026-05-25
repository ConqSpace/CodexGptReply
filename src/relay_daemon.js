const { loadConfig } = require("./config");
const { SlackClient, sleep } = require("./slack_client");
const { ProcessedMessageStore, PostedResultStore, TaskStore, appendJsonLine } = require("./state_store");
const {
  createInboxTaskFile,
  ensureRelayDirectories,
  processOutboxResults,
} = require("./file_queue");

const TO_CODEX_PREFIX = "[to-codex]";
const TO_CODEX_REPLY_PREFIX = "[to-codex-reply]";
const HUMAN_CODEX_REQUEST_PREFIXES = [
  /^Codex\s*요청(?:\s|$)/i,
  /^Codex\s*request(?:\s|$)/i,
  /^카를로스\s*요청(?:\s|$)/i,
  /^카를로스에게\s*전달\s*:?/i,
  /^Carlos\s*request(?:\s|$)/i,
  /^Codex에게\s*전달할\s*작업입니다\.?/i,
];
const HUMAN_CODEX_REPLY_PREFIXES = [
  /^Codex\s*답변(?:\s|$)/i,
  /^Codex\s*reply(?:\s|$)/i,
  /^카를로스\s*답변(?:\s|$)/i,
  /^카를로스에게\s*답변\s*:?/i,
  /^Carlos\s*reply(?:\s|$)/i,
  /^Codex에게\s*전달할\s*답변입니다\.?/i,
];
const CODEX_RESULT_PREFIX = "[codex-result]";

function parseArguments(argv) {
  const options = {
    dryRun: false,
    once: false,
    status: false,
  };

  for (const argument of argv) {
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (argument === "--once") {
      options.once = true;
      continue;
    }

    if (argument === "--status") {
      options.status = true;
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }

    throw new Error(`알 수 없는 옵션입니다: ${argument}`);
  }

  return options;
}

function printHelp() {
  console.log(`사용법:
  node src/relay_daemon.js [--dry-run] [--once]
  node src/relay_daemon.js --status

옵션:
  --dry-run  Slack 답장 전송을 건너뛰고 로그와 상태 저장만 수행합니다.
  --once     conversations.history를 한 번만 조회하고 종료합니다.
  --status   최근 작업 상태를 출력하고 종료합니다.
`);
}

function isToCodexMessage(message) {
  const text = typeof message.text === "string" ? message.text.trimStart() : "";
  return text.startsWith(TO_CODEX_PREFIX) || HUMAN_CODEX_REQUEST_PREFIXES.some((pattern) => pattern.test(text));
}

function isToCodexReplyMessage(message) {
  const text = typeof message.text === "string" ? message.text.trimStart() : "";
  return text.startsWith(TO_CODEX_REPLY_PREFIX) || HUMAN_CODEX_REPLY_PREFIXES.some((pattern) => pattern.test(text));
}

function parseFieldBlock(text) {
  const values = {};
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^([A-Za-z0-9_-]+|task\s*id|작업\s*ID|작업\s*아이디|답변)\s*:\s*(.*)$/i);
    if (!match) {
      continue;
    }

    const rawKey = match[1];
    const normalizedKey = rawKey.replace(/\s+/g, "").toLowerCase();
    const key = normalizedKey === "작업id" || normalizedKey === "작업아이디"
      ? "task_id"
      : normalizedKey === "taskid"
        ? "task_id"
      : normalizedKey === "답변"
        ? "answer"
        : rawKey;
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

    values[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }

  return values;
}

function stripToCodexReplyPrefix(text) {
  return String(text || "")
    .replace(/^\s*\[to-codex-reply\]\s*/i, "")
    .replace(/^\s*Codex\s*답변(?:\s|$)/i, "")
    .replace(/^\s*Codex\s*reply(?:\s|$)/i, "")
    .replace(/^\s*카를로스\s*답변(?:\s|$)/i, "")
    .replace(/^\s*카를로스에게\s*답변\s*:?\s*/i, "")
    .replace(/^\s*Carlos\s*reply(?:\s|$)/i, "")
    .replace(/^\s*Codex에게\s*전달할\s*답변입니다\.?\s*/i, "")
    .trim();
}

function parseReplyMessage(message) {
  const body = stripToCodexReplyPrefix(message.text || "");
  const values = parseFieldBlock(body);

  if (!values.answer) {
    const firstBlankLineIndex = body.search(/\r?\n\r?\n/);
    if (firstBlankLineIndex !== -1) {
      values.answer = body.slice(firstBlankLineIndex).trim();
    } else {
      values.answer = body.trim();
    }
  }

  return {
    task_id: values.task_id || "",
    thread_ts: values.thread_ts || "",
    answer: values.answer || values.message || "",
  };
}

function messageStoreKey(channelId, messageTs) {
  return `${channelId}:${messageTs}`;
}

function buildReplyIgnoredEvent({ channelId, message, reason, taskId, expectedThreadTs, actualThreadTs, project }) {
  return {
    event: "user_reply_ignored",
    ignored_at: new Date().toISOString(),
    project_id: project ? project.id : "",
    channel: channelId,
    ts: message.ts || "",
    task_id: taskId || "",
    reason,
    expected_thread_ts: expectedThreadTs || "",
    actual_thread_ts: actualThreadTs || "",
  };
}

function buildEventRecord({ channelId, message, dryRun, project }) {
  const detectedAt = new Date().toISOString();

  return {
    event: "to_codex_message_detected",
    detected_at: detectedAt,
    project_id: project ? project.id : "",
    project_name: project ? project.name : "",
    channel: channelId,
    ts: message.ts,
    author: message.user || message.bot_id || "unknown",
    body: message.text || "",
    thread_ts: message.thread_ts || message.ts,
    is_thread_parent: !message.thread_ts || message.thread_ts === message.ts,
    dry_run: dryRun,
  };
}

function buildTaskCreatedEvent({ eventRecord, taskFile }) {
  return {
    event: "task_created",
    detected_at: eventRecord.detected_at,
    project_id: eventRecord.project_id || "",
    project_name: eventRecord.project_name || "",
    task_id: taskFile.taskId,
    task_file: taskFile.fileName,
    task_file_created: taskFile.created,
    channel: eventRecord.channel,
    message_ts: eventRecord.ts,
    thread_ts: eventRecord.thread_ts,
    author: eventRecord.author,
  };
}

function buildFixedReply(message) {
  const threadTs = message.thread_ts || message.ts;

  return `${CODEX_RESULT_PREFIX}
status: completed

summary:
Slack 왕복 검증용 고정 응답입니다.

details:
- 원본 메시지 ts: ${message.ts}
- 응답 스레드 ts: ${threadTs}
- 실제 Codex 작업 실행은 1단계 범위에 포함하지 않습니다.

needs_user: false`;
}

function printStatus({ taskStore, processedStore, postedStore }) {
  const recentTasks = taskStore.listRecent(10);

  console.log("CodexGptRelay 최근 작업 상태");
  console.log(`처리한 Slack 메시지 수: ${processedStore.count()}`);
  console.log(`전송 완료 결과 파일 수: ${postedStore.count()}`);

  if (recentTasks.length === 0) {
    console.log("최근 작업이 없습니다.");
    return;
  }

  for (const task of recentTasks) {
    console.log(
      [
        `task_id=${task.task_id}`,
        `project_id=${task.project_id || "-"}`,
        `status=${task.status}`,
        `message_ts=${task.message_ts || "-"}`,
        `thread_ts=${task.thread_ts || "-"}`,
        `task_file=${task.task_file || "-"}`,
        `result_file=${task.result_file || "-"}`,
        `updated_at=${task.updated_at || "-"}`,
        `last_user_reply_at=${task.last_user_reply ? task.last_user_reply.received_at : "-"}`,
        `last_error=${task.last_error || "-"}`,
      ].join(" | ")
    );
  }
}

function shouldFetchThreadReplies(message) {
  const replyCount = Number(message.reply_count || 0);

  return Boolean(message.ts && replyCount > 0);
}

async function collectMessagesForProcessing({ config, slackClient }) {
  const channelMessages = await slackClient.fetchRecentMessages({
    channelId: config.slackChannelId,
    limit: config.slackHistoryLimit,
  });
  const messagesByTs = new Map();

  for (const message of channelMessages) {
    if (message.ts) {
      messagesByTs.set(message.ts, message);
    }

    if (!shouldFetchThreadReplies(message)) {
      continue;
    }

    const threadTs = message.thread_ts || message.ts;
    const replies = await slackClient.fetchThreadReplies({
      channelId: config.slackChannelId,
      threadTs,
      limit: config.slackHistoryLimit,
    });

    for (const reply of replies) {
      if (reply.ts) {
        messagesByTs.set(reply.ts, reply);
      }
    }
  }

  return [...messagesByTs.values()].sort((left, right) => Number(left.ts || 0) - Number(right.ts || 0));
}

function validateReply({ parsedReply, message, taskStore }) {
  const actualThreadTs = message.thread_ts || message.ts || "";

  if (!parsedReply.task_id) {
    const taskByThread = taskStore.findByThreadTs(actualThreadTs);
    if (!taskByThread) {
      return {
        valid: false,
        reason: "task_id 없음",
        task: null,
        actualThreadTs,
      };
    }

    parsedReply.task_id = taskByThread.task_id;
  }

  const task = taskStore.get(parsedReply.task_id);
  if (!task) {
    return {
      valid: false,
      reason: "알 수 없는 task_id",
      task: null,
      actualThreadTs,
    };
  }

  const expectedThreadTs = task.thread_ts || "";

  if (expectedThreadTs && actualThreadTs && expectedThreadTs !== actualThreadTs) {
    return {
      valid: false,
      reason: "Slack 스레드 불일치",
      task,
      actualThreadTs,
    };
  }

  if (parsedReply.thread_ts && expectedThreadTs && parsedReply.thread_ts !== expectedThreadTs) {
    return {
      valid: false,
      reason: "본문 thread_ts 불일치",
      task,
      actualThreadTs,
    };
  }

  if (!parsedReply.answer) {
    return {
      valid: false,
      reason: "answer 없음",
      task,
      actualThreadTs,
    };
  }

  return {
    valid: true,
    reason: "",
    task,
    actualThreadTs,
  };
}

function processReplyMessage({ config, project, message, processedStore, taskStore }) {
  const parsedReply = parseReplyMessage(message);
  const validation = validateReply({ parsedReply, message, taskStore });

  if (!validation.valid) {
    appendJsonLine(
      config.logFilePath,
      buildReplyIgnoredEvent({
        channelId: config.slackChannelId,
        message,
        reason: validation.reason,
        taskId: parsedReply.task_id,
        expectedThreadTs: validation.task ? validation.task.thread_ts : "",
        actualThreadTs: validation.actualThreadTs,
        project,
      })
    );
    processedStore.add(messageStoreKey(project.slackChannelId, message.ts));
    console.log(`사용자 답변 무시: ts=${message.ts}, reason=${validation.reason}`);
    return false;
  }

  const receivedAt = new Date().toISOString();
  taskStore.recordUserReply(parsedReply.task_id, {
    answer: parsedReply.answer,
    reply_message_ts: message.ts,
    received_at: receivedAt,
  });

  processedStore.add(messageStoreKey(project.slackChannelId, message.ts));
  console.log(`사용자 답변 수신: task_id=${parsedReply.task_id}, ts=${message.ts}`);
  return true;
}

async function processProjectMessages({ config, project, slackClient, processedStore, taskStore, options }) {
  const projectConfig = {
    ...config,
    slackChannelId: project.slackChannelId,
  };
  const messages = await collectMessagesForProcessing({ config: projectConfig, slackClient });

  let processedCount = 0;
  const orderedMessages = messages;

  for (const message of orderedMessages) {
    const storeKey = message.ts ? messageStoreKey(project.slackChannelId, message.ts) : "";
    if (!message.ts || processedStore.has(storeKey) || processedStore.has(message.ts)) {
      continue;
    }

    if (isToCodexReplyMessage(message)) {
      processReplyMessage({
        config: projectConfig,
        project,
        message,
        processedStore,
        taskStore,
      });
      processedCount += 1;
      continue;
    }

    if (!isToCodexMessage(message)) {
      continue;
    }

    const eventRecord = buildEventRecord({
      channelId: project.slackChannelId,
      message,
      dryRun: options.dryRun,
      project,
    });
    appendJsonLine(config.logFilePath, eventRecord);

    const taskFile = createInboxTaskFile({
      config,
      channelId: project.slackChannelId,
      message,
      detectedAt: eventRecord.detected_at,
      project,
    });
    appendJsonLine(config.logFilePath, buildTaskCreatedEvent({ eventRecord, taskFile }));

    const threadTs = message.thread_ts || message.ts;
    if (taskStore && typeof taskStore.transition === "function") {
      taskStore.transition(taskFile.taskId, "queued", {
        project_id: project.id,
        message_ts: message.ts,
        thread_ts: threadTs,
        task_file: taskFile.fileName,
        result_file: "",
        last_error: "",
      });
    }

    processedStore.add(storeKey);
    processedCount += 1;
    console.log(`작업 파일 생성 완료: task_id=${taskFile.taskId}, ts=${message.ts}, thread_ts=${threadTs}`);
  }

  return processedCount;
}

async function processMessages({ config, slackClient, processedStore, taskStore, options }) {
  let processedCount = 0;

  for (const project of config.projects) {
    processedCount += await processProjectMessages({
      config,
      project,
      slackClient,
      processedStore,
      taskStore,
      options,
    });
  }

  return processedCount;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const config = loadConfig();
  ensureRelayDirectories(config);

  const processedStore = new ProcessedMessageStore(config.processedMessagesPath);
  const postedStore = new PostedResultStore(config.postedResultsPath);
  const taskStore = new TaskStore(config.tasksPath, config.logFilePath);

  if (options.status) {
    printStatus({ taskStore, processedStore, postedStore });
    return;
  }

  const slackClient = new SlackClient({ token: config.slackBotToken });

  console.log(`CodexGptRelay 시작: projects=${config.projects.map((project) => `${project.id}:${project.slackChannelId}`).join(", ")}, interval=${config.pollIntervalMs}ms, dryRun=${options.dryRun}`);

  while (true) {
    try {
      const processedCount = await processMessages({
        config,
        slackClient,
        processedStore,
        taskStore,
        options,
      });
      const postedCount = await processOutboxResults({
        config,
        slackClient,
        postedStore,
        taskStore,
        options,
      });

      console.log(`이번 조회 처리 메시지 수: ${processedCount}, 결과 전송 수: ${postedCount}`);
    } catch (error) {
      console.error(`조회 실패: ${error.message}`);
    }

    if (options.once) {
      break;
    }

    await sleep(config.pollIntervalMs);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`실행 실패: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  processMessages,
  isToCodexMessage,
  isToCodexReplyMessage,
  parseReplyMessage,
  processReplyMessage,
  buildFixedReply,
  buildTaskCreatedEvent,
};
