# 多机实时房间与控制权租约

日期：2026-08-05

## 本阶段完成

- 新增浏览器协作 WebSocket：`/api/fleet/ws`。
- 新增 DroneSession 发布/命令双向 WebSocket：`/api/fleet/publish`。
- 浏览器连接使用网站 JWT 身份；发布端继续使用 `drone.telemetry_token`。
- 支持房间快照、增量状态、上下线、共享目标点、控制权申请/续约/释放和租约保护命令。
- 控制权默认租期 5 秒，前端每 2 秒续约；客户端断线或租约到期会自动释放。
- 服务端按 `sequence` 拒绝重复和乱序状态；2 秒无状态变弱连接，5 秒标记离线。
- 真实命令继续经过既有白名单和数值限制；没有租约、没有 DroneSession 或命令不合法时不会转发。

## 前端

- 机群状态增加 `off / demo / live` 三态。
- 多机面板可以在“演示模式”和“实时房间”之间切换。
- 实时房间支持快照恢复、指数退避重连、延迟显示和 120 ms 短缓冲插值。
- 增加控制权申请/释放按钮；OpenClaw 快捷指令在实时模式下必须先取得租约。
- 左上态势小窗在同一地图实例中增量显示全机群点位和共享目标，点击点位可切换选中机。
- OpenClaw 每次人工发言前自动附带最新只读机群上下文；检测到飞行动作仍要求租约和二次确认。
- 在线无人机三维间距小于 3 米时显示 HUD 警告。
- 原有本地 20 架演示和默认单机路径保留。

## Bridge

- `telemetry_relay.py` 设置 `FLEET_DRONE_ID` 后，会向实时房间发布当前无人机并接收租约校验后的命令。
- `multi_bridge.py` 根据 YAML 为每架无人机启动独立 motion bridge 和 fleet relay。
- `drones.example.yaml` 默认全部禁用，防止误连真机；复制为 `drones.yaml` 并逐架确认 URI 后再启用。
- `fleet_simulator.py` 支持 1、5、20、50 架和可调遥测频率，用于浏览器与服务端负载测试。

## 安全启动顺序

1. 运行 `python multi_bridge.py --config drones.yaml --check`，只检查配置，不连接 Radio。
2. 第一轮保持 `CF_NO_FLY=1`，只验证上线、遥测、租约冲突和命令拒绝。
3. 两架真机先做无桨或安全架测试。
4. 只有租约断线释放、急停和单机回归都通过后，才进行低高度多机测试。

## 验证

- `server/tests/test_fleet.py` 覆盖租约冲突、续约、释放、断线清理和乱序状态拒绝。
- `server/tests/test_fleet_ws.py` 使用真实 FastAPI WebSocket 路由覆盖房间快照、双客户端租约冲突和命令转发。
- `python -m unittest tests.test_fleet tests.test_fleet_ws -v` 共 4 项通过。
- `multi_bridge.py --check` 通过，未启动任何 Radio 或子进程。
- 前端 `npm run build` 通过。

## 尚未完成

- 浏览器 JWT 当前通过 WebSocket 查询参数传递；生产部署应增加短时 fleet ticket，避免长期 JWT 出现在访问日志。
- 真实多机视频仍需要为每架 AI-Deck 建立独立 MediaMTX 发布进程和 stream 配置。
- 还需要启动独立 FastAPI 进程、两个真实浏览器和 simulator 做跨进程负载与断网恢复测试。
- 审计日志、动态渲染距离和 Google Advanced Marker 迁移仍待下一阶段。
