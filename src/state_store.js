const fs = require("fs");
const path = require("path");

const TASK_STATUSES = new Set([
  "queued",
  "outbox_ready",
  "posted",
  "failed",
  "waiting_for_user",
  "running",
]);

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function readJsonFile(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) {
    return fallbackValue;
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    const backupPath = `${filePath}.corrupt-${Date.now()}`;
    fs.copyFileSync(filePath, backupPath);
    console.warn(`상태 파일을 읽지 못해 백업했습니다: ${backupPath}`);
    return fallbackValue;
  }
}

function writeJsonFileAtomic(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

class ProcessedMessageStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = readJsonFile(filePath, { processed_ts: [] });

    if (!Array.isArray(this.state.processed_ts)) {
      this.state.processed_ts = [];
    }

    this.processedSet = new Set(this.state.processed_ts);
  }

  has(ts) {
    return this.processedSet.has(ts);
  }

  count() {
    return this.processedSet.size;
  }

  add(ts) {
    if (this.processedSet.has(ts)) {
      return;
    }

    this.processedSet.add(ts);
    this.state.processed_ts = Array.from(this.processedSet).sort();
    writeJsonFileAtomic(this.filePath, this.state);
  }
}

class PostedResultStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = readJsonFile(filePath, { posted_files: [] });

    if (!Array.isArray(this.state.posted_files)) {
      this.state.posted_files = [];
    }

    this.postedSet = new Set(this.state.posted_files);
  }

  has(fileName) {
    return this.postedSet.has(fileName);
  }

  count() {
    return this.postedSet.size;
  }

  add(fileName) {
    if (this.postedSet.has(fileName)) {
      return;
    }

    this.postedSet.add(fileName);
    this.state.posted_files = Array.from(this.postedSet).sort();
    writeJsonFileAtomic(this.filePath, this.state);
  }
}

function createEmptyTask(taskId) {
  return {
    task_id: taskId,
    status: "queued",
    message_ts: "",
    thread_ts: "",
    task_file: "",
    result_file: "",
    updated_at: "",
    last_error: "",
  };
}

function normalizeTask(rawTask) {
  const taskId = String(rawTask && rawTask.task_id ? rawTask.task_id : "").trim();
  const task = createEmptyTask(taskId);

  return {
    ...task,
    ...rawTask,
    task_id: taskId,
    status: TASK_STATUSES.has(rawTask && rawTask.status) ? rawTask.status : task.status,
    message_ts: String(rawTask && rawTask.message_ts ? rawTask.message_ts : ""),
    thread_ts: String(rawTask && rawTask.thread_ts ? rawTask.thread_ts : ""),
    task_file: String(rawTask && rawTask.task_file ? rawTask.task_file : ""),
    result_file: String(rawTask && rawTask.result_file ? rawTask.result_file : ""),
    updated_at: String(rawTask && rawTask.updated_at ? rawTask.updated_at : ""),
    last_error: String(rawTask && rawTask.last_error ? rawTask.last_error : ""),
  };
}

function normalizeTaskState(rawState) {
  const state = {
    tasks: [],
    outbox_error_signatures: {},
  };

  if (rawState && Array.isArray(rawState.tasks)) {
    state.tasks = rawState.tasks
      .map((task) => normalizeTask(task))
      .filter((task) => task.task_id);
  }

  if (rawState && rawState.outbox_error_signatures && typeof rawState.outbox_error_signatures === "object") {
    state.outbox_error_signatures = rawState.outbox_error_signatures;
  }

  return state;
}

class TaskStore {
  constructor(filePath, logFilePath) {
    this.filePath = filePath;
    this.logFilePath = logFilePath;
    this.state = normalizeTaskState(readJsonFile(filePath, { tasks: [], outbox_error_signatures: {} }));
    this.taskMap = new Map(this.state.tasks.map((task) => [task.task_id, task]));
  }

  listRecent(limit = 10) {
    return Array.from(this.taskMap.values())
      .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))
      .slice(0, limit);
  }

  get(taskId) {
    return this.taskMap.get(taskId) || null;
  }

  transition(taskId, nextStatus, updates = {}) {
    if (!taskId) {
      return null;
    }

    if (!TASK_STATUSES.has(nextStatus)) {
      throw new Error(`알 수 없는 작업 상태입니다: ${nextStatus}`);
    }

    const now = new Date().toISOString();
    const currentTask = this.get(taskId) || createEmptyTask(taskId);
    const previousStatus = currentTask.status;
    const nextTask = normalizeTask({
      ...currentTask,
      ...updates,
      task_id: taskId,
      status: nextStatus,
      updated_at: now,
    });

    this.taskMap.set(taskId, nextTask);
    this.persist();

    appendJsonLine(this.logFilePath, {
      event: "task_status_changed",
      changed_at: now,
      task_id: taskId,
      from_status: previousStatus,
      to_status: nextStatus,
      message_ts: nextTask.message_ts,
      thread_ts: nextTask.thread_ts,
      task_file: nextTask.task_file,
      result_file: nextTask.result_file,
      last_error: nextTask.last_error,
    });

    return nextTask;
  }

  recordFailure(taskId, updates = {}) {
    const task = this.transition(taskId, "failed", updates);
    const now = task ? task.updated_at : new Date().toISOString();

    appendJsonLine(this.logFilePath, {
      event: "task_failed",
      failed_at: now,
      task_id: taskId,
      message_ts: task ? task.message_ts : updates.message_ts || "",
      thread_ts: task ? task.thread_ts : updates.thread_ts || "",
      task_file: task ? task.task_file : updates.task_file || "",
      result_file: task ? task.result_file : updates.result_file || "",
      last_error: task ? task.last_error : updates.last_error || "",
      problem_fields: updates.problem_fields || [],
    });

    return task;
  }

  shouldLogOutboxFailure(fileName, signature) {
    return this.state.outbox_error_signatures[fileName] !== signature;
  }

  rememberOutboxFailure(fileName, signature) {
    this.state.outbox_error_signatures[fileName] = signature;
    this.persist();
  }

  clearOutboxFailure(fileName) {
    if (!this.state.outbox_error_signatures[fileName]) {
      return;
    }

    delete this.state.outbox_error_signatures[fileName];
    this.persist();
  }

  persist() {
    this.state.tasks = Array.from(this.taskMap.values()).sort((left, right) =>
      String(left.task_id).localeCompare(String(right.task_id))
    );
    writeJsonFileAtomic(this.filePath, this.state);
  }
}

function appendJsonLine(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

module.exports = {
  ProcessedMessageStore,
  PostedResultStore,
  TaskStore,
  TASK_STATUSES,
  appendJsonLine,
  ensureDirectory,
  readJsonFile,
  writeJsonFileAtomic,
};
