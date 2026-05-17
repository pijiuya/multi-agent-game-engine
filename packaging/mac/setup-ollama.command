#!/bin/bash
set -euo pipefail

MODEL="${OLLAMA_SETUP_MODEL:-qwen2.5:1.5b}"
LOG_DIR="$HOME/Library/Logs/Multi-Agent Engine"
LOG_FILE="$LOG_DIR/ollama-setup.log"
mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

say() {
  printf "\n==> %s\n" "$1"
}

dialog() {
  /usr/bin/osascript -e "display dialog \"$1\" buttons {\"好\"} default button \"好\" with title \"Ollama 配置助手\"" >/dev/null 2>&1 || true
}

confirm() {
  /usr/bin/osascript -e "button returned of (display dialog \"$1\" buttons {\"跳过\", \"继续\"} default button \"继续\" cancel button \"跳过\" with title \"Ollama 配置助手\")" 2>/dev/null || true
}

open_download_page() {
  /usr/bin/open "https://ollama.com/download"
}

ollama_bin() {
  if command -v ollama >/dev/null 2>&1; then
    command -v ollama
    return 0
  fi
  if [[ -x "/Applications/Ollama.app/Contents/Resources/ollama" ]]; then
    printf "%s\n" "/Applications/Ollama.app/Contents/Resources/ollama"
    return 0
  fi
  return 1
}

wait_for_ollama() {
  for _ in $(seq 1 90); do
    if /usr/bin/curl -fsS "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
      return 0
    fi
    /bin/sleep 1
  done
  return 1
}

say "开始配置 Ollama 环境"
say "日志：$LOG_FILE"

if ! OLLAMA_BIN="$(ollama_bin)"; then
  if [[ "$(confirm "这台 Mac 还没有检测到 Ollama。配置助手将从 Ollama 官方地址下载安装，过程中可能需要输入本机密码。是否继续？")" != "继续" ]]; then
    dialog "已取消安装。你也可以稍后手动从 ollama.com/download 下载 Ollama。"
    open_download_page
    exit 0
  fi

  say "下载并运行 Ollama 官方安装脚本"
  TMP_SCRIPT="$(mktemp "${TMPDIR:-/tmp}/ollama-install.XXXXXX.sh")"
  /usr/bin/curl -fsSL "https://ollama.com/install.sh" -o "$TMP_SCRIPT"
  /bin/bash "$TMP_SCRIPT"
  /bin/rm -f "$TMP_SCRIPT"
fi

if ! OLLAMA_BIN="$(ollama_bin)"; then
  dialog "Ollama 安装后仍没有找到命令行组件。请按打开的官方下载页安装 Ollama，然后再运行本助手。"
  open_download_page
  exit 1
fi

say "Ollama 命令：$OLLAMA_BIN"
say "启动 Ollama"
/usr/bin/open -a Ollama --args hidden >/dev/null 2>&1 || true

if ! wait_for_ollama; then
  dialog "没有检测到 Ollama 服务启动。请手动打开 Ollama.app，看到菜单栏图标后再运行本助手。"
  open_download_page
  exit 1
fi

say "Ollama 服务已运行：http://127.0.0.1:11434"

if "$OLLAMA_BIN" list 2>/dev/null | awk '{print $1}' | grep -Fx "$MODEL" >/dev/null 2>&1; then
  say "推荐模型已存在：$MODEL"
else
  if [[ "$(confirm "Ollama 已启动。是否现在下载推荐本地模型 $MODEL？下载可能需要几分钟，取决于网络。")" == "继续" ]]; then
    say "下载模型：$MODEL"
    "$OLLAMA_BIN" pull "$MODEL"
  else
    say "用户选择跳过模型下载"
  fi
fi

if /usr/bin/curl -fsS "http://127.0.0.1:11434/api/tags" >/dev/null 2>&1; then
  dialog "Ollama 环境配置完成。现在可以打开 Multi-Agent Engine，在模型管理里选择 Ollama / $MODEL。"
else
  dialog "Ollama 安装完成，但服务检查没有通过。请重启 Ollama 后再打开 Multi-Agent Engine。"
fi

