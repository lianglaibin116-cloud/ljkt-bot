# LJKT Bot 桌面架构

本地桌面端按 [OpenMausBot](https://github.com/milind-soni/OpenMausBot) 的分层方式组织：独立构建的 React 界面、Electron 主进程、受主进程管理的本机服务、平台安装包。这里借鉴架构，不复制 OpenMausBot 源码或其智能体功能。

```mermaid
flowchart LR
  A[Windows/macOS 安装程序] --> B[Electron 主进程]
  B --> C[Vite React Bot 界面]
  B --> D[独立本机服务进程]
  C --> D
  D --> E[聊天 API 与任务数据]
  D --> F[课程生成、编辑、播放]
  F --> G[@ljkt 工作区包]
```

## 边界

- `desktop/main.cjs` 只管理窗口、系统菜单、下载和本机服务生命周期；窗口使用 `contextIsolation` 与沙箱。
- `desktop/renderer/` 是 Vite 构建入口，复用 Bot 聊天组件，构建结果放在 `public/desktop/`。桌面窗口只打开 `/desktop/index.html`。
- `desktop/service.cjs` 启动 Bot 自带的 Next 课程服务。聊天 API、模型设置、附件解析、课程生成和课件编辑仍在这一本机服务内运行。课件工作区按同源路由加载，避免把网页首页当作 Bot 的主界面。
- `desktop/installer.yml` 定义 Windows NSIS 安装程序。先由 `@electron/packager` 打包含本机课程服务的便携目录，再由 `electron-builder --prepackaged` 制作安装程序；两种发布物使用同一套应用文件。
- `@ljkt/*` 是 Bot 仓库内工作区包名。上游开源许可、版权和来源链接保持原样；存量课件与浏览器数据的持久化格式标识保持兼容。

## 构建顺序

1. `pnpm build:packages` 构建 Bot 自有工作区包。
2. `pnpm bot:desktop:build` 先构建 Vite 界面，再构建 Next 课程服务，并将静态资源及运行依赖复制到 `desktop/build/`。
3. `pnpm bot:desktop:package` 生成当前平台的应用目录。
4. 在 Windows 上运行 `pnpm bot:desktop:installer`，生成 `desktop/release/installers/*.exe`。

Windows 和 macOS 构建要分别在对应系统上执行。Windows 安装包未签名；安装与启动需在 Windows 设备上完成最终验证。
