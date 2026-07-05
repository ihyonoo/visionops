# VisionOps 외부 알림 연동 설계

## 배경

현재 VisionOps는 프론트엔드가 학습/추론 실행 목록을 polling하면서 상태 변화를 감지하고, 브라우저 알림과 앱 내부 알림을 표시한다. 이 방식은 사용자가 앱 화면을 열어둔 동안에는 충분하지만, 장시간 학습이나 추론이 끝났을 때 Slack, Discord, Telegram 같은 외부 메신저로 알림을 받기에는 적합하지 않다.

외부 알림은 백엔드 worker가 학습/추론 상태를 `completed` 또는 `failed`로 확정하는 시점에 보내는 것이 가장 안정적이다. 화면이 닫혀 있어도 worker는 계속 실행되고, 완료/실패 상태와 같은 서버 측 이벤트를 정확하게 알고 있기 때문이다.

## 목표

- 앱 전체 공통 알림 설정을 제공한다.
- 1차 채널은 Slack, Discord, Telegram만 지원한다.
- 이벤트는 학습과 추론을 나누고, 완료와 실패도 각각 켜고 끌 수 있게 한다.
- 설정 화면에서 채널별 secret을 저장, 교체, 삭제, 테스트할 수 있게 한다.
- API 응답, 로그, 전송 실패 메시지에 webhook URL이나 bot token 원문이 노출되지 않게 한다.
- 이메일 알림은 1차 구현 범위에서 제외하되, 같은 구조로 쉽게 추가할 수 있게 한다.

## 비목표

- 사용자별 알림 설정은 구현하지 않는다.
- 프로젝트별 알림 설정은 구현하지 않는다.
- 알림 재시도 큐나 백오프 스케줄러는 1차 범위에 포함하지 않는다.
- Slack/Discord/Telegram의 양방향 인터랙션, 버튼 액션, 명령어 수신은 구현하지 않는다.
- secret 암호화 저장은 1차 범위에 포함하지 않는다. 로컬 SQLite 저장을 기본으로 하되, 원문 노출 방지와 마스킹으로 안전장치를 둔다.

## 사용자 경험

설정 화면에 `알림` 섹션을 추가한다. 앱 전체 공통 설정이므로 프로젝트 상세 화면이 아니라 전역 설정 영역에서 접근하는 것이 좋다. 현재 앱에 별도 설정 화면이 없으므로 1차 구현에서는 Layout 내 전역 진입점 또는 간단한 설정 페이지를 추가한다.

채널별 설정 카드에는 다음 항목을 둔다.

- 활성화 토글
- 학습 완료
- 학습 실패
- 추론 완료
- 추론 실패
- 채널별 연결 정보 입력
- 저장 버튼
- 테스트 알림 보내기 버튼
- 마지막 테스트/전송 상태

secret 값은 저장 후 원문을 다시 보여주지 않는다. 예를 들어 Discord webhook URL은 `••••••••/abcd`처럼 마지막 일부만 보여준다. 사용자가 새 값을 입력하면 기존 값을 교체하고, 빈 값 제출은 기존 secret 유지로 처리한다. 별도 `연결 삭제` 동작은 저장된 secret과 채널 설정을 제거한다.

## 데이터 모델

새 테이블 `notification_channels`를 추가한다.

주요 필드:

- `id`: 문자열 기본키
- `channel`: `slack`, `discord`, `telegram`
- `enabled`: 채널 전체 활성화 여부
- `events`: JSON 객체
  - `training_completed`
  - `training_failed`
  - `inference_completed`
  - `inference_failed`
- `config`: JSON 객체
  - Slack: `webhook_url`
  - Discord: `webhook_url`
  - Telegram: `bot_token`, `chat_id`
- `last_status`: `unknown`, `sent`, `failed`
- `last_error`: secret을 제거한 최근 실패 메시지
- `last_sent_at`
- `created_at`
- `updated_at`

새 테이블 `notification_deliveries`를 추가한다.

주요 필드:

- `id`: 문자열 기본키
- `channel_id`
- `channel`
- `event_type`
- `target_type`: `training` 또는 `inference`
- `target_id`
- `status`: `sent` 또는 `failed`
- `error_message`: secret을 제거한 실패 메시지
- `created_at`

`notification_deliveries`는 전송 결과 추적용이다. 외부 알림이 오지 않았을 때, 작업 자체 실패인지 알림 전송 실패인지 구분할 수 있게 한다.

## API 설계

새 라우터 prefix는 `/api/notification-settings`로 둔다.

- `GET /api/notification-settings`
  - 전체 채널 설정 목록을 반환한다.
  - secret 원문은 반환하지 않고 `has_secret`, `masked_secret` 형태로만 반환한다.

- `PUT /api/notification-settings/{channel}`
  - 채널 설정을 생성 또는 갱신한다.
  - secret 필드는 새 값이 들어왔을 때만 교체한다.
  - 이벤트 토글과 enabled 상태를 저장한다.

