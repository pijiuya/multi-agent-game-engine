# Multi-Agent Engine macOS 安装说明

本文面向拿到安装包的普通 Mac 用户。目标是从零安装并启动，不依赖 Codex、Python、Node 或命令行开发环境。

## 1. 安装包里应该有什么

推荐分发整个 `Multi-Agent-Engine-0.1.0-mac-install-kit` 文件夹，里面包含：

- `Multi-Agent Engine-0.1.0-mac-arm64.dmg`：应用安装包。
- `install-multi-agent-engine.command`：安装辅助脚本。
- `setup-ollama.command`：Ollama 本地模型配置助手，可选运行。
- `README-mac-installation.zh-CN.md`：本文。
- `user-manual.zh-CN.md`：用户手册。
- `SHA256SUMS.txt`：安装包校验值。

当前包面向 Apple Silicon Mac，也就是 arm64。Intel Mac 需要单独构建 x64 包。

## 2. 最简单安装方式

1. 下载并解压 `Multi-Agent-Engine-0.1.0-mac-install-kit`。
2. 双击 `install-multi-agent-engine.command`。
3. 如果 macOS 提示这个脚本来自未知开发者，在 Finder 中右键该脚本，选择「打开」，再确认运行。
4. 脚本会自动挂载 DMG、复制应用、清除下载隔离标记、修复执行权限、补做本机 ad-hoc 签名，然后启动应用。

默认会安装到：

```text
/Applications/Multi-Agent Engine.app
```

如果当前用户没有写入 `/Applications` 的权限，脚本会自动改装到：

```text
~/Applications/Multi-Agent Engine.app
```

## 3. 为什么仍可能看到安全提示

当前安装包没有 Apple Developer ID 证书，也没有 Apple notarization。因此它不是“已公证的正式发行版”。macOS Gatekeeper 可能提示：

- 无法验证开发者。
- Apple 无法检查是否包含恶意软件。
- 已阻止使用。

安装辅助脚本会自动处理可自动处理的部分：

- 移除 `com.apple.quarantine` 下载隔离标记。
- 给 Electron 主程序和内置后端加执行权限。
- 对 `.app` 做本机 ad-hoc 签名和校验。

这些步骤可以避免大多数首次打开失败，但它不能替代 Apple 官方 Developer ID 签名和 notarization。

## 4. 如果脚本打不开

在 Finder 中右键 `install-multi-agent-engine.command`，选择「打开」。如果仍然打不开：

1. 打开「系统设置」。
2. 进入「隐私与安全性」。
3. 找到被阻止的脚本或应用。
4. 点击「仍要打开」。

这个操作只需要首次运行时做一次。

## 5. 手动安装方式

如果你不想运行脚本：

1. 双击 `.dmg`。
2. 把 `Multi-Agent Engine.app` 拖到 `/Applications`。
3. 第一次打开时，如果被 macOS 阻止，进入「系统设置 / 隐私与安全性」点击「仍要打开」。

如果应用被复制后仍打不开，可以在「终端」运行：

```bash
xattr -dr com.apple.quarantine "/Applications/Multi-Agent Engine.app"
chmod +x "/Applications/Multi-Agent Engine.app/Contents/MacOS/Multi-Agent Engine"
chmod +x "/Applications/Multi-Agent Engine.app/Contents/Resources/backend/agent-engine-backend"
codesign --force --deep --sign - "/Applications/Multi-Agent Engine.app"
open "/Applications/Multi-Agent Engine.app"
```

如果应用安装在 `~/Applications`，把上面的路径换成：

```text
~/Applications/Multi-Agent Engine.app
```

## 6. 第一次启动会发生什么

应用会自动启动内置本机后端，不需要安装 Python 或 Node.js。默认端口是：

```text
127.0.0.1:8000
```

当前版本默认关闭场景叙事 sidecar，因此不会自动连接 `127.0.0.1:8011`，也不会因为本地叙事模型未安装而影响 Agent 对话。

第一次启动会把内置示例项目复制到用户数据目录：

```text
~/Library/Application Support/Multi-Agent Engine/runtime_project
```

日志目录是：

```text
~/Library/Application Support/Multi-Agent Engine/logs
```

## 7. 可选：本地 LLM

Agent 对话可以使用本地 Ollama，但安装应用本身不要求 Ollama。

如果用户不会使用终端，可以双击 install kit 里的：

```text
setup-ollama.command
```

它会自动检测 Ollama、调用 Ollama 官方安装脚本、启动本地服务，并可选下载推荐模型 `qwen2.5:1.5b`。如果 macOS 拦截这个脚本，请在 Finder 中右键它，选择「打开」，再确认运行。

如果你希望使用本地模型：

1. 安装 Ollama。
2. 启动 Ollama。
3. 拉取模型，例如：

```bash
ollama pull qwen2.5:1.5b
```

4. 在应用的「模型管理」或 Agent 面板中选择对应模型。

## 8. 正式发行需要什么

如果要让陌生用户完全不碰安全设置，发布者需要准备：

- Apple Developer Program 账号。
- Developer ID Application 证书。
- Electron Builder 的签名配置。
- Apple notarization 凭据。
- `xcrun notarytool submit` 公证流程。
- `xcrun stapler staple` 把公证票据钉到 `.app` 或 `.dmg`。

没有这些条件时，安装辅助脚本是当前能做到的最平滑方案。

## 9. 排障

应用只显示“正在等待本机引擎”：

- 等 20 秒，首次启动后端会慢一些。
- 查看日志：`~/Library/Application Support/Multi-Agent Engine/logs/backend.err.log`。
- 如果 8000 端口被占用，应用会尝试自动换端口。

应用打开后没有项目数据：

- 检查 `~/Library/Application Support/Multi-Agent Engine/runtime_project/world.sqlite` 是否存在。
- 删除整个 `runtime_project` 后重新打开，应用会重新复制内置示例项目。

仍然提示无法打开：

- 使用安装辅助脚本重新安装。
- 或在「系统设置 / 隐私与安全性」中点击「仍要打开」。
