# Multi-Agent Engine Windows 安装说明

本文面向拿到 Windows 安装包的普通用户。当前版本是临时未签名分发版，安装和运行不需要 Python、Node.js 或 Codex。

## 1. 安装包里应该有什么

推荐分发整个 `Multi-Agent-Engine-0.1.0-win-install-kit` 文件夹，里面包含：

- `Multi-Agent Engine-0.1.0-win-installer-x64.exe`：安装器，推荐普通用户使用。
- `Multi-Agent Engine-0.1.0-win-portable-x64.exe`：免安装版，适合演示或临时运行。
- `README-windows-installation.zh-CN.md`：本文。
- `user-manual.zh-CN.md`：完整用户手册。
- `SHA256SUMS.txt`：安装包校验值。

当前包面向 Windows x64。

## 2. 普通安装方式

1. 双击 `Multi-Agent Engine-0.1.0-win-installer-x64.exe`。
2. 如果 Windows SmartScreen 提示“Windows 已保护你的电脑”，点击「更多信息」。
3. 点击「仍要运行」。
4. 按安装器提示完成安装。
5. 从开始菜单或桌面快捷方式启动 `Multi-Agent Engine`。

首次启动会自动创建一个空白项目，不会带入开发机上的地图、agent、item 或素材。

## 3. 免安装运行方式

如果不想安装，双击：

```text
Multi-Agent Engine-0.1.0-win-portable-x64.exe
```

Portable 仍会把运行数据写入当前 Windows 用户的数据目录，不会把项目保存在 exe 旁边。

## 4. 数据和日志目录

项目数据目录：

```text
%APPDATA%\Multi-Agent Engine\runtime_project\
```

日志目录：

```text
%APPDATA%\Multi-Agent Engine\logs\
```

常见日志文件：

```text
%APPDATA%\Multi-Agent Engine\logs\electron-main.log
%APPDATA%\Multi-Agent Engine\logs\backend.out.log
%APPDATA%\Multi-Agent Engine\logs\backend.err.log
```

## 5. 为什么会有安全提示

当前临时版本没有 Authenticode 代码签名证书。Windows 可能显示：

- 未知发布者。
- SmartScreen 拦截。
- Windows 安全中心或杀毒软件提示。

这是未签名临时软件的正常现象。正式免提示发布需要购买/配置代码签名证书，并对 installer 和 portable 做 Authenticode 签名。

## 6. 本地模型

安装包不包含 Ollama 模型或其他大模型权重。应用可以先用 Mock LLM 打开和试用。

如果要使用本地 LLM：

1. 安装并启动 Ollama。
2. 拉取模型，例如：

```powershell
ollama pull qwen2.5:1.5b
```

3. 在应用的模型管理或 Agent 面板里选择对应模型。

## 7. 排障

应用显示“正在等待本机引擎”：

- 等待 20 秒，首次启动后端可能较慢。
- 检查是否有其他程序占用 `127.0.0.1:8000`。
- 查看 `%APPDATA%\Multi-Agent Engine\logs\backend.err.log`。

启动后仍是旧项目：

- 说明这台电脑以前运行过应用，已有 `%APPDATA%\Multi-Agent Engine\runtime_project`。
- 备份后删除该目录，再重新启动应用即可生成新的空白项目。

杀毒软件拦截：

- 从可信来源重新下载完整 install kit。
- 优先使用 installer；如果 installer 被拦，再尝试 portable。
- 正式发行前应补 Authenticode 签名。
