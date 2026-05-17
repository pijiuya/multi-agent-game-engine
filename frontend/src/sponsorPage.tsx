import React from "react";
import ReactDOM from "react-dom/client";
import { Coffee, FileText, Gift, HeartHandshake, Home, Sparkles } from "lucide-react";
import { PageHero, SiteChrome } from "./siteChrome";
import "./official.css";

function SponsorPage() {
  return (
    <SiteChrome active="sponsor">
      <PageHero
        eyebrow="Sponsor"
        title="打赏赞助"
        actions={
          <>
            <a className="button button-primary" href="#support-placeholder">
              <Gift size={18} />
              查看占位入口
            </a>
            <a className="button button-secondary" href="./docs.html">
              <FileText size={18} />
              返回文档
            </a>
          </>
        }
      >
        谢谢你愿意支持 Multi-Agent Engine。这里先放置占位赞助页，不包含真实收款信息；上线前可以替换成微信、支付宝、爱发电或 GitHub Sponsors。
      </PageHero>

      <section className="content-section page-section split-section" aria-labelledby="support-title">
        <div className="section-heading">
          <p className="eyebrow">Why support</p>
          <h2 id="support-title">你的支持会用在哪里</h2>
          <p>项目仍在快速打磨，本地模型、地图生成、安装交付和可观测性都需要持续测试。赞助入口上线前，这里只展示用途说明。</p>
        </div>
        <div className="stack-panel">
          {[
            ["本地模型适配", "继续优化 Ollama、视觉模型和 MobileSAM 的一键配置体验。"],
            ["桌面安装交付", "完善 Mac/Windows 安装包、smoke 测试和用户手册。"],
            ["Agent 行为调试", "让 decision events、运行监控和叙事链路更好解释。"]
          ].map(([name, detail]) => (
            <div className="stack-row" key={name}>
              <span className="stack-icon">
                <Sparkles size={18} />
              </span>
              <span>
                <strong>{name}</strong>
                <small>{detail}</small>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section id="support-placeholder" className="content-section page-section" aria-labelledby="placeholder-title">
        <div className="sponsor-panel">
          <div>
            <p className="eyebrow">Placeholder</p>
            <h2 id="placeholder-title">赞助入口占位</h2>
            <p>这里未来可以放二维码、赞助平台链接或企业支持方式。当前版本不会引导真实付款，避免测试阶段误操作。</p>
            <div className="hero-actions">
              <a className="button button-secondary" href="./official.html">
                <Home size={18} />
                返回首页
              </a>
              <a className="button button-secondary" href="./download.html">
                <Coffee size={18} />
                回到下载页
              </a>
            </div>
          </div>
          <div className="qr-placeholder" aria-label="赞助二维码占位">
            <HeartHandshake size={52} />
            <strong>二维码占位</strong>
            <small>上线前替换真实赞助码</small>
          </div>
        </div>
      </section>
    </SiteChrome>
  );
}

ReactDOM.createRoot(document.getElementById("sponsor-root")!).render(
  <React.StrictMode>
    <SponsorPage />
  </React.StrictMode>
);
