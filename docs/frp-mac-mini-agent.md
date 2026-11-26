# Mac Mini agent：DSH Remote + frp 内网穿透配置

把这份文档整份交给 **安装了 DSH 的那台 Mac Mini** 上的 agent。本机（当前开发机）没有 DSH。

iPhone IPA 在另一台有 Xcode 的 Mac 上打包，步骤见 [ios-ipa-other-mac.md](ios-ipa-other-mac.md)。

## 1. 目标拓扑

```text
Mac Mini（有 DSH，NAT 后面）                 VPS 129.204.31.210
┌──────────────────────────────┐            ┌─────────────────────────────┐
│ DSH Desktop + Remote 插件    │  HTTPS/WS  │ 自建 Remote Server :8080    │
│ serverUrl =                  │───────────►│ DSH_SERVER_PUBLIC_URL 必须  │
│   http://129.204.31.210:8080 │            │ 与这个 origin 完全一致       │
│                              │            │                             │
│ frpc                         │── :7000 ─►│ frps bindPort 7000          │
│   ssh 本机 22  → 公网 :6000  │            │                             │
└──────────────────────────────┘            └─────────────────────────────┘
        ▲
        │ 手机 / 另一台电脑 Client
        │ 也填同一个 serverUrl
        │ http://129.204.31.210:8080
```

Host 和 Client **必须填同一个 origin**（协议、IP、端口都一样）。不要 Mini 填 `http://127.0.0.1:8080`、手机填公网地址。

## 2. 当前状态（2026-11-26）

已完成（在仓库 `/Volumes/T7/Porject/ds-harness-remote`）：

- 插件支持把 **公网 HTTP 穿透地址** 直接写成 `serverUrl`。例如 `http://129.204.31.210:8080`，会自动把该 IP 加入 HTTP 白名单。
- 也可用环境变量 `DSH_REMOTE_TUNNEL_URL`（优先级低于配置文件里的 `serverUrl` 和 `DSH_REMOTE_SERVER`）。
- 相关代码：`packages/plugin/src/config.ts`。Mini 要用这份改过的插件，不要装未改的 npm `latest`。

未完成：

- **VPS SSH 登不进去。** `root@129.204.31.210:22` 接受 `publickey,password`，但密码被拒。多半是腾讯云控制台密码，sshd 禁止了 root 密码登录。
- 因此 **frps 和自建 Remote Server 还没装到 VPS 上。** Mini 上的 DSH 现在连这个地址会失败，直到 VPS 部署完成。

## 3. 先找用户做的两件事

### 3.1 放行安全组（用户说要先问）

腾讯云控制台 → 该 CVM → 安全组，**入站放行**：

| 端口 | 协议 | 用途 |
| --- | --- | --- |
| 22 | TCP | SSH（已通，可保持） |
| 7000 | TCP | frps 控制口，Mini 的 frpc 连这里 |
| 8080 | TCP | 自建 DSH Remote Server（HTTP + WebSocket） |
| 6000 | TCP | 可选，穿透 Mini 的 SSH |

源地址可先 `0.0.0.0/0`。不要只开 80/443。WebSocket 走 8080，不要用会断开 Upgrade 的免费 CDN。

### 3.2 让人能 SSH 上 VPS

任选一种：

1. 控制台打开 root 密码登录（`PermitRootLogin yes` + `PasswordAuthentication yes`），确认密码；或
2. 把下面公钥写进 root 的 `~/.ssh/authorized_keys`：

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPi1/ERJAjIYqIsyIQrP+QDEedKXSYC2bftHi4ukFt1W dsh-frp-vps
```

对应私钥在开发机：`~/.ssh/dsh_frp_vps_ed25519`。

SSH 通了之后，在 VPS 上跑第 4 节脚本。Mini agent **不要改 VPS root 密码，也不要重装系统。**

## 4. VPS 部署（SSH 通了再跑）

用 root 一次性安装 **frps + 自建 Remote Server**。账号密码如下，给 Mini 登录 DSH 用。

```bash
set -euo pipefail
FRP_VERSION=0.61.1
FRP_TOKEN=xyr1v5KIYngTINBeqLmfv2fyajEEWfAi
DSH_ACCOUNT=owner@dsh.local
DSH_PASSWORD=n7nyjFVpvL6RqKRE2g4z
PUBLIC_URL=http://129.204.31.210:8080

