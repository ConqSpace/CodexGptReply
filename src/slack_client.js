const fs = require("fs");
const path = require("path");

const SLACK_API_BASE_URL = "https://slack.com/api";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class SlackClient {
  constructor({ token }) {
    this.token = token;
  }

  async apiCall(method, body) {
    if (!this.token) {
      throw new Error("SLACK_BOT_TOKEN이 설정되지 않았습니다.");
    }

    while (true) {
      const response = await fetch(`${SLACK_API_BASE_URL}/${method}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body),
      });

      if (response.status === 429) {
        const retryAfterSeconds = Number(response.headers.get("retry-after") || "1");
        const waitMs = Math.max(retryAfterSeconds, 1) * 1000;
        console.warn(`Slack API 제한을 받았습니다. ${waitMs}ms 후 다시 시도합니다.`);
        await sleep(waitMs);
        continue;
      }

      const responseBody = await response.json();

      if (!response.ok || !responseBody.ok) {
        const errorCode = responseBody.error || `http_${response.status}`;
        throw new Error(`Slack API 호출 실패(${method}): ${errorCode}`);
      }

      return responseBody;
    }
  }

  async apiGet(method, params) {
    if (!this.token) {
      throw new Error("SLACK_BOT_TOKEN이 설정되지 않았습니다.");
    }

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.set(key, String(value));
      }
    }

    while (true) {
      const response = await fetch(`${SLACK_API_BASE_URL}/${method}?${searchParams.toString()}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (response.status === 429) {
        const retryAfterSeconds = Number(response.headers.get("retry-after") || "1");
        const waitMs = Math.max(retryAfterSeconds, 1) * 1000;
        console.warn(`Slack API 제한을 받았습니다. ${waitMs}ms 후 다시 시도합니다.`);
        await sleep(waitMs);
        continue;
      }

      const responseBody = await response.json();

      if (!response.ok || !responseBody.ok) {
        const errorCode = responseBody.error || `http_${response.status}`;
        throw new Error(`Slack API 호출 실패(${method}): ${errorCode}`);
      }

      return responseBody;
    }
  }

  async fetchRecentMessages({ channelId, limit }) {
    const response = await this.apiCall("conversations.history", {
      channel: channelId,
      limit,
      inclusive: true,
    });

    return response.messages || [];
  }

  async fetchThreadReplies({ channelId, threadTs, limit }) {
    const response = await this.apiGet("conversations.replies", {
      channel: channelId,
      ts: threadTs,
      limit,
    });

    return response.messages || [];
  }

  async postThreadReply({ channelId, threadTs, text }) {
    return this.apiCall("chat.postMessage", {
      channel: channelId,
      thread_ts: threadTs,
      text,
    });
  }

  async uploadFileToThread({ channelId, threadTs, filePath, title, initialComment }) {
    const fileStats = fs.statSync(filePath);
    const fileName = path.basename(filePath);
    const uploadTicket = await this.apiCall("files.getUploadURLExternal", {
      filename: fileName,
      length: fileStats.size,
    });

    const uploadResponse = await fetch(uploadTicket.upload_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: fs.readFileSync(filePath),
    });

    if (!uploadResponse.ok) {
      throw new Error(`Slack 파일 업로드 실패: http_${uploadResponse.status}`);
    }

    return this.apiCall("files.completeUploadExternal", {
      channel_id: channelId,
      thread_ts: threadTs,
      initial_comment: initialComment || "",
      files: [
        {
          id: uploadTicket.file_id,
          title: title || fileName,
        },
      ],
    });
  }
}

module.exports = {
  SlackClient,
  sleep,
};
