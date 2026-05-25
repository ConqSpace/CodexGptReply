---
name: codex-gpt-relay
description: Use when operating, testing, or monitoring the local CodexGptRelay project that connects GPT and Codex through Slack #codex-gpt, including short relay checks, Slack Web API daemon verification, inbox/outbox workflow planning, and long-running relay log monitoring.
---

# Codex GPT Relay

CodexGptRelay is a local project at `F:\Antigravity\CodexGptRelay`.

Its purpose is to let the user stay mostly in GPT while Slack carries messages between GPT and Codex.

Core flow:

```text
GPT -> Slack #codex-gpt "카를로스에게 전달:" -> relay daemon -> Codex work -> [codex-result]
Codex question -> Slack [codex-question] -> GPT/user answer -> Slack [to-codex-reply] -> relay daemon resumes task
```

Slack-facing alias:

- `카를로스`: Codex-side worker
- `조지`: GPT-side user-facing relay
- Prefer `카를로스에게 전달:` and `카를로스에게 답변:` when GPT's Slack sender blocks machine-style tags.
- `task_id` is optional for requests. If omitted, the daemon creates `slack-<message ts>`.
- Thread replies are supported. The daemon reads channel parents with `conversations.history` and expands parents with replies using `conversations.replies`.

## Safety Rules

- 모든 사용자 설명은 한국어로 작성한다.
- `.env` 파일의 값과 Slack token은 출력하지 않는다. 설정 확인은 key 존재 여부만 말한다.
- 실제 Slack 전송은 사용자가 요청했거나 흐름상 명확할 때만 한다.
- 위험한 파일 삭제, 대량 이동, Git push, 외부 전송은 사용자 확인 없이 실행하지 않는다.
- `logs/`, `state/`, `.env`, `node_modules/`는 저장소에 올리지 않는다.
- 문서를 읽을 때는 UTF-8로 조회한다.
- 문서 작업은 Notion 커넥터로 처리하고, 코드 작업은 Git 저장소에서 처리한다. relay daemon은 Notion API를 직접 호출하지 않는다.

## Mode Selection

Use **Short Task Mode** when the user asks for one immediate action:

- "relay 확인해줘"
- "Slack 왕복 테스트해줘"
- "한 번 처리해줘"
- "dry-run 해봐"
- "푸시 전에 검수해줘"

Use **Long Monitoring Mode** when the user asks Codex to keep watching:

- "계속 봐줘"
- "모니터링 모드로 들어가"
- "데몬 로그 보면서 새 작업 있으면 처리해줘"
- "장기 모니터링 시작해줘"

If unclear, default to Short Task Mode.

## Short Task Mode

Goal: perform one bounded check or relay operation.

Checklist:

1. Move to `F:\Antigravity\CodexGptRelay`.
2. Check relevant files without printing secrets:
   - `.env` key presence only
   - `README.md`
   - `docs/roadmap.md`
   - `docs/product_plan.md`
3. Run syntax checks when code changed:

```powershell
node --check src\config.js
node --check src\slack_client.js
node --check src\state_store.js
node --check src\relay_daemon.js
```

4. For read-only relay validation:

```powershell
node src\relay_daemon.js --once --dry-run
```

5. For actual one-time Slack reply, only when requested:

```powershell
node src\relay_daemon.js --once
```

6. Report:
   - 처리된 메시지 수
   - Slack 전송 여부
   - 오류가 있으면 원인과 다음 행동
   - 상태 파일 영향, especially dry-run duplicate behavior

Important: `--dry-run` still reads Slack and stores processed message timestamps. If the same message must be tested again with real sending, remove only that message `ts` from `state/processed_messages.json` after explaining why.

## Long Monitoring Mode

Goal: act like an operator watching relay logs and queued work.

Checklist:

1. Confirm the desired monitoring duration or stop condition if the user did not provide one.
2. Check whether the relay daemon is running if relevant.
3. Watch these files and summarize only meaningful changes:
   - `logs/relay_events.jsonl`
   - `state/processed_messages.json`
   - later phases: `inbox/`, `outbox/`
4. Do not spend tokens on empty loops. Use shell reads or file timestamps first.
5. When a new actionable event appears:
   - identify `ts`, `thread_ts`, `task_id` if present
   - read the request
   - decide whether it is safe to answer, needs user confirmation, or should be ignored
   - 결과를 준비할 때 `templates/outbox_result.pending.md`를 `outbox/<task_id>.pending.md`로 복사한다.
   - 작성 중에는 `.pending.md`로 유지하고, relay daemon이 전송해도 될 때만 `.md`로 이름을 바꾼다.
