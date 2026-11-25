# OpenMAIC v1.5.0 对齐记录

日期：2026-11-25。基准为官方稳定版 [OpenMAIC v1.5.0](https://github.com/THU-MAIC/OpenMAIC/releases/tag/v1.5.0)，上游提交 `98a57ebedc3e311e669de17366adb1c20129b7cc`。Bot 起点为 `v0.2.3`，其共享包此前对齐 v1.4.2。

## 版本对照

| 组件 | v0.2.3 | v0.2.4 | v1.5.0 |
|---|---:|---:|---:|
| OpenMAIC 基准 | v1.4.2 | v1.5.0（兼容迁移） | v1.5.0 |
| `@ljkt/dsl` | 0.13.0 | 0.13.0 | 0.13.0 |
| `@ljkt/editor` | 0.0.12 | 0.0.13 | 0.0.13 |
| `@ljkt/generation` | 0.3.31 | 0.3.33 | 0.3.33 |
| `@ljkt/geometry` | 0.1.0 | 0.1.0 | 0.1.0 |
| `@ljkt/importer` | 0.3.1 | 0.3.1 | 0.3.1 |
| `@ljkt/renderer` | 0.2.1 | 0.2.4 | 0.2.4 |
| `@ljkt/storage` | 0.39.3 | 0.39.3 | 0.39.4 |
| Pi agent packages | 0.78.0 | 0.78.0 | 0.80.3 |

## 已迁移

- 编辑器共享核心：选择、拖拽/缩放/旋转控制、文本工具栏定位与快捷键修正。
- 生成共享核心：新版大纲字段和交互内容提示词；保留 Bot 本地 C++ 安全提示和 `interactive-visual-reliability` 定制片段。
- 渲染共享核心：文本、公式、图像和 Spotlight 几何修正，及可选字体别名样式表。
- Bot 现有课堂入口接入共享渲染器，默认启用，可用既有环境变量明确关闭。工作台开关读取上游新变量，并兼容旧名称。
- Bot 应用版本升为 0.2.4。Bot 对话、工作区、Electron bundle ID / userData 路径、本机课程库均保持独立。

## 仍需适配

- Storage 0.39.4 增加 agent session 的 `open_question_seq` 列并回填历史事件。该迁移会触碰持久化数据库；Bot 当前默认禁用 durable agent runtime，因此本次留在 0.39.3。若要启用该 runtime，需先完成 session store、事件更新和运行时一致性适配，并制定数据库备份/恢复升级流程。
- Pi agent 包仍为 0.78.0；上游 0.80.3 的对话压缩和会话状态功能尚未接入 Bot 的独立 `/api/bot/chat` 和本机任务模型。
- 上游全新首页、移动工作台/课堂、Token Plan 设置、DeepSeek 语音识别/合成/OCR、MiniCPM OCR、MinerU 长文档章节提取等功能需要接入 Bot 的独立界面、provider 配置和本机任务流程，不能直接替换 Bot 工作区。
- 上游课堂结束卡与教室缩放提示属于 Bot 课堂界面层的后续适配项。

## 数据与构建边界

- macOS Bot 用户数据位于 `~/Library/Application Support/LingjingClassroomBot/`；Windows 位于 `%APPDATA%\LingjingClassroomBot\`。本次桌面更新只替换 Bot `.app` bundle，不迁移或删除此目录。
- 本仓库的 `public/openmaic-share-logo.png` 与根目录 `灵境课堂炫彩循环徽标.png` 是本地未跟踪资产，发布时保留为工作区文件，不纳入版本提交。
- `/Users/sy/OpenMAIC` 是本机灵境课堂项目，本次迁移不对其进行修改。