- `DELETE /api/notification-settings/{channel}`
  - 해당 채널 설정과 secret을 삭제한다.

- `POST /api/notification-settings/{channel}/test`
  - 저장된 설정 또는 요청 본문에 포함된 임시 설정으로 테스트 알림을 보낸다.
  - 성공/실패를 `notification_deliveries`에 기록한다.

## 백엔드 전송 구조

새 서비스 `app/services/notifications.py`를 추가한다.

핵심 함수:

- `send_work_notification(db, event)`
- `send_test_notification(db, channel, override_config=None)`
- `dispatch_notification(channel, message)`

채널별 adapter:

- Slack: incoming webhook URL에 JSON payload POST
- Discord: webhook URL에 JSON payload POST
- Telegram: `https://api.telegram.org/bot{token}/sendMessage`에 `chat_id`, `text` POST

현재 백엔드 의존성에는 범용 HTTP 클라이언트가 없다. `httpx`가 dev dependency에만 있으므로, 1차 구현에서는 표준 라이브러리 `urllib.request`를 사용하거나 `httpx`를 runtime dependency로 승격한다. 테스트성과 에러 처리를 고려하면 `httpx`를 정식 dependency로 추가하는 쪽을 권장한다.

## Worker 연동

`backend/app/worker.py`에서 학습/추론 상태가 최종 상태로 커밋되는 지점에 알림 호출을 추가한다.

대상 이벤트:

- 학습 성공: `training_completed`
- 학습 실패: `training_failed`
- 추론 성공: `inference_completed`
- 추론 실패: `inference_failed`

알림 전송 실패가 학습/추론 작업 상태를 바꾸면 안 된다. 따라서 작업 상태 커밋 이후 알림을 시도하고, 알림 실패는 `notification_deliveries`와 채널의 `last_status`, `last_error`에만 기록한다.

## 메시지 포맷

메시지는 짧고 행동 가능하게 만든다.

공통 포함 항목:

- 이벤트 제목
- 프로젝트명
- 실행명
- 상태
- 완료/실패 시각
- 요약 지표 또는 결과 수
- 로컬 앱 링크가 구성 가능한 경우 상세 페이지 링크

1차 구현에서는 로컬 앱 URL 설정이 없으므로 상세 링크는 선택 항목으로 둔다. 이후 `VISIONOPS_PUBLIC_APP_URL` 또는 설정 화면의 앱 URL 필드를 추가하면 메시지에 상세 링크를 넣을 수 있다.

## 보안 및 안전장치

- API 응답에서 secret 원문을 반환하지 않는다.
- 로그에 webhook URL, bot token, chat id를 출력하지 않는다.
- 전송 실패 메시지는 URL/token 패턴을 제거한 뒤 저장한다.
- 설정 화면에서는 저장된 secret을 마스킹한다.
- 로컬 DB와 `vision_ops_data`는 git에 포함하지 않는다.
- 테스트 알림은 저장 전 임시 config로도 보낼 수 있지만, 그 경우에도 응답에 secret을 되돌려주지 않는다.

## 프론트엔드 변경

새 전역 설정 화면 또는 패널을 추가한다.

주요 파일 후보:

- `frontend/src/App.tsx`: `settings` section routing 상태 추가
- `frontend/src/components/Layout.tsx`: 설정 진입점 추가
- `frontend/src/pages/NotificationSettingsPage.tsx`: 알림 설정 화면
- `frontend/src/api/types.ts`: 알림 설정 타입 추가

UI는 기존 운영 도구 톤에 맞춘다. 채널별 카드는 반복 항목으로 사용하고, 이벤트 토글은 checkbox 또는 switch로 제공한다. 저장/테스트/삭제는 명확한 버튼으로 제공한다.

## 테스트 계획

백엔드:

- 채널 설정 생성/조회/수정/삭제 테스트
- secret이 API 응답에 노출되지 않는지 테스트
- 이벤트별 enabled 필터링 테스트
- Slack/Discord/Telegram adapter의 payload 생성 및 HTTP 호출 테스트
- worker 완료/실패 시 알림 서비스가 호출되는지 테스트
- 알림 실패가 작업 상태를 실패로 바꾸지 않는지 테스트

프론트엔드:

- 알림 설정 화면 렌더링 테스트
- 저장된 secret 마스킹 표시 테스트
- 이벤트 토글 payload 테스트
- 테스트 알림 성공/실패 상태 표시 테스트

## 이메일 확장 방향

이메일은 2차 확장으로 추가한다. 같은 `notification_channels` 구조에 `channel = email`을 추가하고, `config`에는 SMTP host, port, username, password, from, recipients, TLS 여부를 저장한다.

이메일은 SMTP 인증, TLS, 스팸 정책, provider별 앱 비밀번호 이슈가 있어 Slack/Discord/Telegram보다 설정 난이도가 높다. 따라서 1차 구현에서 제외하고, 메신저 알림 구조가 안정화된 뒤 추가한다.
