# 灵境课堂 Bot 0.2.3

提供 macOS ARM64 与 Windows x64 桌面应用。桌面端采用独立构建的 React 界面、本机课程服务和 Electron 窗口；界面保留左侧历史、居中聊天、右侧课件工作区与幻彩书页 Logo。

0.2.3 对齐 OpenMAIC 官方最新稳定版 v1.4.2 的共享包：生成包 0.3.31、渲染包 0.2.1；其他共享包延续 v1.4.1 的相同版本。Bot 独立对话、工作区和本机课程数据保持独立。本版加入跨页面的课程撤销/重做；资产清理保留期不得低于 45 分钟。Windows 安装包由 GitHub Actions 在 Windows 构建机上生成。

## 直接试用

macOS 本机包：`desktop/release/灵境课堂 Bot-darwin-arm64/灵境课堂 Bot.app`。

Windows x64 安装包：在 GitHub 仓库的 **Actions → Windows desktop package** 下载 `LingjingBot-Windows-x64-Installer`，运行其中的 `LingjingBot-*-Windows-x64-Setup.exe`。安装向导可选择目录，并创建桌面与开始菜单快捷方式。另有 `LingjingClassroomBot-Windows-x64` 便携包可供排查。Windows 包由 Windows 构建机生成，以包含匹配平台的原生依赖。

首次在左下角“模型与设置”单独配置文本模型，再输入备课要求。需要配音、图片或视频时，按原有功能分别配置对应服务。原系统的密钥和课程不会自动迁移；已有课程可用原有导出／导入方式带入。

可以聊天讨论知识、上传教学材料、准备课程制作任务、关联已保存课件、进入专业编辑、教师计划、学生笔记及导出。制作卡点击后仍使用完整大纲审阅流程，不把准备任务当成已完成课件。两种HTML导出、离线画笔和全部原有工作台入口保留。

## 开发与重新构建

```bash
cd /Users/sy/ljkt-bot
pnpm bot:desktop:build
pnpm bot:desktop
pnpm bot:desktop:package
pnpm bot:desktop:installer # 仅在 Windows 上运行
```

网页预览用 `pnpm bot:dev`，访问 `http://localhost:3010/bot`。桌面应用使用自己的30310端口和浏览器存储；macOS 数据位于 `~/Library/Application Support/LingjingClassroomBot/`，Windows 数据位于 `%APPDATA%\LingjingClassroomBot\`，与原项目相互独立。关闭窗口隐藏应用；菜单“退出”结束服务。

## 文档与核对

- [项目说明](./LJKT-BOT-项目说明.md)
- [首次试用说明](./docs/首次试用.md)
- [功能保留清单](./docs/功能保留清单.md)
- [本次构建与验证](./docs/本次构建与验证.md)
- [源文件复制基线](./docs/source-baseline/copy-manifest.json)

Windows 安装包尚未签名，也没有自动升级。macOS 签名与公证仍待接入。本版不提供系统重启后的任务守护。视频渲染仍遵循原功能的可选 render-service 条件。

本项目保留上游 OpenMAIC 及各组件的原始许可、版权和来源链接；未修改原项目源码。`@ljkt/*` 是本仓库内部包名，不代表上游软件的著作权变更。
