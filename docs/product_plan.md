# CodexGptRelay 기획서

## 1. 목적

CodexGptRelay는 GPT와 Codex 사이의 대화를 Slack으로 중계하는 반자동 작업 흐름입니다.

사용자는 가능하면 GPT 화면에 머무릅니다. GPT는 Slack에 Codex용 요청을 남깁니다. 로컬 데몬은 Slack Web API로 요청을 감지하고 `inbox` 작업 파일을 만듭니다. Codex app은 이 작업 파일과 로그를 확인하고 실제 작업을 수행합니다. 작업 결과는 `outbox` 파일로 남기고, 데몬이 Slack 스레드에 구조화된 답장을 보냅니다.

이 프로젝트의 1차 목표는 완전 자동 실행이 아닙니다. 사용자가 여러 창을 오가며 복사하고 붙여넣는 노동을 줄이는 것입니다.

## 2. 핵심 사용자 경험

사용자는 GPT에게 자연어로 요청합니다.

GPT는 요청을 Codex가 처리하기 쉬운 작업 메시지로 바꿔 Slack `#codex-gpt` 채널에 보냅니다.

Slack relay daemon은 해당 메시지를 감지합니다. 메시지가 `[to-codex]`로 시작하면 작업으로 등록하고 `inbox`에 작업 파일을 생성합니다.

Codex app은 `inbox`와 `logs/relay_events.jsonl`을 라이브 서버 로그처럼 확인합니다. 새 작업을 발견하면 작업을 수행하고 `outbox`에 결과 파일을 작성합니다.

Slack relay daemon은 `outbox` 결과 파일을 읽고 Slack 스레드에 `[codex-result]`, `[codex-question]`, `[codex-status]` 중 하나의 접두사를 붙여 답합니다.

GPT는 Slack 답장을 읽고 사용자에게 필요한 부분만 다시 설명합니다.

## 3. 역할 분리

### GPT

- 사용자와 직접 대화합니다.
- 사용자의 요청을 Codex용 작업 형식으로 정리합니다.
- Slack에 작업 요청을 남깁니다.
- Codex의 Slack 답장을 읽고 사용자에게 요약합니다.

### Slack

- GPT와 Codex 사이의 작업 큐 역할을 합니다.
- 작업 요청, 진행 상태, 결과, 질문을 스레드 단위로 묶습니다.
- 사람이 나중에 전체 흐름을 확인할 수 있는 기록을 남깁니다.

### Slack relay daemon

- Slack Web API를 사용합니다.
- `#codex-gpt` 채널을 짧은 주기로 확인합니다.
- `[to-codex]` 메시지만 `inbox` 작업 파일로 변환합니다.
- `outbox` 결과 파일을 Slack 스레드 답장으로 전송합니다.
- Slack 토큰, 채널 ID, 처리 완료 메시지 목록을 관리합니다.

### Codex

- Slack API를 직접 다루지 않습니다.
- `inbox` 작업 파일과 `logs/relay_events.jsonl`을 확인합니다.
- 요청을 실행 가능한 작업으로 해석합니다.
- 필요하면 로컬 파일, 코드, 문서, 명령 실행을 처리합니다.
- 결과를 `outbox` 파일로 구조화해서 남깁니다.

### Notion

- 1차 범위에는 포함하지 않습니다.
- Slack 왕복이 안정된 뒤 작업 기록, 결정 사항, 할 일 저장소로 추가합니다.

## 4. 1차 작업 흐름

```text
사용자
-> GPT
-> Slack #codex-gpt [to-codex]
-> Codex relay daemon
-> inbox/task.md 생성
-> Codex app이 로그와 작업 파일 확인
-> Codex app이 실제 작업 수행
-> outbox/result.md 생성
-> Codex relay daemon
-> Slack thread [codex-result]
-> GPT
-> 사용자
```

## 5. Slack 메시지 규칙

### GPT가 Codex에게 보내는 메시지

```text
[to-codex]
task_id: 2026-05-25-001
mode: research

request:
CodexGptRelay의 1차 구현 범위를 검토해줘.

constraints:
- Slack 답장은 구조화해서 작성
- 위험한 작업은 실행하지 말고 질문으로 반환
```

### Codex가 결과를 돌려주는 메시지

```text
[codex-result]
task_id: 2026-05-25-001
status: completed

summary:
1차 구현 범위는 Slack 왕복 검증으로 제한하는 것이 적절합니다.

details:
- [to-codex] 메시지만 처리
- 처리한 ts는 로컬 상태 파일에 저장
- 결과는 같은 스레드에 답장

needs_user: false
```

### Codex가 확인을 요청하는 메시지

```text
[codex-question]
task_id: 2026-05-25-001
status: waiting_for_user

question:
파일 수정까지 허용할까요, 아니면 Slack 왕복 검증만 진행할까요?
```

### Codex가 진행 상태를 알리는 메시지

```text
[codex-status]
task_id: 2026-05-25-001
status: running

summary:
Slack 메시지를 읽었고 inbox 작업 파일을 생성했습니다.
```

## 6. 구성 요소

### Slack 감시기

