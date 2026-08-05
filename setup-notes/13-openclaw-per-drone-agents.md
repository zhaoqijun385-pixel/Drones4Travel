# 每架无人机独立 OpenClaw Agent

日期：2026-08-05

## 已完成

- 新增受网站 JWT 保护的 Agent 管理 API。
- 新建无人机后，登录用户会触发独立 OpenClaw Agent 创建；未登录时明确标记为 `login_required`。
- Agent 工作区与状态目录按网站用户和 `droneId` 隔离，统一放在：
  `/Users/quentincrane/.local/share/drone-navigation-agents/`
- 浏览器不会获得 OpenClaw CLI、配置路径或管理员能力。
- 一条 OpenClaw Gateway 连接可在不同无人机的 `agentId/sessionKey` 之间切换。
- 聊天历史按 session 缓存，切换无人机不会把不同 Agent 的消息混在一起。
- Agent 只接收当前机群的只读态势上下文；飞行动作仍必须经过用户确认、控制权租约、服务端命令白名单和 DroneSession。

## 删除策略

- 从机群托盘删除无人机时，默认只归档 Agent 映射并保留工作区和历史。
- 后端提供显式 `permanent=true` 永久删除能力，但前端普通删除不会调用它。
- 恢复同一无人机时复用原 Agent，不重复创建。

## 配置

以下环境变量均可覆盖默认本地路径：

- `DRONE_AGENT_ROOT`
- `OPENCLAW_BIN`
- `OPENCLAW_CONFIG_PATH`
- `OPENCLAW_STATE_DIR`

OpenClaw Gateway 继续要求仅回环监听。不得因为 Agent API 而将当前 device-auth 兼容设置暴露到局域网或公网。

## 验证

- 已确认本机 OpenClaw `2026.7.1-2` 提供 `agents add/delete` 隔离 Agent 命令。
- 新增单元测试覆盖创建、归档、恢复和永久删除；使用模拟 CLI，不产生模型调用。
- `cd server && <project-python> -m unittest tests.test_fleet tests.test_fleet_ws tests.test_openclaw_agents -v`：5 项通过。
- `npm run build`：通过。
- 没有启动 Gateway，也没有发送聊天消息，因此没有产生模型调用费用。
