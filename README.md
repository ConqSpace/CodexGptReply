# CodexGptRelay

Slack을 중계 채널로 사용해 GPT와 Codex 사이의 반자동 대화를 실험하는 로컬 relay daemon입니다.

사용자는 GPT 화면에 머물고, GPT는 Slack에 Codex용 요청을 남깁니다. 로컬 데몬은 Slack Web API로 채널 메시지와 스레드 댓글을 감지한 뒤 `inbox` 작업 파일을 만듭니다. 사람이 Codex app에서 작업을 처리하고 `outbox` 결과 파일을 만들면, 데몬이 같은 Slack 스레드에 결과를 전송합니다.

Slack에서 기계형 태그가 안전 검사에 걸릴 때는 사람 이름처럼 보이는 **카를로스-조지** 별칭을 사용합니다. 이때 카를로스는 Codex 쪽 작업자, 조지는 GPT 쪽 사용자 창구를 뜻합니다.

## 목표

- 사용자는 가능하면 GPT 화면에 머무릅니다.
- GPT는 프로젝트별 Slack 채널에 Codex용 요청을 남깁니다.
- 로컬 데몬은 Slack 메시지를 감지하고 `inbox` 작업 파일로 변환합니다.
- 데몬은 `outbox` 결과 파일을 Slack 스레드에 구조화된 답장으로 전송합니다.
- 기획서 같은 긴 원본 문서는 Slack 스레드에 파일로 첨부할 수 있습니다.
- GPT는 Slack 답장을 읽고 사용자에게 다시 전달합니다.
- 프로젝트별 Slack 채널을 분리하고, 문서와 코드는 각 프로젝트 Git 저장소에서 처리합니다.

## 현재 범위

- `[to-codex]`, `카를로스에게 전달:`, `카를로스 요청` 접두사가 붙은 Slack 메시지를 새 작업으로 처리합니다.
- `[to-codex-reply]` 접두사가 붙은 Slack 메시지는 기존 작업의 사용자 답변으로 처리합니다.
- Slack 스레드 댓글도 처리합니다. 데몬은 `conversations.history`로 부모 메시지를 읽고, `reply_count > 0`인 메시지는 `conversations.replies`로 댓글을 펼칩니다.
- 프로젝트별 Slack 채널은 [config/projects.json](config/projects.json)에서 관리합니다.
- 처리한 Slack 메시지 `ts`를 저장해 중복 작업 파일 생성을 막습니다.
- `inbox`, `outbox`, `outbox/sent`, `state`, `logs` 디렉터리를 필요할 때 만듭니다.
- 사람이 작성한 `outbox/<project_id>/*.md` 결과 파일만 전송 후보로 봅니다.
- 작성 중인 `outbox/*.pending.md` 파일은 무시합니다.
- `outbox/<project_id>/*.attachment.md` 원본 문서는 결과 파일로 해석하지 않고 첨부 파일로만 사용합니다.
- 문서 작업은 프로젝트 저장소의 Markdown 파일에서 처리합니다.
- Codex 자동 실행은 이후 단계입니다.

## 동작 흐름

```text
GPT
-> 프로젝트별 Slack 채널 "카를로스에게 전달:"
-> CodexGptRelay daemon
-> inbox/<project_id>/task_<task_id>.md 생성
-> Codex app 작업
-> outbox/<project_id>/<result>.md 생성
-> CodexGptRelay daemon
-> logs/relay_events.jsonl 기록
-> state/processed_messages.json 중복 처리 방지
-> Slack thread [codex-result]
-> GPT
```

문서와 코드는 각 프로젝트 Git 저장소에 둡니다.

```text
Git
-> 실행 코드
-> README
-> docs/product_plan.md
-> docs/roadmap.md
-> docs/decisions.md
-> docs/task_log.md
```

사용자 확인이 필요한 작업은 아래 흐름을 사용합니다.

```text
Codex app
-> outbox/<project_id>/<task_id>.md status: waiting_for_user 또는 needs_user: true
-> CodexGptRelay daemon
-> Slack thread [codex-question]
-> GPT가 사용자 답변 확인
-> Slack thread [to-codex-reply]
-> CodexGptRelay daemon
-> state/tasks.json 상태를 running으로 전환
```

