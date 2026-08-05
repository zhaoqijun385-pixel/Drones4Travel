# 本次配置清单（2026-08-04）

## 保护范围

- 未覆盖已有 `client/config.json`、`client/node_modules/`、任何既有 Git 改动或正在运行的进程。
- 未删除文件。
- 已发现的既有 Git 改动：`client/README.md`、`client/config.example.json`（删除）、`client/public/splash/playlist.json`。

## 本次新增内容

| 项目 | 位置 | 清理方式（仅在停止后执行） |
| --- | --- | --- |
| 独立 PostgreSQL 集群 | `/Users/quentincrane/.local/share/drone-navigation-setup-20260804/postgres` | 停止集群后删除整个 `drone-navigation-setup-20260804` 目录 |
| PostgreSQL 日志 | `/Users/quentincrane/.local/share/drone-navigation-setup-20260804/postgres.log` | 随上目录一并删除 |
| Synapse 尝试安装 | `/Users/quentincrane/.local/share/drone-navigation-setup-20260804/synapse-venv`、`synapse-data`、安装日志 | 随专用根目录一并删除 |
| 本地 OpenClaw npm 安装 | `/Users/quentincrane/.local/share/drone-navigation-setup-20260804/openclaw` | 随专用根目录一并删除 |
| MediaMTX 二进制与本地配置 | `/Users/quentincrane/.local/share/drone-navigation-setup-20260804/mediamtx` | 随专用根目录一并删除 |
| 本地后端私密配置 | `server/config.json` | 删除该单个文件；它已被 Git 忽略 |
| 配置过程记录 | `setup-notes/` | 删除该目录 |

## Homebrew 副作用

本次安装了 `postgresql@14`。Homebrew 同时创建了一个**未供本项目使用**的默认数据目录：`/opt/homebrew/var/postgresql@14`。本项目实际使用的是上表中的独立集群和 5433 端口。未来若不再需要 PostgreSQL 14，确认停止所有实例后，可删除该默认数据目录并执行 `brew uninstall postgresql@14`。

## 端口保护

端口 5173、8000、8889 在本次工作开始前已被占用，未停止、替换或重新配置。新建数据库使用 5433。