# --- frps ---
arch=$(uname -m)
case "$arch" in
  x86_64) frp_arch=amd64 ;;
  aarch64|arm64) frp_arch=arm64 ;;
  *) echo "unsupported arch: $arch"; exit 1 ;;
esac
cd /opt
curl -fsSL -o frp.tgz "https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_${frp_arch}.tar.gz"
tar -xzf frp.tgz
rm -f frp.tgz
install -d /opt/frp /etc/frp
cp "frp_${FRP_VERSION}_linux_${frp_arch}/frps" /opt/frp/frps
chmod 755 /opt/frp/frps
rm -rf "frp_${FRP_VERSION}_linux_${frp_arch}"

cat > /etc/frp/frps.toml <<EOF
bindPort = 7000
auth.method = "token"
auth.token = "${FRP_TOKEN}"
webServer.addr = "127.0.0.1"
webServer.port = 7500
EOF
chmod 600 /etc/frp/frps.toml

cat > /etc/systemd/system/frps.service <<'EOF'
[Unit]
Description=frps
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
ExecStart=/opt/frp/frps -c /etc/frp/frps.toml
Restart=on-failure
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now frps

# --- DSH Remote Server（官方镜像）---
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
mkdir -p /opt/dsh-remote-server
cat > /opt/dsh-remote-server/.env <<EOF
DSH_SERVER_ACCOUNT=${DSH_ACCOUNT}
DSH_SERVER_PASSWORD=${DSH_PASSWORD}
DSH_SERVER_HOST=0.0.0.0
DSH_SERVER_PORT=8080
DSH_SERVER_PUBLIC_URL=${PUBLIC_URL}
EOF
chmod 600 /opt/dsh-remote-server/.env
docker rm -f dsh-remote-server 2>/dev/null || true
docker run -d --name dsh-remote-server --restart unless-stopped \
  --env-file /opt/dsh-remote-server/.env \
  -p 8080:8080 \
  -v dsh-remote-server-data:/data \
  ghcr.io/liguobao/ds-harness-remote/server:latest

ss -lnt | grep -E ':7000|:8080' || true
curl -fsS -o /dev/null -w 'server %{http_code}\n' http://127.0.0.1:8080/ || true
systemctl is-active frps
```

验收：

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://129.204.31.210:8080/
# 期望 200（或 302 到登录页），不要 000 连接失败
```

镜像拉不下来时，把本仓库 `apps/server` 按 `apps/server/README.zh.md` 在 VPS 上 `docker compose up`。`DSH_SERVER_PUBLIC_URL` 必须是 `http://129.204.31.210:8080`，不能写 `localhost`。

## 5. Mac Mini 要做的（这台机器有 DSH）

### 5.1 用带穿透补丁的插件

把这份仓库拷到 Mini，或在 Mini 上拉同一分支。不要 `dsh plugin add ds-harness-remote@latest` 盖掉改动。

本仓库根目录已有 `cordis.patch.yml`。Desktop 从本地目录加载插件后，在 **Remote 设置** 把 Server 地址改成：

```text
http://129.204.31.210:8080
```

保存后再登录。账号：

```text
邮箱: owner@dsh.local
密码: n7nyjFVpvL6RqKRE2g4z
```

也可以写进 profile 的 `cordis.patch.yml`：

```yaml
- insert:
    - id: ds-harness-remote
      config:
        enabled: true
        role: host
        serverUrl: http://129.204.31.210:8080
```

或启动前：

