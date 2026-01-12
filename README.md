# ReviewPing

GitHub PR 페이지에서 Slack으로 리뷰 요청/완료 알림을 보내는 Chrome 확장 프로그램

## 기능

- **리뷰 요청**: 내 PR에서 리뷰어에게 Slack 알림 전송
- **리뷰 완료**: 다른 사람 PR에서 리뷰 완료 알림 전송
- **리뷰어 추천**: 이전에 리뷰 요청했던 사람 자동 추천
- **저장소별 채널 매핑**: 저장소마다 다른 Slack 채널로 알림
- **GitHub → Slack 사용자 매핑**: 멘션이 제대로 동작하도록 매핑
- **봇 계정 자동 필터링**: cursor[bot], dependabot 등 제외

## 설치

```bash
# 1. 클론
git clone https://github.com/doublt-yoonsh/review-ping.git
cd review-ping

# 2. 설정 (최초 1회)
./scripts/setup.sh

# 3. Chrome 확장 프로그램 로드
#    chrome://extensions → 개발자 모드 ON → 압축해제된 확장 프로그램 로드 → review-ping 폴더 선택

# 4. 옵션에서 Slack 설정
#    확장 프로그램 아이콘 우클릭 → 옵션
```

## 업데이트

```bash
git pull
# → 자동으로 chrome://extensions 페이지가 열림
# → 확장 프로그램 새로고침 클릭
# → GitHub PR 페이지 새로고침
```

## Slack 설정

### Bot Token 방식 (권장)

1. [api.slack.com/apps](https://api.slack.com/apps) 접속
2. Create New App → From scratch
3. OAuth & Permissions → Bot Token Scopes에 추가:
   - `chat:write`
   - `chat:write.public`
4. Install to Workspace
5. Bot User OAuth Token 복사 (`xoxb-`로 시작)
6. 확장 프로그램 옵션에 입력

### Webhook 방식

1. [api.slack.com/apps](https://api.slack.com/apps) 접속
2. Incoming Webhooks → Activate
3. Add New Webhook to Workspace → 채널 선택
4. Webhook URL 복사
5. 확장 프로그램 옵션에 입력

## 사용법

1. GitHub PR 페이지 접속
2. 우측 하단에 버튼 표시:
   - **내 PR**: 초록색 "리뷰 요청" 버튼
   - **다른 사람 PR**: 보라색 "리뷰 완료" 버튼
3. 클릭하면 Slack으로 알림 전송

## 구조

```
review-ping/
├── manifest.json          # 확장 프로그램 설정
├── background/            # Service Worker (Slack API 호출)
├── content/               # Content Script (GitHub 페이지에 버튼 삽입)
├── options/               # 설정 페이지
├── popup/                 # 팝업 (상태 표시)
└── scripts/               # 설치 스크립트
```
