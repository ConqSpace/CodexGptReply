# CodexGptRelay

Slack을 중계 채널로 사용해 GPT와 Codex 사이의 반자동 대화를 실험하는 로컬 relay daemon입니다.

사용자는 GPT 화면에 머물고, GPT는 Slack에 `[to-codex]` 요청을 남깁니다. 로컬 데몬은 Slack Web API로 해당 메시지를 감지한 뒤, 같은 스레드에 `[codex-result]` 형식의 응답을 남깁니다.

## 목표

- 사용자는 가능하면 GPT 화면에 머무릅니다.
- GPT는 Slack `#codex-gpt` 채널에 Codex용 요청을 남깁니다.
- 로컬 데몬은 Slack 메시지를 감지하고 중복 처리 여부를 기록합니다.
- 데몬은 Slack 스레드에 구조화된 테스트 결과를 남깁니다.
- GPT는 Slack 답장을 읽고 사용자에게 다시 전달합니다.

## 1차 범위

- `[to-codex]` 접두사가 붙은 Slack 메시지만 처리합니다.
- 데몬 답장은 `[codex-result]` 접두사를 붙입니다.
- 처음에는 Slack 왕복만 검증합니다.
- Notion 기록과 파일 수정 실행은 왕복 흐름이 안정된 뒤 추가합니다.

## 동작 흐름

```text
GPT
-> Slack #codex-gpt [to-codex]
-> CodexGptRelay daemon
-> logs/relay_events.jsonl 기록
-> state/processed_messages.json 중복 처리 방지
-> Slack thread [codex-result]
-> GPT
```

## 요구 사항

- Node.js 18 이상
- Slack App Bot Token
- Slack Bot Token Scope
  - `channels:read`
  - `channels:history`
  - `chat:write`

## 설정

`.env.example`을 참고해 프로젝트 루트에 `.env` 파일을 만듭니다.

```env
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_CHANNEL_ID=C0B6QN775FA
POLL_INTERVAL_MS=10000
SLACK_HISTORY_LIMIT=20
```

실제 Slack 토큰은 저장소에 넣지 않습니다. `.env`는 `.gitignore`에 포함되어 있습니다.

Slack App 권한을 바꾼 뒤에는 워크스페이스에 다시 설치하고, 봇을 `#codex-gpt` 채널에 초대해야 합니다.

```text
/invite @봇이름
```

## 실행

```powershell
node src/relay_daemon.js --once --dry-run
```

위 명령은 Slack 최근 메시지를 한 번만 읽고, 실제 Slack 답장 전송 없이 로컬 로그와 처리 상태만 확인합니다.

```powershell
node src/relay_daemon.js --once
```

위 명령은 `[to-codex]` 메시지를 감지하면 같은 스레드에 `[codex-result]` 고정 응답을 한 번 전송합니다.

```powershell
node src/relay_daemon.js
```

위 명령은 기본 10초 간격으로 계속 폴링합니다.

같은 명령을 npm 스크립트로도 실행할 수 있습니다.

```powershell
npm run dry-run
npm run once
npm start
```

## Slack 요청 예시

Slack `#codex-gpt` 채널에 아래 메시지를 보냅니다.

```text
[to-codex]
task_id: test-001

request:
Codex relay 테스트 응답을 보내줘.
```

데몬은 같은 스레드에 아래 형식의 고정 응답을 보냅니다.

```text
[codex-result]
status: completed

summary:
Slack 왕복 검증용 고정 응답입니다.
```

## 생성되는 로컬 파일

- `logs/relay_events.jsonl`: 감지한 `[to-codex]` 메시지 기록
- `state/processed_messages.json`: 이미 처리한 Slack 메시지 `ts` 목록

`--dry-run`에서도 로그와 처리 상태는 저장됩니다. 같은 메시지를 실제 전송으로 다시 검증하려면 `state/processed_messages.json`에서 해당 `ts`를 제거해야 합니다.

## 문서

자세한 Slack 권한과 설정 방법은 [docs/slack_setup.md](docs/slack_setup.md)를 참고합니다.

프로젝트 방향과 단계별 계획은 아래 문서를 참고합니다.

- [docs/product_plan.md](docs/product_plan.md)
- [docs/roadmap.md](docs/roadmap.md)

## 현재 한계

- 1단계는 Slack 왕복 검증만 수행합니다.
- 실제 Codex app 작업 처리, `inbox/outbox` 파일 큐, Notion 기록은 이후 단계입니다.
- 현재 방식은 Slack `conversations.history` 폴링입니다. 더 빠른 반응이 필요하면 나중에 Socket Mode 전환을 검토합니다.
