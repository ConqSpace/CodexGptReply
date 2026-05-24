---
name: codex-gpt-relay
description: Use when operating, testing, or monitoring the local CodexGptRelay project that connects GPT and Codex through Slack #codex-gpt, including short relay checks, Slack Web API daemon verification, inbox/outbox workflow planning, and long-running relay log monitoring.
---

# Codex GPT Relay

CodexGptRelay is a local project at `F:\Antigravity\CodexGptRelay`.

Its purpose is to let the user stay mostly in GPT while Slack carries messages between GPT and Codex.

Core flow:

```text
GPT -> Slack #codex-gpt [to-codex] -> relay daemon -> Codex work -> [codex-result]
```

## Safety Rules

- 모든 사용자 설명은 한국어로 작성한다.
- `.env` 파일의 값과 Slack token은 출력하지 않는다. 설정 확인은 key 존재 여부만 말한다.
- 실제 Slack 전송은 사용자가 요청했거나 흐름상 명확할 때만 한다.
- 위험한 파일 삭제, 대량 이동, Git push, 외부 전송은 사용자 확인 없이 실행하지 않는다.
- `logs/`, `state/`, `.env`, `node_modules/`는 저장소에 올리지 않는다.
- 문서를 읽을 때는 UTF-8로 조회한다.

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
6. For results, use one of these prefixes:
   - `[codex-result]`
   - `[codex-question]`
   - `[codex-status]`

Stop or ask the user when:

- Slack authentication fails
- the daemon cannot read the configured channel
- the requested action is destructive or broad
- monitoring has no clear end condition and would run for a long time

## Message Rules

Incoming work must start with:

```text
[to-codex]
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

summary:
<short result>

details:
- <important detail>

needs_user: false
```

Use this question shape when blocked:

```text
[codex-question]
task_id: <id if known>
status: waiting_for_user

question:
<specific question>
```

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

