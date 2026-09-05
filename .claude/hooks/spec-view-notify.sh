#!/usr/bin/env bash
# .kiro/ 配下の設計ドキュメントが更新されたら、レビュービューの再生成を促す。
#
# PostToolUse(Write|Edit) から呼ばれ、tool 呼び出しの JSON を stdin で受け取る。
# 対象は steering と specs の md のみ。.kiro/settings/ の cc-sdd テンプレートは対象外。
set -uo pipefail

f=$(jq -r '.tool_input.file_path // empty' 2>/dev/null) || exit 0
[ -n "$f" ] || exit 0

case "$f" in
  */.kiro/steering/*.md)
    key=$(basename "$f" .md)
    ;;
  */.kiro/specs/*/*.md)
    key="$(basename "$(dirname "$f")") $(basename "$f" .md)"
    ;;
  *)
    exit 0
    ;;
esac

jq -cn --arg k "$key" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: ("設計ドキュメントを更新した。この編集で一区切りなら /spec-view \($k) を実行してビューを更新し、URL を提示すること。まだ編集を続ける途中なら実行しなくてよい。")
  }
}'
