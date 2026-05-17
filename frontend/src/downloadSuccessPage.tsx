import React from "react";
import ReactDOM from "react-dom/client";
import { CheckCircle2, FileCheck2, FileText, Gift, Home, ShieldCheck, TerminalSquare } from "lucide-react";
import { PageHero, SiteChrome } from "./siteChrome";
import "./official.css";

function platformName() {
  const params = new URLSearchParams(window.location.search);
  const platform = params.get("platform");
  if (platform === "windows" || platform === "win") {
    return "Windows 安装包";
  }
  if (platform === "mac-dmg") {
    return "Mac DMG";
  }
  return "Mac install kit";
}

function platformInstallDoc() {
  const platform = new URLSearchParams(window.location.search).get("platform");
  if (platform === "windows" || platform === "win") {
    return {
      title: "Windows 安装说明",
      href: "../docs/windows-installation.zh-CN.md",
      text: "Windows installer、运行环境和首次启动注意事项。"
    };
  }
  return {
    title: "Mac 安装说明",
    href: "../docs/mac-installation.zh-CN.md",
    text: "权限修复、脚本安装和首次运行注意事项。"
  };
}

function DownloadSuccessPage() {
  const installDoc = platformInstallDoc();

  return (
    <SiteChrome active="download">
      <PageHero
        eyebrow="Download started"
        title="下载已开始"
        actions={
          <>
            <a className="button button-primary" href="./sponsor.html">
              <Gift size={18} />
              打赏赞助
            </a>
            <a className="button button-secondary" href="./docs.html">
              <FileText size={18} />
              查看文档
            </a>
          </>
        }
      >
        浏览器已经开始下载 {platformName()}。下载完成后，建议先核对校验文件，再按安装说明启动应用。
      </PageHero>

      <section className="content-section page-section" aria-labelledby="next-title">
        <div className="section-heading">
          <p className="eyebrow">Next steps</p>
          <h2 id="next-title">接下来做什么</h2>
        </div>
        <div className="doc-grid">
          {[
            { icon: CheckCircle2, title: "确认文件保存完成", text: "如果浏览器仍在下载，请等待文件完全保存后再解压或挂载 DMG。" },
            { icon: FileCheck2, title: "核对 SHA256", text: "install kit 内含 SHA256SUMS.txt，可以确认安装包未损坏。" },
            { icon: TerminalSquare, title: "运行安装程序", text: "Mac 可使用 install kit 脚本；Windows 直接运行 x64 installer。" },
            { icon: ShieldCheck, title: "首次打开应用", text: "如果系统拦截未知发布者或未签名应用，请按对应安装说明处理。" }
          ].map((item) => (
            <article className="glass-card doc-card" key={item.title}>
              <item.icon size={22} />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="content-section page-section">
        <div className="delivery-grid">
          <a className="delivery-card" href={installDoc.href}>
            <span>
              <strong>{installDoc.title}</strong>
              <small>{installDoc.text}</small>
            </span>
            <FileText size={18} />
          </a>
          <a className="delivery-card" href="../docs/user-manual.zh-CN.md">
            <span>
              <strong>用户手册</strong>
              <small>地图、Agent、模型管理和场景操作说明。</small>
            </span>
            <FileText size={18} />
          </a>
          <a className="delivery-card" href="./official.html">
            <span>
              <strong>返回首页</strong>
              <small>回到官方网页继续查看能力与技术栈。</small>
            </span>
            <Home size={18} />
          </a>
        </div>
      </section>
    </SiteChrome>
  );
}

ReactDOM.createRoot(document.getElementById("download-success-root")!).render(
  <React.StrictMode>
    <DownloadSuccessPage />
  </React.StrictMode>
);
