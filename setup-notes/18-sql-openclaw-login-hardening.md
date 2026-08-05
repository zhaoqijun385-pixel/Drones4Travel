# 18：SQL 对话持久化、OpenClaw 客服与登录加固

## 已完成

- 先将此前机群导航基线提交为 `53a5ea8`，后续改动与该基线分开。
- 增加 `openclaw_conversation` 和 `openclaw_message` 两张 PostgreSQL 表，均通过网站用户 UUID 隔离；消息使用 `external_id` 幂等，避免网关历史重放造成重复记录。
- 增加 `server/migrations/003_openclaw_conversations.sql`，可在前两份迁移后重复执行；`generate_ddl.py` 已同步纳入新模型。
- 增加认证 API：列出/创建对话、列出消息、追加消息。OpenClaw 网关仍负责实时协议，PostgreSQL 负责网站侧历史索引和文本副本。
- `/api/health` 现在会执行 `SELECT 1`，数据库不可用时返回 503，而不是误报服务健康。
- 注册密码后端和登录表单统一要求至少 8 个字符；登录、注册、忘记密码增加网络故障和常见错误提示。
- `/chat`、`/customer-service`、`/settings` 增加登录守卫；登录后会返回原目标页面。
- OpenClaw 仅在有登录用户时连接；客服页增加历史对话列表、会话切换，收发内容会后台幂等同步到数据库。

## 验证

- `client/npm run test:fleet`：10 项通过。
- `client/npm run build`：通过；仅保留既有 Cesium/Google Maps 分包警告。
- 项目 Python 环境下后端 unittest：5 项通过。
- 使用模型生成 DDL 检查新表与迁移结构一致；未启动真实 OpenClaw 对话，避免产生模型调用费用。

## 启动顺序

```bash
psql -h 127.0.0.1 -p 5433 -U $USER -d drone_navigation \
  -v ON_ERROR_STOP=1 -f server/migrations/003_openclaw_conversations.sql
curl http://localhost:8000/api/health
```

登录网站后进入 `Community -> Customer Service`；网关离线时页面保留登录和历史索引状态，不会自动发送测试消息。
