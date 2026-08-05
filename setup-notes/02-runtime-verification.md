# 02：运行时检查

## 已验证

| 检查项 | 结果 |
| --- | --- |
| 项目专用 PostgreSQL | 5433 可连接；4 张项目表存在 |
| 现有 Python 环境 | `fastapi`、`uvicorn`、`asyncpg`、`cflib`、`opencv-python`、`aiortc`、`av`、`aiohttp`、`websockets` 均可导入 |
| 既有 FastAPI | `http://127.0.0.1:8000/api/health` 返回 `{"status":"ok"}` |
| 既有 MediaMTX 控制 API | `http://127.0.0.1:9997/v3/paths/list` 可达，当前没有路径 |

## 未更改的现有状态

- 本轮首次检查时，目标项目的 Vite 服务正在 5173 运行；后续检查时它已不在监听。没有发送停止信号，也没有改动其目录。
- 8000 的服务工作目录不属于本次目标项目；未尝试停止、重配或替换它。

## 注意

Python 导入 `cv2` 与 `av` 时 macOS 报告两份 `libavdevice` 的 Objective-C 类重复。这是当前环境已有包组合的警告，导入仍成功。本次没有删除或替换任何包；首次实际摄像头推流前应留意是否出现视频采集异常。
