# 01：PostgreSQL 与本地后端

## 已完成

- 安装了 README 指定的 PostgreSQL 14。
- 创建了专用集群：`/Users/quentincrane/.local/share/drone-navigation-setup-20260804/postgres`，并已在 `127.0.0.1:5433` 完成迁移验证。
- 已执行 `server/migrations/001_init_auth_schema.sql` 与 `002_matrix_account.sql`，验证得到 4 张项目表。
- 新建 Git 忽略的 `server/config.json`：数据库指向独立集群，JWT 密钥已随机生成；SMTP 与 Google OAuth 默认为禁用，符合没有外部账户凭据的本地开发场景。

## README 修正

新创建的 macOS PostgreSQL 集群默认只有 `postgres` 数据库；README 的第一条迁移命令缺少 `-d postgres`，会错误尝试连接不存在的用户同名数据库。实际使用的安全入口为：

```bash
/opt/homebrew/opt/postgresql@14/bin/psql -h 127.0.0.1 -p 5433 -U quentincrane -d postgres \
  -v ON_ERROR_STOP=1 -v app_password='local-dev-drone-api' \
  -f server/migrations/001_init_auth_schema.sql
```

## 验证

```bash
/opt/homebrew/opt/postgresql@14/bin/psql -h 127.0.0.1 -p 5433 -U quentincrane -d drone_navigation -c "\\dt"
```

## 后端端口保留

未启动本项目后端：README 指定的 8000 已被另一份本地副本占用。待该端口由原任务释放后，在 `server/` 下使用现有的 `drone-navigation` Conda 环境执行：

```bash
uvicorn app.main:app --reload --port 8000
```

## 重新启动数据库

最终校验时 PostgreSQL 守护进程已不在运行，但数据目录和已迁移的数据均保留。使用以下命令在需要本项目后端前启动：

```bash
/opt/homebrew/opt/postgresql@14/bin/pg_ctl \
  -D /Users/quentincrane/.local/share/drone-navigation-setup-20260804/postgres \
  -l /Users/quentincrane/.local/share/drone-navigation-setup-20260804/postgres.log \
  -o "-p 5433 -k /Users/quentincrane/.local/share/drone-navigation-setup-20260804/postgres" start
```

该命令已于本次后续检查中再次执行；当前数据库正在 5433 运行，4 张项目表可访问。本项目后端也已用临时 8001 端口通过健康检查后停止。

## 清理

先执行：

```bash
/opt/homebrew/opt/postgresql@14/bin/pg_ctl -D /Users/quentincrane/.local/share/drone-navigation-setup-20260804/postgres stop
```

然后删除该数据目录和 `server/config.json`。不要删除用户原有的 `client/config.json`。
