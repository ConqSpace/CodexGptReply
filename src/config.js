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

function sanitizeProjectId(rawValue) {
  return String(rawValue || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "default";
}

function readProjectsFile(filePath, fallbackProject) {
  if (!fs.existsSync(filePath)) {
    return {
      defaultProjectId: fallbackProject.id,
      projects: [fallbackProject],
    };
  }

  const content = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(content);
  const rawProjects = Array.isArray(parsed.projects) ? parsed.projects : [];
  const projects = rawProjects.map((project) => normalizeProject(project)).filter((project) => project.id);

  if (projects.length === 0) {
    projects.push(fallbackProject);
  }

  return {
    defaultProjectId: sanitizeProjectId(parsed.defaultProjectId || projects[0].id),
    projects,
  };
}

function normalizeProject(rawProject) {
  const id = sanitizeProjectId(rawProject && rawProject.id);
  const enabled = rawProject && Object.prototype.hasOwnProperty.call(rawProject, "enabled")
    ? rawProject.enabled !== false
    : true;

  return {
    id,
    name: String(rawProject && rawProject.name ? rawProject.name : id),
    enabled,
    slackChannelId: String(rawProject && rawProject.slackChannelId ? rawProject.slackChannelId : ""),
    repoPath: String(rawProject && rawProject.repoPath ? rawProject.repoPath : ""),
    githubUrl: String(rawProject && rawProject.githubUrl ? rawProject.githubUrl : ""),
  };
}

function loadConfig() {
  const envFileValues = parseEnvFile(path.join(PROJECT_ROOT, ".env"));
  const mergedEnv = {
    ...envFileValues,
    ...process.env,
  };
  const fallbackProject = normalizeProject({
    id: "default",
    name: "Default",
    enabled: true,
    slackChannelId: mergedEnv.SLACK_CHANNEL_ID || "C0B6QN775FA",
    repoPath: PROJECT_ROOT,
    githubUrl: "",
  });
  const projectsConfig = readProjectsFile(path.join(PROJECT_ROOT, "config", "projects.json"), fallbackProject);
  const enabledProjects = projectsConfig.projects.filter((project) => project.enabled && project.slackChannelId);
  const projects = enabledProjects.length > 0 ? enabledProjects : [fallbackProject];
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const defaultProject = projectById.get(projectsConfig.defaultProjectId) || projects[0];

  return {
    projectRoot: PROJECT_ROOT,
    slackBotToken: mergedEnv.SLACK_BOT_TOKEN || "",
    slackChannelId: defaultProject.slackChannelId,
    defaultProjectId: defaultProject.id,
    projects,
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
