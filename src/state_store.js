const fs = require("fs");
const path = require("path");

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

  add(fileName) {
    if (this.postedSet.has(fileName)) {
      return;
    }

    this.postedSet.add(fileName);
    this.state.posted_files = Array.from(this.postedSet).sort();
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
  appendJsonLine,
  ensureDirectory,
  readJsonFile,
  writeJsonFileAtomic,
};