## 요구 사항

- Node.js 18 이상
- Slack App Bot Token
- Slack Bot Token Scope
  - `channels:read`
  - `channels:history`
  - `chat:write`
  - `files:write`

## 설정

`.env.example`을 참고해 프로젝트 루트에 `.env` 파일을 만듭니다.

```env
SLACK_BOT_TOKEN=xoxb-your-token-here
POLL_INTERVAL_MS=10000
SLACK_HISTORY_LIMIT=20
```

실제 Slack 토큰은 저장소에 넣지 않습니다. `.env`는 `.gitignore`에 포함되어 있습니다. `SLACK_CHANNEL_ID`는 과거 단일 채널 호환용 fallback으로만 사용하고, 새 프로젝트 채널은 `config/projects.json`에 적습니다.

프로젝트별 채널과 작업 위치는 [config/projects.json](config/projects.json)에 둡니다.

```json
{
  "defaultProjectId": "codex-gpt-relay",
  "projects": [
    {
      "id": "codex-gpt-relay",
      "name": "CodexGptRelay",
      "enabled": true,
      "slackChannelId": "C0B6QN775FA",
      "repoPath": "F:\\Antigravity\\CodexGptRelay",
      "githubUrl": "https://github.com/ConqSpace/CodexGptReply.git"
    }
  ]
}
```

`enabled: false`이거나 `slackChannelId`가 비어 있는 프로젝트는 데몬이 폴링하지 않습니다.

새 프로젝트에 Slack 채널을 처음 연결할 때 Codex가 따라야 할 운영 절차는 [skills/codex-gpt-relay/SKILL.md](skills/codex-gpt-relay/SKILL.md)의 `New Project Slack Onboarding` 섹션에 정리되어 있습니다.

Slack App 권한을 바꾼 뒤에는 워크스페이스에 다시 설치하고, 봇을 각 프로젝트 채널에 초대해야 합니다.

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

위 명령은 지원 접두사 메시지를 감지하면 `inbox/<project_id>` 작업 파일을 만들고, `outbox/<project_id>/*.md` 결과 파일이 있으면 해당 프로젝트 Slack 스레드에 전송합니다.

```powershell
node src/relay_daemon.js
```

위 명령은 기본 10초 간격으로 계속 폴링합니다.

```powershell
node src/relay_daemon.js --status
```

위 명령은 Slack API를 호출하지 않고 최근 작업 상태를 출력합니다. 출력에는 작업 ID, 상태, Slack 메시지 시각, 작업 파일, 결과 파일, 마지막 오류만 포함합니다. Slack 토큰과 `.env` 값은 출력하지 않습니다.

같은 명령을 npm 스크립트로도 실행할 수 있습니다.

```powershell
npm run dry-run
npm run once
npm start
```

## Slack 요청 예시

프로젝트별 Slack 채널에 아래 메시지를 보냅니다.

기본 권장 포맷:

```text
카를로스에게 전달:
Simple Memo 기획서 초안을 docs/product_plan.md에 작성해줘.
코드 작업은 하지 말고 문서만 업데이트해줘.
```

`task_id`는 선택입니다. 없으면 데몬이 Slack 메시지 `ts`를 바탕으로 `slack-<ts>` 형태의 작업 ID를 자동 생성합니다.

기계형 포맷:

```text
[to-codex]
task_id: test-001

request:
Codex relay 테스트 응답을 보내줘.
```

GPT의 Slack 도구가 기계형 포맷을 안전 검사에서 막는 경우에는 사람 친화형 포맷을 사용합니다. 기본 권장 포맷은 `카를로스에게 전달:`입니다. `카를로스 요청`도 인식합니다.

```text
카를로스 요청
작업 ID: test-001

요청:
Codex relay 테스트 응답을 보내줘.
```

`Codex 요청`도 계속 인식합니다.

```text
Codex 요청
작업 ID: test-001

요청:
Codex relay 테스트 응답을 보내줘.
```

영어 라벨도 인식합니다.

```text
Codex request
Task ID: test-001

Request:
Codex relay 테스트 응답을 보내줘.
```

