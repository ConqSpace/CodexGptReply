# CodexGptRelay

Slack을 중계 채널로 사용해 GPT와 Codex 사이의 반자동 대화를 실험하는 로컬 relay daemon입니다.

사용자는 GPT 화면에 머물고, GPT는 Slack에 `[to-codex]` 요청을 남깁니다. 로컬 데몬은 Slack Web API로 해당 메시지를 감지한 뒤 `inbox` 작업 파일을 만듭니다. 사람이 Codex app에서 작업을 처리하고 `outbox` 결과 파일을 만들면, 데몬이 같은 Slack 스레드에 결과를 전송합니다.

## 목표

- 사용자는 가능하면 GPT 화면에 머무릅니다.
- GPT는 Slack `#codex-gpt` 채널에 Codex용 요청을 남깁니다.
- 로컬 데몬은 Slack 메시지를 감지하고 `inbox` 작업 파일로 변환합니다.
- 데몬은 `outbox` 결과 파일을 Slack 스레드에 구조화된 답장으로 전송합니다.
- GPT는 Slack 답장을 읽고 사용자에게 다시 전달합니다.

## 현재 범위

- `[to-codex]` 접두사가 붙은 Slack 메시지만 처리합니다.
- 처리한 Slack 메시지 `ts`를 저장해 중복 작업 파일 생성을 막습니다.
- `inbox`, `outbox`, `outbox/sent`, `state`, `logs` 디렉터리를 필요할 때 만듭니다.
- 사람이 작성한 `outbox/*.md` 결과 파일만 전송 후보로 봅니다.
- 작성 중인 `outbox/*.pending.md` 파일은 무시합니다.
- Notion 기록과 Codex 자동 실행은 이후 단계입니다.

## 동작 흐름

```text
GPT
-> Slack #codex-gpt [to-codex]
-> CodexGptRelay daemon
-> inbox/task_<task_id>.md 생성
-> Codex app 작업
-> outbox/<result>.md 생성
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

위 명령은 `[to-codex]` 메시지를 감지하면 `inbox` 작업 파일을 만들고, `outbox/*.md` 결과 파일이 있으면 Slack 스레드에 전송합니다.

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

데몬은 `inbox/task_test-001.md` 작업 파일을 만듭니다. 작업 파일에는 채널, 원본 메시지 `ts`, 스레드 `ts`, 작성자, 감지 시각, 원문 요청이 포함됩니다.

Codex app 또는 사람이 작업을 마친 뒤 `outbox`에는 아래처럼 결과 파일을 작성합니다. 작성 중에는 `.pending.md` 확장자를 사용하고, 완료되면 `.md`로 이름을 바꿉니다.

```text
task_id: test-001
status: completed
thread_ts: 1710000000.000000
message: |
  Slack 왕복 검증용 응답입니다.
```

frontmatter 형식도 사용할 수 있습니다.

```markdown
---
task_id: test-001
status: completed
thread_ts: "1710000000.000000"
---

Slack으로 보낼 결과 본문입니다.
```

## 생성되는 로컬 파일

- `inbox/task_<task_id>.md`: Slack 요청을 사람이 읽기 좋게 저장한 작업 파일
- `outbox/*.md`: Slack 전송 후보 결과 파일
- `outbox/*.pending.md`: 작성 중인 결과 파일이며 데몬이 무시합니다.
- `outbox/sent/*.md`: Slack 전송 성공 뒤 이동된 결과 파일
- `logs/relay_events.jsonl`: 감지한 `[to-codex]` 메시지와 작업 파일 생성 기록
- `state/processed_messages.json`: 이미 처리한 Slack 메시지 `ts` 목록
- `state/posted_results.json`: 이미 전송한 결과 파일 목록

`--dry-run`에서도 `inbox` 작업 파일, 로그, 처리 상태는 저장됩니다. 단, Slack 전송과 `outbox/sent` 이동은 하지 않고 콘솔에 전송 예정 정보만 표시합니다. 같은 메시지를 실제 전송으로 다시 검증하려면 `state/processed_messages.json`에서 해당 `ts`를 제거해야 합니다.

## 문서

자세한 Slack 권한과 설정 방법은 [docs/slack_setup.md](docs/slack_setup.md)를 참고합니다.

Codex app에서 `logs/relay_events.jsonl`과 `inbox`를 감시하고 `outbox` 결과 파일을 남기는 운영 절차는 [docs/codex_app_operations.md](docs/codex_app_operations.md)를 참고합니다.

복사해서 쓸 수 있는 결과 파일 템플릿은 [templates/outbox_result.pending.md](templates/outbox_result.pending.md)에 있습니다. 이 파일은 템플릿 폴더에 있으므로 실제 Slack 전송 후보가 아닙니다.

프로젝트 방향과 단계별 계획은 아래 문서를 참고합니다.

- [docs/product_plan.md](docs/product_plan.md)
- [docs/roadmap.md](docs/roadmap.md)

## Codex Skill

이 레포에는 Codex에서 바로 사용할 수 있는 skill도 포함되어 있습니다.

```text
skills/codex-gpt-relay/
  SKILL.md
  agents/openai.yaml
```

설치하려면 레포의 skill 폴더를 Codex skill 디렉터리로 복사합니다.

```powershell
Copy-Item `
  -Recurse `
  -Force `
  -LiteralPath .\skills\codex-gpt-relay `
  -Destination "$env:USERPROFILE\.codex\skills\codex-gpt-relay"
```

skill은 두 가지 모드를 제공합니다.

- **Short Task Mode**: 1회 relay 확인, `--dry-run`, `--once`, 문법 검사, 결과 요약
- **Long Monitoring Mode**: 데몬 로그를 라이브 서버 로그처럼 확인하고 새 작업 이벤트를 추적

예시 요청:

```text
Use $codex-gpt-relay to check the CodexGptRelay Slack relay status.
```

또는 한국어로:

```text
$codex-gpt-relay로 relay 한 번 확인해줘.
```

## 현재 한계

- 실제 Codex app 작업 처리는 사람이 수행합니다.
- Notion 기록은 이후 단계입니다.
- 현재 방식은 Slack `conversations.history` 폴링입니다. 더 빠른 반응이 필요하면 나중에 Socket Mode 전환을 검토합니다.
