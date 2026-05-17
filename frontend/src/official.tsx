import React from "react";
import ReactDOM from "react-dom/client";
import {
  ArrowRight,
  Bot,
  Braces,
  Cpu,
  Database,
  Download,
  FileText,
  Github,
  Gift,
  Home,
  Layers3,
  Map,
  MonitorDown,
  Network,
  Route,
  ShieldCheck,
  Sparkles,
  TerminalSquare
} from "lucide-react";
import workbenchImage from "./assets/agent-engine-electron-workbench.png";
import "./official.css";

const capabilities = [
  {
    icon: Map,
    title: "可视化地图编辑",
    text: "导入或生成地图，绘制道路、障碍、行动区和社交区，并用透明图层组织复杂场景。"
  },
  {
    icon: Bot,
    title: "Agent 决策模拟",
    text: "让多 Agent 在同一世界里移动、停留、对话、拾取物体，并记录每次模型决策。"
  },
  {
    icon: Cpu,
    title: "模型能力管理",
    text: "统一管理 Ollama LLM、视觉识别、图像生成和内置 MobileSAM 分层能力。"
  },
  {
    icon: ShieldCheck,
    title: "本地优先运行",
    text: "项目数据、SQLite 状态、素材和模型缓存默认留在本机，适合离线演示与私有实验。"
  },
  {
    icon: MonitorDown,
    title: "Electron 桌面交付",
    text: "同一套 React/Vite 前端可运行在浏览器和桌面壳中，并支持 Mac 与 Windows 打包链路。"
  },
  {
    icon: Network,
    title: "可观测运行链路",
    text: "事件、decision events、运行监控和自愈状态帮助开发者理解模拟为何这样行动。"
  }
];

const stack = [
  { icon: TerminalSquare, name: "FastAPI", detail: "后端 API、模拟规则和本地服务" },
  { icon: Braces, name: "React / Vite", detail: "透明工作台与开发者界面" },
  { icon: MonitorDown, name: "Electron", detail: "桌面应用、内置后端和安装包" },
  { icon: Database, name: "SQLite", detail: "世界状态、事件和模型配置持久化" },
  { icon: Sparkles, name: "Ollama / MobileSAM", detail: "本地 LLM、视觉与地图分层能力" }
];

const deliveryLinks = [
  {
    title: "下载安装",
    text: "下载 Mac 安装包，查看 Windows 状态和平台安装说明。",
    href: "./download.html"
  },
  {
    title: "查看文档",
    text: "快速启动、模型配置、开发命令和常用路径集中整理。",
    href: "./docs.html"
  },
  {
    title: "打赏赞助",
    text: "下载后支持项目继续打磨本地 Agent 工具链。",
    href: "./sponsor.html"
  }
];

function OfficialPage() {
  return (
    <main className="official-shell">
      <div className="official-grid" aria-hidden="true" />
      <header className="official-nav" aria-label="站点导航">
        <a className="brand-mark" href="./official.html" aria-label="Multi-Agent AI Game Engine 首页">
          <span className="brand-icon">
            <Route size={18} strokeWidth={2.2} />
          </span>
          <span>Multi-Agent Engine</span>
        </a>
        <nav className="nav-links" aria-label="页面章节">
          <a className="active" href="./official.html">
            <Home size={16} />
            <span>首页</span>
          </a>
          <a href="./docs.html">
            <FileText size={16} />
            <span>文档</span>
          </a>
          <a href="./download.html">
            <Download size={16} />
            <span>下载</span>
          </a>
          <a href="./sponsor.html">
            <Gift size={16} />
            <span>赞助</span>
          </a>
        </nav>
      </header>

      <section className="hero-section" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">Local-first multi-agent simulation workbench</p>
          <h1 id="hero-title">Multi-Agent AI Game Engine</h1>
          <p className="hero-lede">
            一个面向开发者的本地优先多 Agent 场景模拟与编辑器，用可视化地图、透明图层、模型能力和桌面交付链路，把复杂世界变成可观察、可调试、可发布的系统。
          </p>
          <div className="hero-actions" aria-label="主要行动">
            <a className="button button-primary" href="./download.html">
              <Download size={18} />
              下载 / 安装
            </a>
            <a className="button button-secondary" href="./docs.html">
              <FileText size={18} />
              查看文档
            </a>
          </div>
          <dl className="hero-metrics" aria-label="项目摘要">
            <div>
              <dt>Frontend</dt>
              <dd>React 18 + Vite</dd>
            </div>
            <div>
              <dt>Backend</dt>
              <dd>FastAPI + SQLite</dd>
            </div>
            <div>
              <dt>Desktop</dt>
              <dd>Electron</dd>
            </div>
          </dl>
        </div>

        <div className="product-window" aria-label="Multi-Agent Engine 工作台截图">
          <div className="window-toolbar" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <img src={workbenchImage} alt="Multi-Agent Engine 透明工作台界面截图" />
        </div>
      </section>

      <section id="capabilities" className="content-section" aria-labelledby="capabilities-title">
        <div className="section-heading">
          <p className="eyebrow">Core capabilities</p>
          <h2 id="capabilities-title">从地图到 Agent 行为的完整开发面板</h2>
        </div>
        <div className="capability-grid">
          {capabilities.map((item) => (
            <article className="glass-card" key={item.title}>
              <item.icon size={22} />
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="stack" className="content-section split-section" aria-labelledby="stack-title">
        <div className="section-heading">
          <p className="eyebrow">Architecture</p>
          <h2 id="stack-title">为本地实验和桌面发布准备的工程栈</h2>
          <p>
            项目由 Python/FastAPI 后端、React/Vite 前端和 Electron 桌面壳组成，保留浏览器开发效率，也照顾客户机器上的离线运行与安装交付。
          </p>
        </div>
        <div className="stack-panel">
          {stack.map((item) => (
            <div className="stack-row" key={item.name}>
              <span className="stack-icon">
                <item.icon size={19} />
              </span>
              <span>
                <strong>{item.name}</strong>
                <small>{item.detail}</small>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section id="delivery" className="content-section" aria-labelledby="delivery-title">
        <div className="section-heading">
          <p className="eyebrow">Delivery</p>
          <h2 id="delivery-title">安装包、便携版与开发文档</h2>
        </div>
        <div className="delivery-grid">
          {deliveryLinks.map((item) => (
            <a className="delivery-card" href={item.href} key={item.title}>
              <span>
                <strong>{item.title}</strong>
                <small>{item.text}</small>
              </span>
              <ArrowRight size={18} />
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("official-root")!).render(
  <React.StrictMode>
    <OfficialPage />
  </React.StrictMode>
);
