# Linux 与 NAT 部署

本机开发不要求安装 Docker。以下为服务器部署模板，尚未在你的 Linux/NAT 环境执行。不要同时启动两个 API 实例：房间在内存，启动恢复逻辑也按单实例设计。

## NAT 入口与 HTTPS

云服务商提供 NAT 映射时，将一个外部 TCP 端口映射到服务器入口端口即可，HTTP 接口和 Socket.IO 共用入口；PostgreSQL 5432 不映射公网。

- 若服务商提供 HTTPS 终止并支持 WebSocket，Caddy 可使用随附 HTTP 配置作为内部源站。
- 若只是高位 TCP 映射，浏览器地址形如 `https://你的域名:外部端口`。需要匹配域名的证书，通常可用 DNS 验证申请，再加载至 Caddy。
- 如果公网 80/443 可转发，可以另配 Caddy 常规自动 HTTPS。

`PUBLIC_ORIGIN` 必须是浏览器看到的确切来源（协议、域名、外部端口，不带末尾 `/`）。本项目默认 HTTP 配置用于本地验证/内部源站，不会自动为未知 NAT 入口申请证书。

服务商如果在 NAT 之前还有 HTTP 代理，Caddy 当前会将来路地址写入 `X-Forwarded-For`。这可能使限流按代理地址聚合。确认服务商的可信代理网段与真实 IP 头规则后再调整；不要无条件信任任意客户端伪造的头。

## 方案 A：服务器已有 Docker 时使用 Compose

1. 上传项目，保留 `package-lock.json`，不用上传 `node_modules` 或测试数据库。
2. 从 `.env.example` 创建 `.env`，设置随机 `POSTGRES_PASSWORD`（建议纯十六进制，避免 URL 特殊字符）、正确 `PUBLIC_ORIGIN` 和服务器入口 `HTTP_PORT`。
3. 将本地导入得到的 `storage/assets` 复制到服务器，并迁移对应数据库；素材文件和数据库必须保持对应。也可以在服务器离线导入，见下方。
4. 启动：

```sh
mkdir -p storage/assets
docker compose up -d --build
docker compose ps
curl -f http://127.0.0.1:8080/api/health/ready
```

API 容器启动时自动迁移数据库。数据库无宿主端口，API 只在容器网络开放，由 Caddy 转发。应用以非 root 用户运行，素材只读挂载。

Compose 通过同一个 Dockerfile 的 `server` 与 `frontend` 构建目标生成后端和 Caddy 镜像。前端生产产物放在 Caddy 的 `/srv/site`，公共网页资源与受保护的题图目录彼此独立。`VITE_DEMO_CATALOG` 默认未启用，生产构建不会自动导入合成曲库。

如需服务器导入，先把待导入目录放在 `imports/`，并使 `storage/assets` 可供容器 uid 1000 写入，然后执行（路径按实际 manifest 修改）：

```sh
docker compose run --rm -v "$PWD/storage/assets:/app/storage/assets:rw" -v "$PWD/imports:/imports:ro" api node dist/tools/import-assets.js /imports/song.manifest.json
```

Compose 默认把主机 `${HTTP_PORT}` 映射到 Caddy 容器 80。若需要自行终止 TLS，将 Caddy 配置挂载改为 `./deploy/Caddyfile.tls:/etc/caddy/Caddyfile:ro`，并增加证书目录只读挂载 `./certs:/certs:ro`。证书名称为 `fullchain.pem` 和 `privkey.pem`。TLS 示例仍在容器 80 上监听 TLS，以复用同一 NAT 映射；此时本机检查也需改成 HTTPS 并使用匹配的域名。

证书申请和续期需按你的 DNS 服务商配置；当前模板未包含 DNS 插件或自动续期任务。

## 方案 B：服务器也不使用 Docker

安装 Node.js 22.14+、PostgreSQL 17 和 Caddy，创建专用系统用户 `phiguess`，项目放到 `/opt/phiguess`。数据库创建独立的用户和数据库，凭据写入 `.env`，数据库只监听本机。

```sh
cd /opt/phiguess
npm ci --omit=dev
```

原生生产部署可将本地 `npm run build` 生成的后端 `dist/` 和前端 `apps/web/dist/` 一并上传。这样服务器安装生产依赖即可，不需要安装用于本机测试的 PostgreSQL 二进制开发依赖；不要上传 Windows 的 `node_modules`。

设置 `.env` 的 `DATABASE_URL`、`PUBLIC_ORIGIN`、`ASSET_DIR=/opt/phiguess/storage/assets`、`AVATAR_DIR=/opt/phiguess/storage/avatars`、`NODE_ENV=production`、`TRUST_PROXY=1`。先创建 `storage/avatars` 并授予 `phiguess` 用户写权限。保护 `.env` 的读取权限。按服务器 Node 路径调整 `deploy/phiguess.service`，然后将其安装为 systemd 单元。

```sh
sudo cp deploy/phiguess.service /etc/systemd/system/phiguess.service
sudo systemctl daemon-reload
sudo systemctl enable --now phiguess
```

Caddy 原生配置把 `api:3000` 改为 `127.0.0.1:3000`，将静态文件 root 改为 `/opt/phiguess/apps/web/dist`，监听服务商映射的本地入口端口。只允许 Caddy 入口进入，禁止公网直接访问 3000/5432，确保 `TRUST_PROXY=1` 对应一层可信反代。

部署顺序为：上传新版本 → 构建/安装依赖 → 备份 → 重启单实例。重启会中断进行中的比赛，应选维护窗口。

## 备份与恢复

备份必须同时包含 PostgreSQL、`storage/assets`、头像目录（Compose 的 `avatar_data` 卷）与安全保存的配置。源 PNG 和 Raw 原图保存在本地 `storage/corpus/source`，也应另行留存。Compose 数据库备份示例（Linux shell）：

```sh
mkdir -p backups
docker compose exec -T db pg_dump -U phiguess -d phiguess -Fc > backups/phiguess.dump
tar -czf backups/assets.tar.gz storage/assets
```

备份期间暂停素材导入，让数据库引用与文件集合一致。将备份复制到本地电脑或其他机器。恢复应先在空数据库和单独目录验证，确认后再切换生产，不要直接覆盖唯一数据副本。这里没有自动删除历史备份的脚本。

## 上线验收

依次验证公网 HTTPS、健康检查、两个真实设备的 WebSocket 连接、断线重连、HD/IN/AT 加载时间、完成一局与排行榜写入。10Mbps 的性能评估要使用最终 SVG 和真实 NAT 链路；本机测试不代表生产容量。
