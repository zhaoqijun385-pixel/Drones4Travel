# 19：注册页后端恢复

## 故障现象

注册页提示：

> The server is unavailable. Check that the API is running and try again.

## 根因

FastAPI 启动时尝试以运行账号 `drone_api` 自动创建 OpenClaw 对话表。该账号没有既有
`user` 表的外键引用权限，因此 PostgreSQL 返回 `permission denied for table user`，
FastAPI 随即退出，前端无法连接 `127.0.0.1:8000`。

## 恢复操作

先由数据库所有者执行项目已有的第 3 份迁移：

```bash
/opt/homebrew/opt/postgresql@14/bin/psql \
  -h 127.0.0.1 -p 5433 -U quentincrane -d drone_navigation \
  -v ON_ERROR_STOP=1 \
  -f server/migrations/003_openclaw_conversations.sql
```

再恢复 FastAPI 的 screen 会话：

```bash
RUNTIME=/Users/quentincrane/.local/share/drone-navigation-setup-20260804
PYTHON=/Users/quentincrane/.local/share/drone-navigation-local/conda-envs/drone-navigation/bin/python

/usr/bin/screen -dmS drone_navigation_backend /bin/zsh -lc \
  "cd '/Users/quentincrane/Documents/drone-navigation/server' && \
   exec '$PYTHON' -m uvicorn app.main:app \
   --host 127.0.0.1 --port 8000 >> '$RUNTIME/backend-8000.log' 2>&1"
```

## 验证结果

- `GET http://127.0.0.1:8000/api/health` 返回 `{"status":"ok","database":"ok"}`。
- 向注册接口发送不完整 JSON 返回 HTTP 422 和字段校验信息，证明接口可达；未创建测试账号。
- FastAPI 正在 `127.0.0.1:8000` 监听。
- CORS 同时允许 `http://localhost:5173` 和 `http://127.0.0.1:5173`，两种本机打开方式均可调用注册接口。