6. For results, use one of these prefixes:
   - `[codex-result]`
   - `[codex-question]`
   - `[codex-status]`

파일 큐 운영:

- `inbox`와 `outbox` 작업을 처리하기 전에 `docs/codex_app_operations.md`를 읽는다.
- 새 작업의 기준 자료는 `logs/relay_events.jsonl`과 `inbox/task_<task_id>.md`로 본다.
- 모든 `outbox` 결과 파일에는 `inbox` 작업 파일의 `thread_ts`를 그대로 복사한다.
- `outbox` 필수 필드는 `task_id`, `status`, `thread_ts`, `message`이다. 사용자 확인이 필요하면 `needs_user: true`도 적는다.
- 위험하거나 불명확한 작업은 `status: waiting_for_user`와 `needs_user: true`를 사용해 daemon이 `[codex-question]`으로 답하게 한다.
- 결과가 완성되고 전송해도 안전하다고 판단하기 전에는 최종 `outbox/*.md` 파일을 만들지 않는다.
- 사용자 답변은 `[to-codex-reply]` 메시지로 들어온다. `task_id`가 없으면 같은 Slack 스레드의 기존 작업을 찾고, Slack 스레드가 기존 작업과 다르면 무시된다.

Stop or ask the user when:

- Slack authentication fails
- the daemon cannot read the configured channel
- the requested action is destructive or broad
- monitoring has no clear end condition and would run for a long time

## Message Rules

Incoming work should preferably start with:

```text
카를로스에게 전달:
<request>
```

Machine-style work can start with:

```text
[to-codex]
```

If GPT's Slack sender blocks the machine-style tag, use the human-friendly equivalent. The daemon can also read:

```text
카를로스 요청
작업 ID: <optional task id>

요청:
<request>
```

`Codex 요청` is also accepted:

```text
Codex 요청
작업 ID: <optional task id>

요청:
<request>
```

English labels are also accepted:

```text
Codex request
Task ID: <optional task id>

Request:
<request>
```

Incoming user replies must start with:

```text
[to-codex-reply]
task_id: <optional task id when replying in the same Slack thread>
thread_ts: <recommended Slack thread ts>
answer: |
  <user answer>
```

If the machine-style reply is blocked, use the Carlos-George alias:

```text
카를로스 답변
작업 ID: <optional task id when replying in the same Slack thread>
thread_ts: <recommended Slack thread ts>
답변: |
  <user answer>
```

`Codex 답변` is also accepted:

```text
Codex 답변
작업 ID: <optional task id when replying in the same Slack thread>
thread_ts: <recommended Slack thread ts>
답변: |
  <user answer>
```

English labels are also accepted:

```text
Codex reply
Task ID: <optional task id when replying in the same Slack thread>
thread_ts: <recommended Slack thread ts>
answer: |
  <user answer>
```

The relay should ignore:

```text
[codex-result]
[codex-question]
[codex-status]
```

Use this result shape for Slack-ready output:

```text
[codex-result]
task_id: <id if known>
status: completed
needs_user: false

summary:
<short result>

details:
- <important detail>
```

Use this question shape when blocked:

```text
[codex-question]
task_id: <id if known>
status: waiting_for_user
needs_user: true

question:
<specific question>
```

When `[to-codex-reply]` is valid, the daemon records `last_user_reply` in `state/tasks.json`, writes a `user_reply_received` event, and changes the task status back to `running`. Invalid replies only create `user_reply_ignored` events and must not trigger execution.

Verified workflow:

- Notion `Simple Memo` database was used for planning docs through the Codex app Notion connector.
- GitHub `ConqSpace/SimpleMemo` was used for README and test file commits.
- Slack thread replies were detected and answered in the same thread.

## Project Commands

From `F:\Antigravity\CodexGptRelay`:

```powershell
npm run dry-run
npm run once
npm start
```

Direct commands:

```powershell
node src\relay_daemon.js --once --dry-run
node src\relay_daemon.js --once
node src\relay_daemon.js
```

GitHub repository:

```text
https://github.com/ConqSpace/CodexGptReply
```
