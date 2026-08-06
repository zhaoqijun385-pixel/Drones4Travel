# 20：本地服务一键启动与关闭

## 一键启动

```bash
/Users/quentincrane/Documents/drone-navigation/scripts/start-local-stack.sh
```

启动顺序为 PostgreSQL、幂等数据库迁移、Synapse、OpenClaw、MediaMTX、FastAPI 和
Vite。脚本会等待各服务健康检查通过，最后输出网站地址。

## 一键关闭

```bash
/Users/quentincrane/Documents/drone-navigation/scripts/stop-local-stack.sh
```

关闭脚本只停止本项目的服务。它会处理 `screen` 退出后可能残留的、且命令特征与本项目
匹配的监听进程，最后正常关闭 PostgreSQL。不会删除项目文件、配置或数据库数据。

