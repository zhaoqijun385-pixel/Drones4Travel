# 机群验收与真机安全交接

日期：2026-08-05

## 自动化验收

- `npm run test:fleet`：3 项通过。
  - 20 个停机位唯一，平面初始间距至少 6 米。
  - 分区巡检全过程保持至少 3 米间距并全部返航。
  - 交叉换位全过程保持至少 3 米间距并全部返航。
- `npm run build`：通过，Vite 转换 553 个模块。
- 后端机群、WebSocket 和 OpenClaw Agent 生命周期：5 项通过。
- `git diff --check`：最终交接前再次执行。

## 无连接安全检查

- `multi_bridge.py --config drones.example.yaml --check`：通过；示例中的真实无人机全部禁用，没有打开 Radio。
- `fleet_simulator.py --count 20 --hz 10 --scenario parked --check`：通过。
- `fleet_simulator.py --count 5 --hz 10 --scenario inspection --check`：通过。
- 5173 和 18789 均未留下监听。

## 真机使用前提

当前实现完成了软件链路，但没有把仿真结果冒充实体飞行结果。开始真机任务前必须满足：

1. 每架 Crazyflie 有可靠、经过校准的本地 x/y/z 定位来源，例如 Lighthouse、Loco 或适用的光流定位方案。
2. `drones.example.yaml` 复制为不提交版本的 `drones.yaml`，逐架确认 URI、Radio、端口和 stream ID。
3. 先运行 `multi_bridge.py --check`。
4. 第一轮保持 `CF_NO_FLY=1`，验证上线、Agent、控制权租约、断线释放和非法命令拒绝。
5. 单机无桨或安全架验证通过后，才进行单机约 0.3–0.5 米低空测试。
6. 急停、围栏、定位丢失和返航测试通过后，才进入两机测试。

## OpenClaw 边界

- 每机 Agent 创建、归档、恢复和 session 切换的软件链路已完成。
- 本次没有启动 OpenClaw Gateway，也没有发送模型消息，避免未授权模型消耗。
- Gateway 必须继续保持回环监听；当前浏览器 device-auth 兼容设置不得暴露到局域网或公网。
