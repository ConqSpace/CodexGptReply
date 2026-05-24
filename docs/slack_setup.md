# Slack 설정과 실행 방법

## 필요한 Slack Bot Token Scope

Slack App의 Bot Token Scopes에 다음 권한을 추가합니다.

- `channels:read`
- `channels:history`
- `chat:write`

권한을 바꾼 뒤에는 Slack App을 워크스페이스에 다시 설치해야 합니다. 그리고 Bot을 `#codex-gpt` 채널에 초대합니다.

## 로컬 설정

1. `.env.example`을 참고해 프로젝트 루트에 `.env` 파일을 만듭니다.
2. 실제 토큰은 `.env`에만 저장합니다. 저장소에 커밋하지 않습니다.

```env
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_CHANNEL_ID=C0B6QN775FA
POLL_INTERVAL_MS=10000
SLACK_HISTORY_LIMIT=20
```

## 실행 명령

의존성 설치가 필요 없는 Node.js 18 이상 기반 스크립트입니다.

```powershell
node src/relay_daemon.js --once --dry-run
```

한 번만 Slack 메시지를 읽고, 실제 답장은 전송하지 않습니다. 로그와 처리 상태만 로컬에 남깁니다.

```powershell
node src/relay_daemon.js --once
```

한 번만 Slack 메시지를 읽고, `[to-codex]` 메시지에 같은 스레드로 `[codex-result]` 고정 응답을 전송합니다.

```powershell
node src/relay_daemon.js
```

10초마다 `conversations.history`를 호출합니다. Slack API가 `429`를 반환하면 `Retry-After` 값만큼 기다린 뒤 다시 시도합니다.

## 생성되는 로컬 파일

- `logs/relay_events.jsonl`: 감지한 `[to-codex]` 메시지의 `ts`, 작성자, 본문, 스레드 정보를 줄 단위 JSON으로 저장합니다.
- `state/processed_messages.json`: 이미 처리한 Slack 메시지 `ts`를 저장해 중복 처리를 막습니다.

## 메시지 처리 규칙

- 본문이 `[to-codex]`로 시작하는 메시지만 처리합니다.
- `[codex-result]`, `[codex-question]`, `[codex-status]` 메시지는 접두사가 다르므로 무시됩니다.
- `--dry-run`에서도 로그와 처리 상태는 저장됩니다. 같은 메시지를 실제 전송으로 다시 검증하려면 해당 `ts`를 상태 파일에서 제거해야 합니다.