데몬은 `inbox/<project_id>/task_test-001.md` 작업 파일을 만듭니다. 작업 파일에는 프로젝트 ID, 저장소 경로, 채널, 원본 메시지 `ts`, 스레드 `ts`, 작성자, 감지 시각, 원문 요청이 포함됩니다.

Codex app 또는 사람이 작업을 마친 뒤 `outbox/<project_id>`에는 아래처럼 결과 파일을 작성합니다. 작성 중에는 `.pending.md` 확장자를 사용하고, 완료되면 `.md`로 이름을 바꿉니다.

```text
task_id: test-001
project_id: codex-gpt-relay
status: completed
needs_user: false
thread_ts: 1710000000.000000
message: |
  Slack 왕복 검증용 응답입니다.
```

기획 문서 원본을 같이 보낼 때는 결과 파일 옆에 `*.attachment.md` 파일을 만들고 `attachment_path`를 적습니다. 상대 경로는 결과 파일이 있는 `outbox/<project_id>` 기준입니다.

```text
task_id: plan-001
project_id: codex-gpt-relay
status: completed
needs_user: false
thread_ts: 1710000000.000000
attachment_path: plan-001.attachment.md
attachment_title: 메모 앱 기획서 초안
attachment_comment: 원본 기획서를 첨부합니다.
message: |
  기획서 초안을 작성했습니다.
  핵심 요약은 본문에 적고, 전체 원본은 첨부 파일로 보냅니다.
```

frontmatter 형식도 사용할 수 있습니다.

```markdown
---
task_id: test-001
project_id: codex-gpt-relay
status: completed
needs_user: false
thread_ts: "1710000000.000000"
---

Slack으로 보낼 결과 본문입니다.
```

확인이 필요한 작업은 `status: waiting_for_user` 또는 `needs_user: true`로 작성합니다. `needs_user: true`인데 `status`가 없으면 daemon은 `waiting_for_user`로 취급합니다. `needs_user: true`와 다른 `status`를 함께 쓰면 형식 오류로 기록하고 전송하지 않습니다.

```text
task_id: test-001
project_id: codex-gpt-relay
needs_user: true
thread_ts: 1710000000.000000
message: |
  확인이 필요합니다.

  파일 삭제가 포함되어 있어 바로 실행하지 않았습니다.
  삭제 대상과 되돌릴 방법을 확인해도 될까요?
```

사용자가 GPT에서 답하면 GPT는 같은 Slack 스레드에 아래 형식으로 남깁니다. `task_id`가 없으면 daemon은 Slack 스레드 `thread_ts`로 기존 작업을 찾습니다. `thread_ts`를 적으면 daemon이 기존 작업의 스레드와 일치하는지 확인합니다.

```text
[to-codex-reply]
task_id: test-001
thread_ts: 1710000000.000000
answer: |
  삭제하지 말고 목록만 먼저 보여주세요.
```

GPT가 기계형 답변을 보내지 못하면 아래 사람 친화형 답변을 사용합니다. 기본 권장 포맷은 `카를로스 답변`입니다.

```text
카를로스 답변
작업 ID: test-001
thread_ts: 1710000000.000000
답변: |
  삭제하지 말고 목록만 먼저 보여주세요.
```

`Codex 답변`도 계속 인식합니다.

```text
Codex 답변
작업 ID: test-001
thread_ts: 1710000000.000000
답변: |
  삭제하지 말고 목록만 먼저 보여주세요.
```

영어 라벨도 인식합니다.

```text
Codex reply
Task ID: test-001
thread_ts: 1710000000.000000
answer: |
  삭제하지 말고 목록만 먼저 보여주세요.
```

유효한 답변이면 `state/tasks.json`의 해당 작업이 `running`으로 바뀌고 `last_user_reply`에 답변 본문, 답변 메시지 `ts`, 수신 시각이 저장됩니다. 잘못된 답변은 자동 실행하지 않고 `logs/relay_events.jsonl`에 `user_reply_ignored` 이벤트로 남습니다.

## 생성되는 로컬 파일

