task_id: <inbox의 task_id>
project_id: <inbox의 project_id>
status: completed
needs_user: false
thread_ts: <inbox의 thread_ts>
# 원본 문서를 Slack에 첨부하려면 아래 세 줄의 주석을 해제합니다.
# attachment_path: <같은 outbox 폴더 안의 원본 문서 파일명.md>
# attachment_title: <Slack에 표시할 문서 제목>
# attachment_comment: 원본 문서를 첨부합니다.
message: |
  요약:
  - 완료한 일을 한두 줄로 적습니다.

  변경/생성 파일:
  - 해당 없음

  검증:
  - 실행한 확인 방법을 적습니다.

  남은 위험:
  - 남은 제한이나 사용자가 알아야 할 내용을 적습니다.

  다음 행동:
  - 필요할 때만 후속 행동을 적습니다.
