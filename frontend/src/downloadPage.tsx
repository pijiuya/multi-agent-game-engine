import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { Apple, Download, FileText, HardDriveDownload, Laptop, MonitorDown, ShieldCheck } from "lucide-react";
import { PageHero, SiteChrome } from "./siteChrome";
import "./official.css";

const macKitHref = "./release/Multi-Agent-Engine-0.1.0-mac-install-kit.zip";
const macDmgHref = "./release/Multi-Agent%20Engine-0.1.0-mac-arm64.dmg";
const windowsInstallerHref = "./release/Multi-Agent%20Engine-0.1.0-win-installer-x64.exe";

type Platform = "mac" | "windows";

function queueSuccessRedirect(platform: string) {
  window.setTimeout(() => {
    window.location.href = `./download-success.html?platform=${encodeURIComponent(platform)}`;
  }, 900);
}

function platformFromSearch(): Platform | null {
  const platform = new URLSearchParams(window.location.search).get("platform");
  if (platform === "windows" || platform === "win") {
    return "windows";
  }
  if (platform === "mac" || platform === "macos" || platform === "mac-dmg") {
    return "mac";
  }
  return null;
}

function detectPlatform(): Platform {
  const nav = window.navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = `${nav.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`.toLowerCase();
  if (platform.includes("win")) {
    return "windows";
  }
  return "mac";
}

function setPlatformUrl(platform: Platform, replace = false) {
  const nextUrl = `./download.html?platform=${platform}`;
  if (replace) {
    window.history.replaceState(null, "", nextUrl);
    return;
  }
  window.history.pushState(null, "", nextUrl);
}

function DownloadPage() {
  const [platform, setPlatform] = useState<Platform>(() => platformFromSearch() ?? detectPlatform());
  const isWindows = platform === "windows";
  const primaryDownload = useMemo(
    () =>
      isWindows
        ? {
            label: "下载 Windows 安装包",
            href: windowsInstallerHref,
            platform: "windows"
          }
        : {
            label: "下载 Mac install kit",
            href: macKitHref,
            platform: "mac"
          },
    [isWindows]
  );

  useEffect(() => {
    if (!platformFromSearch()) {
      setPlatformUrl(platform, true);
    }
  }, [platform]);

  function choosePlatform(nextPlatform: Platform) {
    setPlatform(nextPlatform);
    setPlatformUrl(nextPlatform);
  }

  return (
    <SiteChrome active="download">
      <PageHero
        eyebrow="Download"
        title="下载安装"
        actions={
          <>
            <a className="button button-primary" download href={primaryDownload.href} onClick={() => queueSuccessRedirect(primaryDownload.platform)}>
              <Download size={18} />
              {primaryDownload.label}
            </a>
            <a className="button button-secondary" href="./docs.html">
              <FileText size={18} />
              安装文档
            </a>
          </>
        }
      >
        下载页会根据当前电脑系统自动进入对应下载视图；也可以手动切换 Mac 或 Windows。下载开始后页面会进入成功页，方便继续查看安装步骤和赞助入口。
      </PageHero>

      <section className="content-section page-section compact-section" aria-label="选择电脑系统">
        <div className="system-switch" role="group" aria-label="选择下载系统">
          <button className={platform === "mac" ? "active" : undefined} type="button" onClick={() => choosePlatform("mac")}>
            <Apple size={18} />
            Mac
          </button>
          <button className={platform === "windows" ? "active" : undefined} type="button" onClick={() => choosePlatform("windows")}>
            <Laptop size={18} />
            Windows
          </button>
        </div>
      </section>

      <section className="content-section page-section" aria-labelledby="platform-title">
        <div className="section-heading">
          <p className="eyebrow">Packages</p>
          <h2 id="platform-title">平台安装包</h2>
        </div>
        <div className="download-grid">
          <article className={`glass-card download-card ${platform === "mac" ? "featured-download platform-selected" : ""}`}>
            <Apple size={24} />
            <h3>Mac install kit</h3>
            <p>推荐下载。包含 DMG、安装脚本、Ollama 辅助脚本、用户手册和 SHA256 校验文件。</p>
            <div className="meta-row">
              <span>macOS arm64</span>
              <span>约 305 MB</span>
            </div>
            <a className="button button-primary" download href={macKitHref} onClick={() => queueSuccessRedirect("mac")}>
              <HardDriveDownload size={18} />
              下载 install kit
            </a>
          </article>

          <article className={`glass-card download-card ${platform === "windows" ? "featured-download platform-selected" : ""}`}>
            <Laptop size={24} />
            <h3>Windows installer</h3>
            <p>最新 Windows x64 安装包已经可下载。适合 Windows 11 x64 机器安装测试，便携版后续可继续补充。</p>
            <div className="meta-row">
              <span>Windows x64</span>
              <span>约 141 MB</span>
            </div>
            <a className="button button-primary" download href={windowsInstallerHref} onClick={() => queueSuccessRedirect("windows")}>
              <Download size={18} />
              下载 Windows 安装包
            </a>
          </article>

          <article className="glass-card download-card">
            <MonitorDown size={24} />
            <h3>Mac DMG 备用</h3>
            <p>只需要应用安装镜像时可以下载 DMG；首次运行仍建议参考 Mac 安装说明处理权限。</p>
            <div className="meta-row">
              <span>macOS arm64</span>
              <span>约 306 MB</span>
            </div>
            <a className="button button-secondary" download href={macDmgHref} onClick={() => queueSuccessRedirect("mac-dmg")}>
              <Download size={18} />
              下载 DMG
            </a>
          </article>
        </div>
      </section>

      <section className="content-section page-section split-section" aria-labelledby="verify-title">
        <div className="section-heading">
          <p className="eyebrow">Verification</p>
          <h2 id="verify-title">下载后建议</h2>
          <p>安装包来自当前仓库本地 release。发布到公网时，需要把 `frontend/release/` 一起部署到静态站点的 `release/` 路径。</p>
        </div>
        <div className="stack-panel">
          {[
            ["自动识别系统", "访问 download.html 时会根据浏览器平台写入 ?platform=mac 或 ?platform=windows。"],
            ["阅读安装说明", "Mac 首次运行可能需要清除隔离标记；Windows 建议参考安装说明。"],
            ["保留用户手册", "用户手册随 Mac install kit 一起分发，也可以从文档页打开。"]
          ].map(([name, detail]) => (
            <div className="stack-row" key={name}>
              <span className="stack-icon">
                <ShieldCheck size={18} />
              </span>
              <span>
                <strong>{name}</strong>
                <small>{detail}</small>
              </span>
            </div>
          ))}
        </div>
      </section>
    </SiteChrome>
  );
}

ReactDOM.createRoot(document.getElementById("download-root")!).render(
  <React.StrictMode>
    <DownloadPage />
  </React.StrictMode>
);