- `inbox/<project_id>/task_<task_id>.md`: Slack 요청을 사람이 읽기 좋게 저장한 작업 파일
- `outbox/<project_id>/*.md`: Slack 전송 후보 결과 파일
- `outbox/*.pending.md`: 작성 중인 결과 파일이며 데몬이 무시합니다.
- `outbox/<project_id>/*.attachment.md`: Slack에 첨부할 원본 문서이며 결과 파일로 해석하지 않습니다.
- `outbox/sent/<project_id>/*.md`: Slack 전송 성공 뒤 이동된 결과 파일
- `logs/relay_events.jsonl`: 감지한 요청 메시지, 작업 파일 생성 기록, 사용자 답변 처리 이벤트
- `state/processed_messages.json`: 이미 처리한 Slack 메시지 `ts` 목록
- `state/posted_results.json`: 이미 전송한 결과 파일 목록
- `state/tasks.json`: 최근 작업의 `task_id`, `status`, `message_ts`, `thread_ts`, `task_file`, `result_file`, `updated_at`, `last_error`, `last_user_reply`를 저장합니다.

작업 상태는 다음 흐름으로 기록됩니다.

- `queued`: Slack 요청을 감지해 `inbox` 작업 파일을 만든 상태
- `outbox_ready`: `outbox/<project_id>/*.md` 결과 파일을 읽어 Slack 전송 후보로 확인한 상태
- `posted`: Slack 스레드 답장 전송과 전송 완료 기록이 끝난 상태
- `failed`: 결과 파일 형식 오류 등으로 작업 처리가 실패한 상태
- `waiting_for_user`: Codex app이 사용자 확인 질문을 남긴 상태
- `running`: Codex app이 진행 상태를 남긴 상태

`logs/relay_events.jsonl`에는 `task_status_changed` 상태 전이 이벤트가 추가됩니다. 잘못된 `outbox` 결과 파일 때문에 실패하면 `task_failed` 이벤트에 파일명과 부족한 필드가 함께 기록됩니다. 같은 파일에서 같은 오류가 반복될 때는 중복 실패 로그를 계속 쌓지 않습니다. 사용자 답변이 유효하면 `user_reply_received`, 잘못됐으면 `user_reply_ignored` 이벤트가 남습니다.

`--dry-run`에서도 `inbox` 작업 파일, 로그, 처리 상태는 저장됩니다. 단, Slack 전송과 `outbox/sent` 이동은 하지 않고 콘솔에 전송 예정 정보만 표시합니다. 같은 메시지를 실제 전송으로 다시 검증하려면 `state/processed_messages.json`에서 해당 `ts`를 제거해야 합니다.

## 문서

자세한 Slack 권한과 설정 방법은 [docs/slack_setup.md](docs/slack_setup.md)를 참고합니다. 스레드 댓글 조회에는 별도 `replies` 권한이 없고, 공개 채널 기준 `channels:history` 권한을 사용합니다. 원본 문서 첨부에는 `files:write` 권한을 사용합니다.

Codex app에서 `logs/relay_events.jsonl`과 `inbox`를 감시하고 `outbox` 결과 파일을 남기는 운영 절차는 [docs/codex_app_operations.md](docs/codex_app_operations.md)를 참고합니다.

복사해서 쓸 수 있는 결과 파일 템플릿은 [templates/outbox_result.pending.md](templates/outbox_result.pending.md)에 있습니다. 이 파일은 템플릿 폴더에 있으므로 실제 Slack 전송 후보가 아닙니다.

사용자 확인 질문 템플릿은 [templates/outbox_question.pending.md](templates/outbox_question.pending.md)에 있습니다.

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
- 현재 방식은 `config/projects.json`의 활성 프로젝트 채널을 순회하며 Slack `conversations.history`와 `conversations.replies`를 폴링합니다. 더 빠른 반응이 필요하면 나중에 Socket Mode 전환을 검토합니다.

## 검증된 테스트

- `Simple Memo` 저장소에 README와 테스트 문서를 작성하고 푸시했습니다.
- Slack 스레드 댓글로 들어온 후속 요청을 감지해 같은 스레드에 결과를 보냈습니다.
- `ConqSpace/SimpleMemo` 저장소를 만들고 README와 테스트 문서를 푸시했습니다.
