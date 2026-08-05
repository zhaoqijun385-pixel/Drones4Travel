# 07：目标后端接管 8000

## 已完成

- 已确认先前占用 8000 的进程工作目录为 `/Users/quentincrane/.local/share/drone-navigation-local/repo/server`，不属于当前目标项目。
- 已停止该旧进程（未删除其任何文件）。
- 已从当前项目 `server/` 启动 FastAPI，监听 `127.0.0.1:8000`。
- 后端处于独立 screen 会话 `drone_navigation_backend`，日志写入 `/Users/quentincrane/.local/share/drone-navigation-setup-20260804/backend-8000.log`。

## 验证

- `GET /api/health` 返回 `{"status":"ok"}`。
- 来自 `http://localhost:5173` 的 CORS 预检通过。
- `GET /api/stream/config` 返回流目录。

## 停止或恢复

停止本项目后端：

```bash
/usr/bin/screen -S drone_navigation_backend -X quit
```

若要恢复旧副本，进入它自己的 `server/` 目录并按其原有方式重新运行 uvicorn；本次没有修改它的文件或配置。
