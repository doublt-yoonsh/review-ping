#!/bin/bash

# ReviewPing - 초기 설정 스크립트
# 팀원이 최초 1회 실행

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HOOKS_DIR="$PROJECT_DIR/.git/hooks"

echo ""
echo "=========================================="
echo "  ⚡ ReviewPing 설정"
echo "=========================================="
echo ""

# Git 저장소인지 확인
if [ ! -d "$PROJECT_DIR/.git" ]; then
    echo "❌ 오류: Git 저장소가 아닙니다."
    echo "   먼저 git clone을 실행해주세요."
    exit 1
fi

# hooks 디렉토리 생성
mkdir -p "$HOOKS_DIR"

# post-merge hook 복사
cp "$SCRIPT_DIR/hooks/post-merge" "$HOOKS_DIR/post-merge"
chmod +x "$HOOKS_DIR/post-merge"

echo "✅ Git hook 설치 완료!"
echo ""
echo "=========================================="
echo "  다음 단계"
echo "=========================================="
echo ""
echo "  1. Chrome 확장 프로그램 설치:"
echo "     - chrome://extensions 접속"
echo "     - '개발자 모드' 활성화"
echo "     - '압축해제된 확장 프로그램을 로드합니다' 클릭"
echo "     - 이 폴더 선택: $PROJECT_DIR"
echo ""
echo "  2. Slack 설정:"
echo "     - 확장 프로그램 아이콘 우클릭 → '옵션'"
echo "     - Bot Token 또는 Webhook URL 입력"
echo ""
echo "  3. 업데이트 받기:"
echo "     - git pull 하면 자동으로 안내가 표시됩니다"
echo ""
echo "=========================================="
echo ""
