const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, "utf8");
  const values = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function readNumber(rawValue, fallbackValue) {
  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallbackValue;
  }

  return parsedValue;
}

function loadConfig() {
  const envFileValues = parseEnvFile(path.join(PROJECT_ROOT, ".env"));
  const mergedEnv = {
    ...envFileValues,
    ...process.env,
  };

  return {
    projectRoot: PROJECT_ROOT,
    slackBotToken: mergedEnv.SLACK_BOT_TOKEN || "",
    slackChannelId: mergedEnv.SLACK_CHANNEL_ID || "C0B6QN775FA",
    pollIntervalMs: readNumber(mergedEnv.POLL_INTERVAL_MS, 10000),
    slackHistoryLimit: readNumber(mergedEnv.SLACK_HISTORY_LIMIT, 20),
    logFilePath: path.join(PROJECT_ROOT, "logs", "relay_events.jsonl"),
    processedMessagesPath: path.join(PROJECT_ROOT, "state", "processed_messages.json"),
    postedResultsPath: path.join(PROJECT_ROOT, "state", "posted_results.json"),
    tasksPath: path.join(PROJECT_ROOT, "state", "tasks.json"),
    inboxDir: path.join(PROJECT_ROOT, "inbox"),
    outboxDir: path.join(PROJECT_ROOT, "outbox"),
    sentOutboxDir: path.join(PROJECT_ROOT, "outbox", "sent"),
    logsDir: path.join(PROJECT_ROOT, "logs"),
    stateDir: path.join(PROJECT_ROOT, "state"),
  };
}

module.exports = {
  loadConfig,
};
