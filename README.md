# 灵境课堂 Bot 0.2.0

已构建可在本机双击运行的独立 macOS ARM64 测试应用。界面采用左侧历史、居中聊天、右侧课件工作区的形式，保留幻彩书页 Logo。

## 直接试用

打开 `desktop/release/灵境课堂 Bot-darwin-arm64/灵境课堂 Bot.app`。

首次在左下角“模型与设置”单独配置文本模型，再输入备课要求。需要配音、图片或视频时，按原有功能分别配置对应服务。原系统的密钥和课程不会自动迁移；已有课程可用原有导出／导入方式带入。

可以聊天讨论知识、上传教学材料、准备课程制作任务、关联已保存课件、进入专业编辑、教师计划、学生笔记及导出。制作卡点击后仍使用完整大纲审阅流程，不把准备任务当成已完成课件。两种HTML导出、离线画笔和全部原有工作台入口保留。

## 开发与重新构建

```bash
cd /Users/sy/ljkt-bot
pnpm bot:desktop:build
pnpm bot:desktop
pnpm bot:desktop:package
```

网页预览用 `pnpm bot:dev`，访问 `http://localhost:3010/bot`。桌面应用使用自己的30310端口、浏览器存储及 `~/Library/Application Support/LingjingClassroomBot/` 数据目录，与原项目相互独立。关闭窗口隐藏应用；菜单“退出”结束服务。

## 文档与核对

- [项目说明](./LJKT-BOT-项目说明.md)
- [首次试用说明](./docs/首次试用.md)
- [功能保留清单](./docs/功能保留清单.md)
- [本次构建与验证](./docs/本次构建与验证.md)
- [源文件复制基线](./docs/source-baseline/copy-manifest.json)

本版完成macOS本机运行、聊天持久化、课件工作区、独立服务和应用打包。未宣称已完成正式发行签名、公证、自动升级、Windows安装包或系统重启后的任务守护。视频渲染仍遵循原功能的可选render-service条件。

本项目保留OpenMAIC及各组件的原始许可和版权声明；未修改 `/Users/sy/OpenMAIC` 的源码。
