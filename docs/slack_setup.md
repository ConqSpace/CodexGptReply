# Slack 설정과 실행 방법

## 필요한 Slack Bot Token Scope

Slack App의 Bot Token Scopes에 다음 권한을 추가합니다.

- `channels:read`
- `channels:history`
- `chat:write`
- `files:write`

스레드 댓글 조회에 `replies`라는 별도 권한은 없습니다. 공개 채널에서는 `conversations.replies`도 `channels:history` 권한으로 조회합니다. 비공개 채널, DM, 멀티 DM으로 확장할 때는 각각 `groups:history`, `im:history`, `mpim:history`가 필요합니다.

`files:write`는 결과 원본 문서를 Slack 스레드에 첨부할 때 사용합니다.

권한을 바꾼 뒤에는 Slack App을 워크스페이스에 다시 설치해야 합니다. 그리고 Bot을 각 프로젝트 채널에 초대합니다.

## 로컬 설정

1. `.env.example`을 참고해 프로젝트 루트에 `.env` 파일을 만듭니다.
2. 실제 토큰은 `.env`에만 저장합니다. 저장소에 커밋하지 않습니다.

```env
SLACK_BOT_TOKEN=xoxb-your-token-here
POLL_INTERVAL_MS=10000
SLACK_HISTORY_LIMIT=20
```

`SLACK_CHANNEL_ID`는 단일 채널 fallback으로만 사용합니다. 새 프로젝트 채널은 `config/projects.json`의 `projects[*].slackChannelId`에 적습니다.

## 실행 명령

의존성 설치가 필요 없는 Node.js 18 이상 기반 스크립트입니다.

```powershell
node src/relay_daemon.js --once --dry-run
```

한 번만 Slack 메시지를 읽고, 실제 답장은 전송하지 않습니다. 로그와 처리 상태만 로컬에 남깁니다.

```powershell
node src/relay_daemon.js --once
```

한 번만 Slack 메시지를 읽고, 지원 접두사 메시지를 `inbox/<project_id>` 작업 파일로 변환합니다. 처리할 `outbox/<project_id>/*.md` 결과 파일이 있으면 같은 Slack 스레드에 답장을 전송합니다.

```powershell
node src/relay_daemon.js
```

10초마다 활성 프로젝트의 Slack 채널마다 `conversations.history`를 호출합니다. 스레드 댓글이 있는 메시지는 `conversations.replies`를 추가 호출해 댓글까지 확인합니다. Slack API가 `429`를 반환하면 `Retry-After` 값만큼 기다린 뒤 다시 시도합니다.

## 생성되는 로컬 파일

- `inbox/<project_id>/task_<task_id>.md`: Slack 요청을 사람이 읽기 좋은 작업 파일로 저장합니다.
- `outbox/<project_id>/*.md`: Slack 스레드에 전송할 결과 파일입니다.
- `outbox/*.pending.md`: 작성 중인 결과 파일입니다. 데몬은 이 파일을 무시합니다.
- `outbox/<project_id>/*.attachment.md`: Slack에 첨부할 원본 문서입니다. 데몬은 이 파일을 결과 파일로 해석하지 않습니다.
- `outbox/sent/*.md`: Slack 전송 성공 뒤 이동된 결과 파일입니다.
- `logs/relay_events.jsonl`: 감지한 `[to-codex]` 메시지와 `task_created` 이벤트를 줄 단위 JSON으로 저장합니다.
- `state/processed_messages.json`: 이미 처리한 Slack 메시지 `ts`를 저장해 중복 처리를 막습니다.
- `state/posted_results.json`: 이미 Slack에 전송한 결과 파일명을 저장해 중복 전송을 막습니다.

## 파일 큐 사용법

Slack 요청에는 `task_id`를 넣을 수 있습니다. `task_id`가 없으면 데몬이 Slack 메시지 `ts`를 바탕으로 안전한 값을 만듭니다.

GPT의 Slack 도구가 기계형 포맷을 막는 경우에는 아래 형식을 권장합니다.

```text
카를로스에게 전달:
README의 파일 큐 설명을 확인해줘.
```

```text
[to-codex]
task_id: test-001

request:
README의 2단계 파일 큐 설명을 확인해줘.
```

작업 파일에는 최소한 `channel`, `message_ts`, `thread_ts`, `author`, `detected_at`, 원문 `request`가 들어갑니다.

결과 파일은 먼저 `.pending.md`로 작성한 뒤, 완성되면 `.md`로 이름을 바꿉니다.

```text
project_id: codex-gpt-relay
task_id: test-001
status: completed
thread_ts: 1710000000.000000
message: |
  요청한 작업을 완료했습니다.
```

기획서처럼 원본 문서를 함께 보낼 때는 결과 파일 옆에 `*.attachment.md` 파일을 두고 `attachment_path`를 적습니다. 상대 경로는 결과 파일이 있는 `outbox/<project_id>` 기준입니다.

```text
project_id: codex-gpt-relay
task_id: planning-001
status: completed
thread_ts: 1710000000.000000
attachment_path: planning-001.attachment.md
attachment_title: 메모 앱 기획서 초안
attachment_comment: 원본 기획서를 첨부합니다.
message: |
  기획서 초안을 작성했습니다.
  요약은 아래와 같고, 원본 문서는 첨부 파일로 확인할 수 있습니다.
```

frontmatter를 쓰는 경우 본문을 `message`로 사용할 수 있습니다.

```markdown
---
task_id: test-001
status: completed
thread_ts: "1710000000.000000"
---

요청한 작업을 완료했습니다.
```

`status`가 `waiting_for_user`이면 `[codex-question]`, `running`이면 `[codex-status]`, 그 외에는 `[codex-result]` 접두사로 전송됩니다.

## 메시지 처리 규칙

- 본문이 `[to-codex]`, `카를로스에게 전달:`, `카를로스 요청` 등 지원 접두사로 시작하는 메시지를 처리합니다.
- 스레드 댓글도 처리합니다. 부모 메시지에 `reply_count`가 있으면 댓글을 펼쳐 보고, 각 댓글 `ts`로 중복 처리를 막습니다.
- `[codex-result]`, `[codex-question]`, `[codex-status]` 메시지는 접두사가 다르므로 무시됩니다.
- `--dry-run`에서도 작업 파일, 로그, 처리 상태는 저장됩니다. Slack 전송과 `outbox/sent` 이동은 하지 않습니다.
- 같은 메시지를 실제 전송으로 다시 검증하려면 해당 `ts`를 상태 파일에서 제거해야 합니다.
