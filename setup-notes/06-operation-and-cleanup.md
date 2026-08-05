# 06：当前启动状态与精确清理

## 当前可用状态

| 部分 | 状态 | 原因/下一步 |
| --- | --- | --- |
| PostgreSQL | 已迁移，运行于 5433 | 项目表和后端配置已就绪；本项目后端也已用 8001 临时健康检查通过 |
| 后端 | 已运行于 8000 | 当前项目 FastAPI 已接管 8000；健康检查、CORS 与流目录均已验证 |
| 前端 | 已运行于 5173 | 通过 Vite 直接启动，未触发可能重写 splash 播放列表的 `predev` 脚本 |
| Synapse | 已运行于 8008 | 公开注册关闭；Vite 的 `/_matrix` 代理已验证 |
| OpenClaw | 已运行于 18789 | 本地回环监听，前端 token 匹配，模型配置和安全审计已验证 |
| MediaMTX | 已运行于 8889/9997 | 已停止旧副本并由本项目专用配置接管；控制 API 已验证 |
| 真实无人机 | 未操作 | 需接入硬件并按 `05-crazyflie-and-camera.md` 的安全顺序执行 |

## 推荐恢复顺序

1. 后端已可直接使用；如需查看过程，见 `07-backend-handover.md`。
2. 运行 `simple_webcam.py` 并授权终端相机权限。
3. 使用两个网站账号完成聊天双向与刷新历史的冒烟测试。
4. 在 `Community -> Customer Service` 验证本地客服连接。

## 精确清理（不自动执行）

先停止本次启动的 PostgreSQL：

```bash
/opt/homebrew/opt/postgresql@14/bin/pg_ctl \
  -D /Users/quentincrane/.local/share/drone-navigation-setup-20260804/postgres stop
```

停止本次启动的 Synapse 与 Vite：

```bash
/usr/bin/screen -S drone_navigation_synapse -X quit
/usr/bin/screen -S drone_navigation_vite -X quit
/usr/bin/screen -S drone_navigation_backend -X quit
/usr/bin/screen -S drone_navigation_mediamtx -X quit
/usr/bin/screen -S drone_navigation_openclaw -X quit
```

确认没有使用本次目录的 Synapse、OpenClaw 或 MediaMTX 进程后，删除以下**唯一**目录：

```text
/Users/quentincrane/.local/share/drone-navigation-setup-20260804
```

如不再需要本项目的本地后端配置，再删除 `server/config.json`；如不再需要操作记录，再删除 `setup-notes/`。这两项都位于项目目录，不应影响 `client/config.json` 或你原有的三处 Git 改动。

最后，只有确认其他项目也不再需要 PostgreSQL 14 时，才清理 Homebrew 公式及它自动生成、但未被本项目使用的默认数据目录 `/opt/homebrew/var/postgresql@14`。
