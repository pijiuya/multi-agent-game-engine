import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Renderer recovered from an error", error, info);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }
    return (
      <main className="desktop-workspace tone-light recovery-visible">
        <section className="renderer-recovery-panel" role="alert">
          <strong>界面正在恢复</strong>
          <p>工作台界面遇到渲染错误，但窗口仍保持可见。可以重新加载界面继续。</p>
          <small>{this.state.error.message}</small>
          <button type="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </section>
      </main>
    );
  }
}
