# 灵境课堂 Bot 桌面端

桌面主进程负责独立窗口、本机服务、下载保存、菜单和进程退出。桌面聊天界面由 Vite 单独构建，位于 `/desktop/index.html`；课件生成和编辑由本机课程服务提供，并在同一窗口的工作区打开。保持原有专业编辑、讲稿配音、互动、课程资料和导出功能。

```bash
cd /Users/sy/ljkt-bot
pnpm bot:desktop:build
pnpm bot:desktop
pnpm bot:desktop:package
pnpm bot:desktop:installer # Windows 安装包，仅在 Windows 上运行
```

开发模式：`pnpm bot:desktop:dev`；网页预览：`pnpm bot:dev` 后打开 `http://localhost:3010/bot`。桌面服务固定使用独立的 `http://127.0.0.1:30310`，不连接原3000端口，不附着已有未知服务。端口冲突会明确报错。

macOS数据位于 `~/Library/Application Support/LingjingClassroomBot/`，包含独立浏览器存储、课程与媒体、对话和日志。模型配置在新应用的设置内单独完成。原课件可通过原有导出／导入流程迁移，不自动读取原浏览器配置和密钥。不要随意改变桌面服务端口，因为浏览器课程存储随来源隔离。

Windows x64 数据位于 `%APPDATA%\LingjingClassroomBot\`，目录内容相同。Windows 构建在 GitHub Actions 的 Windows runner 上执行。下载 `LingjingBot-Windows-x64-Installer` 后运行安装程序，桌面和开始菜单会提供入口；便携包仍单独提供。应用包使用灵境课堂 Logo 图标；运行环境和原生依赖由 Windows runner 原生构建。

关闭窗口会隐藏应用，正在进行的操作继续；从菜单“退出”会结束Bot服务。当前流式聊天支持停止；程序完全退出后，未完成的模型回复显示中断。完整课程制作仍按原有生成与恢复流程执行。本版未提供操作系统重启后持续运行的任务守护服务。

本机打包生成当前系统、当前 CPU 架构的应用，不能从 macOS 交叉生成可运行的 Windows 包。Windows 安装程序使用 NSIS；尚未接入代码签名和自动升级。正式对外发行的 macOS 签名、公证和自动更新也待接入。
