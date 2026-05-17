import React from "react";
import ReactDOM from "react-dom/client";
import { BookOpen, Code2, Cpu, Download, FileText, Folder, PlayCircle, TerminalSquare } from "lucide-react";
import { PageHero, SiteChrome } from "./siteChrome";
import "./official.css";

const sections = [
  {
    icon: PlayCircle,
    title: "快速启动",
    body: "先启动后端，再启动 Vite 前端；Electron 桌面版会复用同一套前端，并在打包版中尝试检测或启动内置后端。",
    code: "npm --prefix frontend run dev -- --port 5173"
  },
  {
    icon: Download,
    title: "安装与交付",
    body: "Mac 使用 install kit，Windows 成品包生成后会提供 installer 和 portable；当前 Windows 流程先参考安装与打包文档。",
    code: "npm --prefix frontend run dist:mac"
  },
  {
    icon: Cpu,
    title: "本地模型",
    body: "模型管理面板按能力管理 Ollama LLM、视觉识别、图像生成和 MobileSAM 分层，默认支持 mock provider 作为离线兜底。",
    code: "ollama pull qwen2.5:7b"
  },
  {
    icon: Code2,
    title: "开发验证",
    body: "后端用 pytest，前端用 TypeScript/Vite build 和 Playwright 回归。官网页面也纳入同一套 Vite 多页面构建。",
    code: "npm --prefix frontend run build"
  }
];

const links = [
  { title: "README", href: "../README.md", text: "架构、启动命令、本地模型和目录结构。" },
  { title: "用户手册", href: "../docs/user-manual.zh-CN.md", text: "面向使用者的完整工作台操作说明。" },
  { title: "Mac 安装说明", href: "../docs/mac-installation.zh-CN.md", text: "DMG、安装脚本、权限修复和首次启动。" },
  { title: "Windows 安装说明", href: "../docs/windows-installation.zh-CN.md", text: "Windows 用户安装和运行准备事项。" },
  { title: "开发手册", href: "../docs/development-manual.zh-CN.md", text: "后端、前端、测试和调试流程。" },
  { title: "Windows 打包", href: "../docs/windows-packaging.zh-CN.md", text: "在 Windows 机器上生成 exe 与 smoke 测试。" }
];

function DocsPage() {
  return (
    <SiteChrome active="docs">
      <PageHero eyebrow="Documentation" title="官方文档">
        面向开发者和交付测试的精简文档入口：从启动项目、安装包、模型能力到常用验证命令，先把最容易迷路的地方放在一屏里。
      </PageHero>

      <section className="content-section page-section" aria-labelledby="quick-docs-title">
        <div className="section-heading">
          <p className="eyebrow">Quick paths</p>
          <h2 id="quick-docs-title">常用流程</h2>
        </div>
        <div className="doc-grid">
          {sections.map((item) => (
            <article className="glass-card doc-card" key={item.title}>
              <item.icon size={22} />
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <code>{item.code}</code>
            </article>
          ))}
        </div>
      </section>

      <section className="content-section page-section" aria-labelledby="doc-links-title">
        <div className="section-heading">
          <p className="eyebrow">References</p>
          <h2 id="doc-links-title">原始文档入口</h2>
        </div>
        <div className="link-list">
          {links.map((item) => (
            <a className="delivery-card" href={item.href} key={item.title}>
              <span>
                <strong>{item.title}</strong>
                <small>{item.text}</small>
              </span>
              <FileText size={18} />
            </a>
          ))}
        </div>
      </section>

      <section className="content-section page-section split-section" aria-labelledby="paths-title">
        <div className="section-heading">
          <p className="eyebrow">Project paths</p>
          <h2 id="paths-title">常用路径</h2>
          <p>运行数据默认留在本机，开发、打包和交付文件分别放在固定目录，方便迁移或排查。</p>
        </div>
        <div className="stack-panel">
          {[
            ["runtime_project/", "本机世界状态、素材、模型缓存"],
            ["frontend/src/", "React 工作台与官网页面"],
            ["frontend/release/", "Mac 安装包和 install kit"],
            ["docs/", "用户、安装、开发和交付文档"]
          ].map(([name, detail]) => (
            <div className="stack-row" key={name}>
              <span className="stack-icon">
                <Folder size={18} />
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

ReactDOM.createRoot(document.getElementById("docs-root")!).render(
  <React.StrictMode>
    <DocsPage />
  </React.StrictMode>
);
