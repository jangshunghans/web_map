#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════
#  deploy.sh — 버전 자동 증가 후 GitHub Push
#
#  사용법:
#    bash deploy.sh                  # 버전 자동 증가 + 변경 파일 커밋
#    bash deploy.sh "커밋 메시지"    # 메시지 직접 지정
#
#  동작 순서:
#    1) index.html 에서 현재 버전 읽기 (예: v0.1)
#    2) 마이너 버전 +1 (예: v0.2)
#    3) index.html 버전 배지 업데이트
#    4) git add . → git commit → git push
# ══════════════════════════════════════════════════════════

set -e

INDEX="index.html"

# ── 1. 현재 버전 파싱 ──────────────────────────────────
# grep -E (Extended Regex) 사용 — Windows Git Bash 호환
CURRENT=$(grep -Eo 'v[0-9]+\.[0-9]+' "$INDEX" | head -1)

if [ -z "$CURRENT" ]; then
  echo "ERROR: index.html 에서 버전을 찾을 수 없습니다."
  echo "  형식 확인: <div id=\"version-badge\">v0.1</div>"
  exit 1
fi

echo "현재 버전: $CURRENT"

# ── 2. 버전 분해 및 증가 ───────────────────────────────
# "v0.1" → MAJOR=0, MINOR=1
# sed 로 숫자만 추출 (awk 사용, 호환성 좋음)
MAJOR=$(echo "$CURRENT" | sed 's/v//' | awk -F'.' '{print $1}')
MINOR=$(echo "$CURRENT" | sed 's/v//' | awk -F'.' '{print $2}')

MINOR=$((MINOR + 1))
NEW_VER="v${MAJOR}.${MINOR}"

echo "새 버전:    $NEW_VER"

# ── 3. index.html 버전 배지 교체 ──────────────────────
sed -i "s|id=\"version-badge\">${CURRENT}<|id=\"version-badge\">${NEW_VER}<|g" "$INDEX"

# 교체 확인
UPDATED=$(grep -Eo 'v[0-9]+\.[0-9]+' "$INDEX" | head -1)
if [ "$UPDATED" != "$NEW_VER" ]; then
  echo "ERROR: 버전 교체 실패. index.html 을 직접 확인하세요."
  exit 1
fi

echo "index.html 업데이트: $CURRENT -> $NEW_VER"

# ── 4. 커밋 메시지 ────────────────────────────────────
if [ -n "$1" ]; then
  COMMIT_MSG="$1 [$NEW_VER]"
else
  COMMIT_MSG="chore: 배포 ${NEW_VER}"
fi

# ── 5. git add / commit / push ─────────────────────────
echo ""
git add .

if git diff --cached --quiet; then
  echo "INFO: 커밋할 변경사항이 없습니다."
  exit 0
fi

git commit -m "$(printf '%s\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>' "$COMMIT_MSG")"

echo ""
echo "GitHub 에 Push 중..."
git push

echo ""
echo "======================================"
echo "  배포 완료!"
echo "  버전 : $CURRENT -> $NEW_VER"
echo "  URL  : https://jangshunghans.github.io/web_map/"
echo "  ※ GitHub Pages 반영까지 1~2분 소요"
echo "======================================"
