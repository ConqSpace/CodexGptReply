const { loadConfig } = require("./config");
const { SlackClient, sleep } = require("./slack_client");
const { ProcessedMessageStore, PostedResultStore, TaskStore, appendJsonLine } = require("./state_store");
const {
  createInboxTaskFile,
  ensureRelayDirectories,
  processOutboxResults,
} = require("./file_queue");

const TO_CODEX_PREFIX = "[to-codex]";
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
  return text.startsWith(TO_CODEX_PREFIX);
}

function buildEventRecord({ channelId, message, dryRun }) {
  const detectedAt = new Date().toISOString();

  return {
    event: "to_codex_message_detected",
    detected_at: detectedAt,
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
        `status=${task.status}`,
        `message_ts=${task.message_ts || "-"}`,
        `thread_ts=${task.thread_ts || "-"}`,
        `task_file=${task.task_file || "-"}`,
        `result_file=${task.result_file || "-"}`,
        `updated_at=${task.updated_at || "-"}`,
        `last_error=${task.last_error || "-"}`,
      ].join(" | ")
    );
  }
}

async function processMessages({ config, slackClient, processedStore, taskStore, options }) {
  const messages = await slackClient.fetchRecentMessages({
    channelId: config.slackChannelId,
    limit: config.slackHistoryLimit,
  });

  let processedCount = 0;
  const orderedMessages = [...messages].reverse();

  for (const message of orderedMessages) {
    if (!message.ts || processedStore.has(message.ts) || !isToCodexMessage(message)) {
      continue;
    }

    const eventRecord = buildEventRecord({
      channelId: config.slackChannelId,
      message,
      dryRun: options.dryRun,
    });
    appendJsonLine(config.logFilePath, eventRecord);

    const taskFile = createInboxTaskFile({
      config,
      channelId: config.slackChannelId,
      message,
      detectedAt: eventRecord.detected_at,
    });
    appendJsonLine(config.logFilePath, buildTaskCreatedEvent({ eventRecord, taskFile }));

    const threadTs = message.thread_ts || message.ts;
    if (taskStore && typeof taskStore.transition === "function") {
      taskStore.transition(taskFile.taskId, "queued", {
        message_ts: message.ts,
        thread_ts: threadTs,
        task_file: taskFile.fileName,
        result_file: "",
        last_error: "",
      });
    }

    processedStore.add(message.ts);
    processedCount += 1;
    console.log(`작업 파일 생성 완료: task_id=${taskFile.taskId}, ts=${message.ts}, thread_ts=${threadTs}`);
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

  console.log(`CodexGptRelay 시작: channel=${config.slackChannelId}, interval=${config.pollIntervalMs}ms, dryRun=${options.dryRun}`);

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

      console.log(`이번 조회 작업 생성 수: ${processedCount}, 결과 전송 수: ${postedCount}`);
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
  buildFixedReply,
  buildTaskCreatedEvent,
};