- Slack Web API를 사용해 `#codex-gpt` 채널을 주기적으로 읽습니다.
- 1차 구현에서는 10초 폴링을 기본값으로 사용합니다.
- `[to-codex]` 메시지만 작업으로 등록합니다.
- `[codex-result]`, `[codex-question]`, `[codex-status]` 메시지는 무시합니다.
- 이미 처리한 메시지 `ts`는 로컬 상태 파일에 저장합니다.

### 작업 관리자

- Slack 메시지를 작업 단위로 변환합니다.
- 작업 상태를 `queued`, `running`, `completed`, `failed`, `waiting_for_user`로 관리합니다.
- 같은 Slack 메시지가 중복 실행되지 않도록 막습니다.
- `inbox`, `outbox`, `state`, `logs` 디렉터리를 관리합니다.

### 파일 큐

- `inbox/*.md`: Slack 요청을 사람이 읽기 쉬운 작업 파일로 저장합니다.
- `outbox/*.md`: Codex app이 작성한 Slack 답장 후보를 저장합니다.
- `state/processed_messages.json`: 이미 처리한 Slack 메시지를 저장합니다.
- `state/posted_results.json`: 이미 Slack에 전송한 결과 파일을 저장합니다.
- `logs/relay_events.jsonl`: 데몬과 작업 상태 변화를 줄 단위 JSON으로 저장합니다.

### Codex app 작업자

- Codex app은 데몬 로그와 `inbox`를 확인합니다.
- 새 작업이 있으면 기존 Codex 작업 방식으로 파일 수정, 문서 작성, 검증을 수행합니다.
- 결과는 `outbox`에 Markdown 또는 JSON+Markdown 형식으로 저장합니다.
- Slack 전송은 데몬에게 맡깁니다.

### Slack 응답기

- `outbox` 결과 파일을 Slack 스레드에 답장합니다.
- 접두사 규칙을 항상 적용합니다.
- 오류도 `[codex-result] status: failed` 형식으로 남깁니다.

### 로그 저장소

- `logs/relay_events.jsonl`: 작업 감지, 실행, 응답, 실패 이벤트
- `state/processed_messages.json`: 이미 처리한 Slack 메시지 목록
- `state/tasks.json`: 최근 작업 상태
- `state/posted_results.json`: Slack에 전송한 결과 파일 목록

## 7. 1차 범위

1차 범위는 Slack 왕복 검증입니다.

- Slack 채널 읽기
- `[to-codex]` 메시지 감지
- `inbox` 작업 파일 생성
- `outbox` 결과 파일 감지
- Slack 스레드 답장 전송
- 중복 처리 방지
- 기본 로그 저장

다음 항목은 1차 범위에서 제외합니다.

- Notion 기록
- Codex app-server 자동 호출
- Git 커밋 또는 푸시
- 장시간 작업 큐
- 여러 채널 감시
- 외부 사용자에게 자동 답장
- Socket Mode 실시간 이벤트 수신

## 8. 위험과 대응

### 무한 답장 루프

조건: Codex가 남긴 `[codex-result]` 메시지를 다시 작업으로 처리하는 경우.

대응: `[to-codex]` 접두사가 있는 메시지만 처리합니다. 봇 또는 자기 자신이 작성한 메시지는 기본적으로 무시합니다.

### 같은 메시지 중복 처리

조건: 데몬 재시작 후 이미 처리한 Slack 메시지를 다시 읽는 경우.

대응: Slack 메시지 `ts`를 `state/processed_messages.json`에 저장합니다.

### 위험한 작업 자동 실행

조건: Slack 요청이 파일 삭제, 대량 수정, 외부 전송 같은 작업을 포함하는 경우.

대응: 초기 데몬은 Slack과 파일 큐만 다룹니다. 실제 작업은 Codex app에서 수행하며, 위험한 작업은 Codex가 `[codex-question]` 결과를 `outbox`에 남겨 사용자 확인을 받습니다.

### Slack API 호출 제한

조건: 너무 짧은 주기로 `conversations.history`를 호출하는 경우.

대응: 1차 기본 폴링 주기는 10초로 둡니다. `HTTP 429`가 오면 Slack의 `Retry-After` 값을 따릅니다. 장기적으로는 Socket Mode 전환을 검토합니다.

### GPT가 Codex 결과를 잘못 해석

조건: Codex 답장이 자유 문장으로 길게 작성되는 경우.

대응: 접두사와 필드명을 고정합니다. `task_id`, `status`, `summary`, `needs_user`는 항상 포함합니다.

### Slack 계정 구분 실패

조건: GPT와 Codex가 같은 Slack 계정 또는 같은 앱 표시명으로 보이는 경우.

대응: 발신자 이름에 의존하지 않고 접두사와 `task_id`로 구분합니다.

## 9. 성공 기준

1차 성공 기준은 다음과 같습니다.

- GPT가 Slack에 `[to-codex]` 메시지를 남기면 Codex가 감지합니다.
- 데몬이 `inbox` 작업 파일을 생성합니다.
- Codex app이 작업을 처리하고 `outbox` 결과 파일을 남깁니다.
- 데몬이 같은 Slack 스레드에 `[codex-result]` 답장을 남깁니다.
- 데몬을 재시작해도 같은 메시지를 다시 처리하지 않습니다.
- 오류가 발생해도 Slack에 실패 상태가 남습니다.
- 사용자는 Codex 화면을 직접 보지 않고도 GPT를 통해 결과를 확인할 수 있습니다.
