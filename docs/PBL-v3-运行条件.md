# PBL v3 运行条件与当前状态

## 当前状态

`ljkt-bot` 目前只包含 PBL v2；PBL v3 不是一个可单独安装的前端页面或编译器。上游把它实现为完整的项目学习运行时，包含学员项目空间、里程碑与学习状态、AI 导师工作流、沙箱命令/文件访问、预览与持久检查点。

本机环境检查结果：

- Docker CLI 已安装，但 Docker daemon 当前不可用。
- 仓库当前的 `.env.local` 未配置 `DATABASE_URL`、`OPENMAIC_AGENT_RUNTIME_ENABLED`、`E2B_API_KEY` 或沙箱提供方；本检查只覆盖该本地环境文件。
- 仓库没有 PBL v3、共享沙箱或沙箱预览网关实现。
- `@electric-sql/pglite` 目前只是开发依赖，不能提供上游需要的跨会话项目状态、隔离执行和持久检查点。

因此当前版本不展示或启用 PBL v3 入口，也不会把“本机 C++ 编译器”当成 PBL v3 的替代品。

## 要启用前必须补齐

1. 选择并部署受支持的隔离沙箱提供方，配置凭证、运行模板、资源配额、网络策略和生命周期清理。
2. 配置 PostgreSQL 持久化，以及项目文件/检查点所需的持久对象存储。
3. 迁移 Agent Runtime、项目工作流、预览网关、课程 UI 和用户状态；为 Bot 的本机用户身份、数据目录、导入/备份和桌面安全边界做适配。
4. 完成真实环境验证：创建项目、运行/停止代码、保存并恢复检查点、重启后恢复项目、预览隔离、删除与超时清理。

上游说明：

- [OpenMAIC v1.4.2 发布说明](https://github.com/THU-MAIC/OpenMAIC/releases/tag/v1.4.2)
- [PBL v3 架构与运行时说明](https://github.com/THU-MAIC/OpenMAIC/blob/main/lib/pbl/v3/README.md)
- [共享沙箱说明](https://github.com/THU-MAIC/OpenMAIC/blob/main/lib/server/sandbox/README.md)

当前开发环境没有可运行的沙箱后端和已配置的持久化服务；PBL v3 保持未启用，直到选定服务提供方、接入后端并完成上述运行验证。
