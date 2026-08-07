# 进度存档 · 2026-08-07 续接（任务二）

> 在 08-06 暂停点上续跑。主目标：Tasks.pdf **任务二** 干跑闭环可用。

## 入口

- API（Windows/WSL 均可）：http://127.0.0.1:8000  
- 前端（目前 **仅 WSL 内** 可达）：http://127.0.0.1:5173/survey-mission  
  - Windows 侧 `:5173` 因 WSL localhostForwarding 异常打不开；`:8000` 正常  
  - 打开 UI：在 WSL 里用浏览器，或修好 `.wslconfig` 的 `localhostForwarding=true` 后 `wsl --shutdown` 再开

## 本轮已恢复 / 验证

| 项 | 结果 |
|----|------|
| `ensure_survey_wired.py` | DONE（API/页面/Cesium/i18n/vite proxy） |
| 用户 PG `~/pgdata` **:5433** | 已 `pg_ctl start`；`config.json` → `...@127.0.0.1:5433/bjy` |
| FastAPI | `health=200`，`/api/survey/places=200` |
| Vite | WSL 内 `5173=200` |
| **任务二干跑** | `plan→create→start→completed`，5 张占位图 + 18 条指令 |
| 遥测 | 每 shot `telemetry_tail` 含 depart/hover/photo |
| 暂停/恢复/取消 | `paused` → `running` → `cancelled` OK |
| 任意地名 | Eiffel / 东京塔 / Times Square OK（经 Clash `:7892`）；`静安寺` 曾 422 |

## 烟测命令

```bash
# 起库 + API（勿对脚本名 pkill -f vite）
bash /tmp/start_pg5433_api.sh   # 或 旅游观测Tasks/_start_pg5433_api.sh
# 前端
cd ~/drone-navigation/client && npm run dev -- --host 0.0.0.0 --port 5173
# 任务二 API 烟测
python3 /mnt/h/cursor使用/旅游观测Tasks/_smoke_task2.py
```

## 任务二对照（相对 Tasks.pdf）

| 要求 | 状态 |
|------|------|
| 调查任务状态机 | ready/running/paused/completed/cancelled/failed |
| 起飞/移动/悬停/拍照/返航 | commands 日志 + dry-run 执行器 |
| 位姿时间 | telemetry_tail |
| 照片关联任务 | `/api/survey/missions/{id}/photos/{shot}` |
| 暂停/取消/重试 | API 已通 |
| 多机 | `drone_count≥2` 并行队列（此前已有） |
| 真机桥 | 未接（节点 9 另档） |

## 仍可选

1. 修好 Windows→Vite 本机端口（localhostForwarding / 管理员 portproxy / Windows 侧起 Vite）
2. 补常用中文别名（如 静安寺）或调高 geocode 超时
3. 真机替换 dry-run 拍照

## 相关

- 草稿：`H:\cursor使用\旅游观测Tasks\`
- 运行时：`~/drone-navigation/server/app/survey_mission.py` 等
- 节点 9 图传：`开题材料/11-图传进程快照-2026-08-06.md`（已停）
