# OpenMAIC v1.4.2 对齐记录

- 上游稳定版：`v1.4.2`，提交 `eb7c1bcccc3d083684c26ae1d5d187d41122cb10`。
- Bot 前一基线：共享包与 OpenMAIC `v1.4.1` 一致，另有 Bot 独立改动；本次 Bot 版本：`0.2.2`。
- 已迁移：`@ljkt/generation` 0.3.31（互动库地址版本回退、组件大纲附加要求与设计意图）、`@ljkt/renderer` 0.2.1（激光指针定位）；保留本地模拟 Canvas 防失控生成约束。
- 已适配：TUN 代理 fake-ip 地址在明确启用 `ALLOW_LOCAL_NETWORKS` 时可用于服务端配置的模型提供方，客户端传入的公网地址仍按严格策略；互动页原有 HTML 不会被空值、占位符或单独 DOCTYPE 覆盖。
- 保留：Bot 独立聊天、工作区、课程制作流程和独立数据目录。未对 `/Users/sy/OpenMAIC` 进行写入。
- 待单独适配：课程级撤销/时间线、PBL v3 Java 预览、VoxCPM 自动音色、模型思考配置 UI、Web 应用层激光指针 DOM 对齐。此类变更与 Bot 工作流差异较大，不直接复制 Web 页面。
- 上游发布说明：https://github.com/THU-MAIC/OpenMAIC/releases/tag/v1.4.2
