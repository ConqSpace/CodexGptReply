# Codex app 감시 운영 문서

이 문서는 로드맵 3단계 운영 기준입니다. Codex app은 Slack API를 직접 호출하지 않습니다. `logs/relay_events.jsonl`과 `inbox`를 라이브 서버 로그처럼 확인하고, 작업 결과는 `outbox`에 파일로 남깁니다.

## 운영 원칙

- 작업 확인은 `logs/relay_events.jsonl`과 `inbox/task_<task_id>.md`를 기준으로 합니다.
- 실제 Slack 전송은 relay daemon이 담당합니다.
- 결과 파일은 작성 중에는 `outbox/*.pending.md`로 둡니다.
- 전송 준비가 끝났을 때만 `outbox/*.md`로 이름을 바꿉니다.
- 위험한 작업은 바로 실행하지 않고 `[codex-question]` 결과로 사용자 확인을 요청합니다.

## inbox 작업 파일 형식

파일 위치:

```text
inbox/task_<task_id>.md
```

현재 daemon이 생성하는 기본 형식:

```markdown
# Codex 작업 요청

- task_id: <작업 ID>
- channel: <Slack 채널 ID>
- message_ts: <원본 Slack 메시지 ts>
- thread_ts: <답장할 Slack 스레드 ts>
- author: <작성자 또는 봇 ID>
- detected_at: <감지 시각 ISO 문자열>

## 원문 request

<사용자가 보낸 [to-codex] 본문>
```

필드 의미:

- `task_id`: 결과 파일과 로그를 연결하는 식별자입니다.
- `channel`: daemon이 읽은 Slack 채널입니다.
- `message_ts`: 중복 처리 여부를 판단할 때 쓰는 원본 메시지 시각입니다.
- `thread_ts`: 결과를 답장할 Slack 스레드입니다. `outbox` 결과 파일에 반드시 복사합니다.
- `author`: 원본 요청 작성자입니다.
- `detected_at`: daemon이 작업을 감지한 시각입니다.
- `원문 request`: Codex app이 실제로 처리할 요청입니다.

## outbox 결과 파일 형식

파일 위치:

```text
outbox/<task_id>.pending.md
outbox/<task_id>.md
```

작성 중에는 `.pending.md`를 사용합니다. relay daemon은 `.pending.md` 파일을 전송 후보로 보지 않습니다. 검토가 끝난 뒤 같은 내용을 `.md`로 이름 변경하면 Slack 전송 후보가 됩니다.

필수 필드:

- `task_id`: `inbox` 작업 파일의 `task_id`와 같아야 합니다.
- `status`: `completed`, `failed`, `waiting_for_user`, `running` 중 하나를 사용합니다.
- `thread_ts`: `inbox` 작업 파일의 `thread_ts` 값을 그대로 사용합니다.
- `message`: Slack에 보낼 본문입니다.

권장 형식:

```text
task_id: <작업 ID>
status: completed
thread_ts: <Slack 스레드 ts>
message: |
  요약:
  - 완료한 일을 짧게 적습니다.

  검증:
  - 실행한 확인 방법을 적습니다.

  남은 위험:
  - 사용자가 알아야 할 제한이나 후속 조치를 적습니다.
```

frontmatter 형식도 사용할 수 있습니다.

```markdown
---
task_id: <작업 ID>
status: completed
thread_ts: "<Slack 스레드 ts>"
---

요약:
- 완료한 일을 짧게 적습니다.

검증:
- 실행한 확인 방법을 적습니다.
```

daemon은 `status`에 따라 Slack 접두사를 붙입니다.

- `completed`: `[codex-result]`
- `failed`: `[codex-result]`
- `waiting_for_user`: `[codex-question]`
- `running`: `[codex-status]`

## 새 작업 확인 체크리스트

1. `logs/relay_events.jsonl`의 마지막 줄부터 확인합니다.
2. `event: "task_created"`가 있는지 확인합니다.
3. `task_id`, `task_file`, `thread_ts`, `message_ts`를 기록합니다.
4. `inbox/<task_file>`을 UTF-8로 읽습니다.
5. 같은 `task_id`의 결과가 이미 `outbox`, `outbox/sent`에 있는지 확인합니다.
6. 요청이 현재 허용 범위 안에 있는지 판단합니다.
7. 위험하거나 범위가 불명확하면 작업을 실행하지 않고 `[codex-question]` 결과를 작성합니다.
8. 작업을 수행했다면 검증 결과와 남은 위험을 함께 정리합니다.
9. `templates/outbox_result.pending.md`를 복사해 `outbox/<task_id>.pending.md`로 작성합니다.
10. 필수 필드와 본문을 다시 확인한 뒤 `outbox/<task_id>.md`로 이름을 바꿉니다.

## 위험한 작업 질문 규칙

다음 조건 중 하나라도 해당하면 작업을 바로 실행하지 않습니다. `status: waiting_for_user`로 결과 파일을 만들고, 본문에는 사용자가 선택할 수 있는 구체적인 질문을 적습니다.

- 파일 삭제, 대량 이동, 되돌리기 어려운 변경이 포함된 경우
- Git 커밋, 푸시, 브랜치 정리처럼 원격 저장소나 이력에 영향을 주는 경우
- `.env`, Slack token, 개인 키 같은 비밀 값 조회 또는 출력이 필요한 경우
- 외부 서비스로 실제 메시지, 메일, API 요청을 보내야 하는 경우
- 요청 범위가 넓어서 어떤 파일을 바꿔야 하는지 불명확한 경우
- 기존 워킹트리 변경을 되돌리거나 덮어쓸 위험이 있는 경우
- 장시간 감시나 자동 실행처럼 비용과 종료 조건이 불명확한 경우

질문 결과 예시:

```text
task_id: <작업 ID>
status: waiting_for_user
thread_ts: <Slack 스레드 ts>
message: |
  확인이 필요합니다.

  요청에 파일 삭제가 포함되어 있어 바로 실행하지 않았습니다.
  삭제 대상 파일 목록과 되돌릴 방법을 확인해도 될까요?
```

이 파일이 `outbox/<task_id>.md`로 준비되면 daemon은 Slack 스레드에 `[codex-question]`으로 답장합니다.

## 결과 작성 체크리스트

1. `task_id`가 `inbox`와 같은지 확인합니다.
2. `thread_ts`가 `inbox`의 값과 같은지 확인합니다.
3. 작성 중 파일명이 `.pending.md`인지 확인합니다.
4. `status`가 현재 결과와 맞는지 확인합니다.
5. `message`에 사용자가 바로 이해할 수 있는 요약, 검증, 남은 위험을 적습니다.
6. 비밀 값과 토큰이 포함되지 않았는지 확인합니다.
7. 실제 외부 전송 테스트를 하지 않았으면 그 사실을 명확히 적습니다.
8. 마지막에 `.md`로 이름을 바꿔 전송 후보로 만듭니다.

## 운영상 열린 부분

- Codex app이 항상 자동으로 깨어 있는 것은 아닙니다.
- 3단계는 반자동 운영입니다. 자동 실행 확대는 이후 단계에서 별도로 검토합니다.
- `logs/relay_events.jsonl`은 작업 감지와 생성 이벤트 중심입니다. 세부 상태 관리는 이후 단계에서 보강합니다.
