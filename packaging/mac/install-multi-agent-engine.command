#!/bin/bash
set -euo pipefail

APP_NAME="Multi-Agent Engine.app"
PRODUCT_NAME="Multi-Agent Engine"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_ROOT="${TARGET_ROOT:-/Applications}"
OPEN_AFTER_INSTALL="${OPEN_AFTER_INSTALL:-1}"
MOUNT_POINT=""

cleanup() {
  if [[ -n "$MOUNT_POINT" ]]; then
    /usr/bin/hdiutil detach "$MOUNT_POINT" -quiet >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

say() {
  printf "\n==> %s\n" "$1"
}

fail() {
  printf "\n安装没有完成：%s\n" "$1" >&2
  exit 1
}

find_app_source() {
  if [[ -d "$SCRIPT_DIR/$APP_NAME" ]]; then
    printf "%s/%s" "$SCRIPT_DIR" "$APP_NAME"
    return 0
  fi

  local dmg
  dmg="${DMG_PATH:-}"
  if [[ -z "$dmg" ]]; then
    dmg="$(find "$SCRIPT_DIR" -maxdepth 1 -name "Multi-Agent Engine-*-mac-*.dmg" -type f | head -n 1)"
  fi
  [[ -n "$dmg" ]] || return 1
  [[ -f "$dmg" ]] || fail "找不到 DMG：$dmg"

  say "挂载安装包 $dmg" >&2
  local attach_output
  attach_output="$(/usr/bin/hdiutil attach -nobrowse -readonly "$dmg")"
  MOUNT_POINT="$(printf "%s\n" "$attach_output" | awk '/\/Volumes\// {print substr($0, index($0, "/Volumes/")); exit}')"
  [[ -n "$MOUNT_POINT" ]] || fail "无法挂载 DMG"

  local mounted_app
  mounted_app="$(find "$MOUNT_POINT" -maxdepth 1 -name "$APP_NAME" -type d | head -n 1)"
  [[ -n "$mounted_app" ]] || fail "DMG 中没有找到 $APP_NAME"
  printf "%s" "$mounted_app"
}

if [[ "$TARGET_ROOT" == "/Applications" && ! -w "$TARGET_ROOT" ]]; then
  TARGET_ROOT="$HOME/Applications"
  say "当前用户不能写入 /Applications，将安装到 $TARGET_ROOT"
fi

/bin/mkdir -p "$TARGET_ROOT"
APP_SOURCE="$(find_app_source)" || fail "请把本脚本放在 DMG 同一目录，或放在 $APP_NAME 旁边运行"
TARGET_APP="$TARGET_ROOT/$APP_NAME"

say "复制到 $TARGET_APP"
/bin/rm -rf "$TARGET_APP"
/usr/bin/ditto "$APP_SOURCE" "$TARGET_APP"

say "处理 macOS 下载隔离标记和执行权限"
/usr/bin/xattr -dr com.apple.quarantine "$TARGET_APP" >/dev/null 2>&1 || true
/bin/chmod +x "$TARGET_APP/Contents/MacOS/$PRODUCT_NAME" >/dev/null 2>&1 || true
/bin/chmod +x "$TARGET_APP/Contents/Resources/backend/agent-engine-backend" >/dev/null 2>&1 || true

say "补做本机 ad-hoc 签名校验"
if /usr/bin/codesign --verify --deep --strict "$TARGET_APP" >/dev/null 2>&1; then
  printf "签名校验通过。\n"
else
  /usr/bin/codesign --force --deep --sign - "$TARGET_APP" >/dev/null 2>&1 || true
  /usr/bin/codesign --verify --deep --strict "$TARGET_APP" >/dev/null 2>&1 || \
    printf "提示：ad-hoc 签名校验仍未完全通过，但应用通常仍可在移除 quarantine 后启动。\n"
fi

printf "\n安装完成：%s\n" "$TARGET_APP"
printf "运行数据目录：%s/Library/Application Support/%s\n" "$HOME" "$PRODUCT_NAME"
printf "日志目录：%s/Library/Application Support/%s/logs\n" "$HOME" "$PRODUCT_NAME"

if [[ "$OPEN_AFTER_INSTALL" == "1" ]]; then
  say "启动应用"
  /usr/bin/open "$TARGET_APP"
fi