```sh
export DSH_REMOTE_TUNNEL_URL=http://129.204.31.210:8080
```

改完重启 DSH Desktop。Host 在线后再用手机 / 另一台电脑填 **同一个** Server 地址、同一账号登录，即可连这台 Mini。

### 5.2 安装 frpc（把 Mini SSH 穿透出去，方便排障）

```bash
set -euo pipefail
FRP_VERSION=0.61.1
FRP_TOKEN=xyr1v5KIYngTINBeqLmfv2fyajEEWfAi
cd /tmp
curl -fsSL -o frp.tgz "https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_darwin_arm64.tar.gz"
# Intel Mini 改用 frp_${FRP_VERSION}_darwin_amd64.tar.gz
tar -xzf frp.tgz
sudo mkdir -p /usr/local/frp /usr/local/etc/frp
sudo cp "frp_${FRP_VERSION}_darwin_arm64/frpc" /usr/local/frp/frpc
sudo chmod 755 /usr/local/frp/frpc

sudo tee /usr/local/etc/frp/frpc.toml >/dev/null <<EOF
serverAddr = "129.204.31.210"
serverPort = 7000
auth.method = "token"
auth.token = "${FRP_TOKEN}"

[[proxies]]
name = "mac-mini-ssh"
type = "tcp"
localIP = "127.0.0.1"
localPort = 22
remotePort = 6000
EOF
sudo chmod 600 /usr/local/etc/frp/frpc.toml
```

用 launchd 保活（把 `UserName` 换成 Mini 上的实际用户）：

```bash
sudo tee /Library/LaunchDaemons/com.dsh.frpc.plist >/dev/null <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.dsh.frpc</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/frp/frpc</string>
    <string>-c</string>
    <string>/usr/local/etc/frp/frpc.toml</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/var/log/frpc.log</string>
  <key>StandardErrorPath</key><string>/var/log/frpc.log</string>
</dict>
</plist>
EOF
sudo launchctl bootstrap system /Library/LaunchDaemons/com.dsh.frpc.plist
```

之后从外网：

```sh
ssh -p 6000 <mini用户>@129.204.31.210
```

DSH 业务流量走 Remote Server `:8080`，不走这条 SSH 隧道。这条只是进 Mini 排障用。

## 6. 验收清单

1. VPS：`systemctl is-active frps` 为 `active`；`curl -I http://129.204.31.210:8080/` 不是连接失败。
2. Mini：frpc 日志里出现 `start proxy success`（mac-mini-ssh）。
3. Mini DSH Remote 设置里 Server 地址是 `http://129.204.31.210:8080`，Host 显示在线。
4. 另一台设备用同一地址、同一账号登录，能看到这台 Mini Host，并能开会话。
5. 若保存 Server 地址时报必须 HTTPS：说明跑的不是带补丁的插件，回到 5.1。

## 7. 凭据（只给 Mini agent，不要写进 git commit）

| 项 | 值 |
| --- | --- |
| VPS | `129.204.31.210` |
| frp token | `xyr1v5KIYngTINBeqLmfv2fyajEEWfAi` |
| frps | `129.204.31.210:7000` |
| DSH Server | `http://129.204.31.210:8080` |
| DSH 账号 | `owner@dsh.local` |
| DSH 密码 | `n7nyjFVpvL6RqKRE2g4z` |
| Mini SSH 穿透 | `ssh -p 6000 <user>@129.204.31.210` |

VPS root 密码不要写进 Mini 的配置。SSH 仍由用户在控制台开通。

## 8. 不要做的事

- 不要把 Mini 的 DSH Web（`127.0.0.1`）直接暴露成唯一入口，手机对不齐 origin。
- 不要给 Host 和 Client 配两个不同的 Server URL。
- 不要在没放行 7000/8080 时反复重启 frpc。
- 不要用 `https://dsh.r2049.cn` 和这套自建 Server 混用同一套设备凭据。
