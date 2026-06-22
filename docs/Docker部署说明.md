# Docker 部署说明

## 部署目标

这个 Docker 版本用于把当前后端和页面一起部署到服务器。部署后访问：

`http://服务器IP:4177`

后端接口也在同一个地址下，例如：

`http://服务器IP:4177/api/health`

## 服务器准备

服务器需要安装：

- Docker
- Docker Compose

## 上传目录

把整个目录上传到服务器：

`dungeon-mercenary-unified`

建议放在：

`/opt/cyber-dragon/dungeon-mercenary-unified`

## 启动

进入目录后运行：

```bash
docker compose up -d --build
```

如果是在 Windows 本机测试，需要先启动 Docker Desktop，并确认 Linux Engine 正常运行；服务器上只要 Docker 服务正常即可。

查看状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f
```

健康检查：

```bash
curl http://127.0.0.1:4177/api/health
```

正常会返回：

```json
{"ok":true,"online":12,"message":"后端已启动"}
```

## 数据保存

排行榜、好友切磋、世界 Boss 血量保存在 Docker volume：

`cyber-dragon-data`

这意味着更新镜像或重启容器不会清空数据。

查看数据卷：

```bash
docker volume ls
```

备份数据：

```bash
docker run --rm -v dungeon-mercenary-unified_cyber-dragon-data:/data -v "$PWD":/backup alpine tar czf /backup/cyber-dragon-data.tar.gz -C /data .
```

恢复数据：

```bash
docker run --rm -v dungeon-mercenary-unified_cyber-dragon-data:/data -v "$PWD":/backup alpine sh -c "cd /data && tar xzf /backup/cyber-dragon-data.tar.gz"
```

## 升级

后续更新代码后，在服务器目录运行：

```bash
docker compose up -d --build
```

旧数据会继续保留。

## 停止

```bash
docker compose down
```

只停止服务，不删除数据。

## 清空数据

只有确认要重置排行榜和 Boss 数据时才运行：

```bash
docker compose down -v
```

## 端口调整

默认端口是 `4177`。如果服务器这个端口被占用，可以修改 `docker-compose.yml`：

```yaml
ports:
  - "8080:4177"
```

修改后访问：

`http://服务器IP:8080`

## 后续扩展建议

当前版本的数据使用本地 JSON 文件保存，适合小规模测试和早期上线。后续可以按下面顺序扩展：

1. 增加账号和登录。
2. 把 `data/server-state.json` 替换成 MongoDB。
3. 给排行榜增加赛季字段。
4. 给好友切磋增加房间、邀请和战报详情。
5. 给世界 Boss 增加定时刷新、伤害榜和奖励邮件。

当前 Docker 结构已经预留了环境变量、持久化数据卷和健康检查，后续替换数据库或拆分服务时不需要推翻现有部署方式。

## 本次本机验证记录

已完成：

- 后端语法检查通过。
- Docker Compose 配置检查通过。
- 使用 `PORT`、`HOST`、`DATA_DIR` 模拟容器环境启动成功。
- 健康检查接口返回正常。
- 自定义数据目录可以创建 `server-state.json`。

未在本机完成镜像构建，原因是当前 Windows 的 Docker Desktop Linux Engine 没有启动。服务器上 Docker 服务正常时，可以直接运行 `docker compose up -d --build`。
