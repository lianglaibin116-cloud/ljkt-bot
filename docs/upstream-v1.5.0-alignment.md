# OpenMAIC v1.5.0 对齐记录

日期：2026-11-25。基准为官方稳定版 [OpenMAIC v1.5.0](https://github.com/THU-MAIC/OpenMAIC/releases/tag/v1.5.0)，上游提交 `98a57ebedc3e311e669de17366adb1c20129b7cc`。Bot 起点为 `v0.2.3`，其共享包此前对齐 v1.4.2；本次发布目标为 Bot `v0.2.5`。

## 版本对照

| 组件 | v0.2.3 | v0.2.4 | v0.2.5 | v1.5.0 |
|---|---:|---:|---:|---:|
| OpenMAIC 基准 | v1.4.2 | v1.5.0（共享核心） | v1.5.0（功能适配） | v1.5.0 |
| `@ljkt/dsl` | 0.13.0 | 0.13.0 | 0.13.0 | 0.13.0 |
| `@ljkt/editor` | 0.0.12 | 0.0.13 | 0.0.13 | 0.0.13 |
| `@ljkt/generation` | 0.3.31 | 0.3.33 | 0.3.33 | 0.3.33 |
| `@ljkt/geometry` | 0.1.0 | 0.1.0 | 0.1.0 | 0.1.0 |
| `@ljkt/importer` | 0.3.1 | 0.3.1 | 0.3.1 | 0.3.1 |
| `@ljkt/renderer` | 0.2.1 | 0.2.4 | 0.2.4 | 0.2.4 |
| `@ljkt/storage` | 0.39.3 | 0.39.3 | 0.39.3 | 0.39.4 |
| Pi agent packages | 0.78.0 | 0.78.0 | 0.78.0 | 0.80.3 |

## 已迁移与 Bot 适配

- **共享核心（v0.2.4）**：编辑器选择、拖拽/缩放/旋转控制、文本工具栏定位与快捷键修正；新版大纲字段和交互内容提示词；文本、公式、图像和 Spotlight 几何修正及可选字体别名样式表。保留 Bot 本地 C++ 安全提示、`interactive-visual-reliability` 定制片段和独立课堂入口。
- **课堂按钮和缩放（v0.2.5）**：课程结束按钮进入现有课堂总结页；交互课件自动适配可视高度，并在还有内容时显示提示。
- **服务设置（v0.2.5）**：增加 DeepSeek ASR/TTS、DeepSeek OCR 和 MiniCPM OCR 配置与调用；Token Plan 可配置 ASR、文档解析和 DeepSeek 相关能力；OCR 设置包含自定义 Endpoint。
- **移动课堂（v0.2.5）**：增加目录、课件、课堂对话、Bot 四个底部入口；保留桌面导航和已有设置偏好。
- **Bot 对话上下文（v0.2.5）**：旧消息超出本轮预算时，最多附带 450 token 的历史摘录。摘要仅用于模型请求，不写入线程存储；完整聊天记录、Bot 任务、工作区、本机课程库和 Electron `userData` 路径均保持独立。

## 仍需适配

- `@ljkt/storage` 暂为 0.39.3，Pi agent 包暂为 0.78.0。上游 0.39.4 数据库迁移增加 agent session 的 `open_question_seq` 并回填旧事件。启用新 runtime 前需验证 Bot 数据库备份/恢复、存量会话迁移和本机任务兼容性。
- Bot `/api/bot/chat` 使用独立流式聊天和任务卡协议；Pi 0.80.3 持久会话、事件状态同步及 runtime 压缩尚未接入。当前实现只对请求上下文做短摘录，不改变本机保存的对话。
- WebFetch provider/Token Plan 能力与 MinerU 长文档章节提取尚未接入 Bot 的独立聊天和本机资料解析流程。
- 上游全新首页和移动工作台与 Bot 的入口及工作区模型不同，暂不迁入；Bot 保留原有首页、独立对话和课件工作区。

## 数据与构建边界

- macOS Bot 用户数据位于 `~/Library/Application Support/LingjingClassroomBot/`；Windows 位于 `%APPDATA%\LingjingClassroomBot\`。桌面更新只替换 Bot `.app` bundle，不迁移或删除此目录。
- `public/openmaic-share-logo.png` 与根目录 `灵境课堂炫彩循环徽标.png` 是本地未跟踪资产，发布时保留为工作区文件，不纳入版本提交。
- `/Users/sy/OpenMAIC` 是本机灵境课堂项目，本次迁移不对其进行修改。
