# 另一台 Mac 打包 iOS IPA（给打包机上的 agent）

把这份文档整份交给 **有完整 Xcode 的那台 Mac** 上的 agent。开发机只有 Command Line Tools，编不出 IPA。打包机 **没有这块 T7 移动硬盘**，不要去找 `/Volumes/T7/...`。源码已经打成压缩包放在开发机本机桌面，用 AirDrop / U 盘 / 局域网拷过去。

Mini 上的 DSH Host 配置见 [frp-mac-mini-agent.md](frp-mac-mini-agent.md)。官方构建说明见 [ios-build-and-release.md](ios-build-and-release.md)。冲突时以本文为准：本文描述的是带专线补丁的本地树，不是上游 `main`。

## 0. 你要交出的东西

一个能装到 iPhone 的 `DSHRemote.ipa`。装完打开登录页，默认专线是：

```text
http://129.204.31.210:8080
```

用户这台开发机装着 Sideloadly，IPA 编好后拷过去用 Sideloadly 签到手机即可。

## 1. 必须用这份改过的源码

不要 `git clone` 上游，不要 `npm i ds-harness-remote`，不要官方 TestFlight。官方包的 ATS 会拦住公网 HTTP 专线。

打包机没有 T7。开发机本机桌面已经打好包（约 13 MB，不含 `node_modules` / `.git` / Pods）：

```text
/Users/ginpang/Desktop/dsh-remote-ipa-src.tar.gz
/Users/ginpang/Desktop/ios-ipa-other-mac.md
/Users/ginpang/Desktop/frp-mac-mini-agent.md
```

用 AirDrop、U 盘或局域网把这三个文件拷到打包机，例如放到 `~/Downloads/`。不要去挂 T7，也不要 `git clone` 上游。

打包机解压：

```sh
mkdir -p ~/src
tar -xzf ~/Downloads/dsh-remote-ipa-src.tar.gz -C ~/src
cd ~/src/ds-harness-remote
```

解压后先确认专线补丁还在：

```sh
rg -n "129.204.31.210" packages/app-core/src/screens/setup-screens.tsx apps/ios/ios/DSHRemote/Info.plist
rg -n "NSAllowsArbitraryLoads" apps/ios/app.json apps/ios/ios/DSHRemote/Info.plist
```

两处都要能搜到。搜不到就停，先把压缩包拷对。

这份树里至少包含这些已改文件：

| 路径 | 作用 |
| --- | --- |
| `packages/plugin/src/config.ts` 与 `packages/plugin/dist/index.js` | Host 插件允许公网 HTTP `serverUrl` |
| `packages/app-core/src/lib/server-url.ts` | 手机端允许 HTTP 专线 origin |
| `packages/app-core/src/screens/setup-screens.tsx` | 登录页默认专线，可一键「使用专线 / 使用官方服务」 |
| `packages/app-core/src/locales/*.ts` | 专线文案 |
| `apps/ios/app.json` | `NSAllowsArbitraryLoads: true` |
| `apps/ios/ios/DSHRemote/Info.plist` | 已写入同样的 ATS |

专线常量在 `packages/app-core/src/screens/setup-screens.tsx`：

```ts
const officialServerUrl = 'https://dsh.r2049.cn'
const dedicatedLineUrl = process.env.EXPO_PUBLIC_DSH_REMOTE_SERVER?.trim() || 'http://129.204.31.210:8080'
```

## 2. 打包机环境

| 项 | 要求 |
| --- | --- |
| 系统 | macOS，Intel 或 Apple Silicon 均可 |
| Xcode | **完整 Xcode.app**，仓库要求 Xcode 26+。`xcode-select -p` 必须指向 `/Applications/Xcode.app/Contents/Developer`，不能是 Command Line Tools |
| 签名 | Xcode 已登录 Apple ID。免费账号可以签开发包（约 7 天过期）。付费账号更好 |
| Node | **24**（不要 22）。`node -v` 以 24 开头 |
| pnpm | **9.15.4** |
| CocoaPods | `pod --version` 可用 |
| 磁盘 | 建议空闲 ≥ 30 GB。工程在外置盘也可以，但 DerivedData 放到本机 SSD |

自检：

```sh
xcodebuild -version
xcode-select -p
security find-identity -v -p codesigning
node -v
pnpm -v
pod --version
```

`xcodebuild -version` 若报 `requires Xcode, but active developer directory ... CommandLineTools`：

```sh
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
xcodebuild -runFirstLaunch
```

Node 24：

```sh
# 若已有 nvm
nvm install 24
nvm use 24
corepack enable
corepack prepare pnpm@9.15.4 --activate
```

没有 CocoaPods：

```sh
sudo gem install cocoapods
```

`security find-identity -v -p codesigning` 必须看到至少一条 `Apple Development` 或 `Apple Distribution`。一条都没有：打开 Xcode → Settings → Accounts → 登录 Apple ID → Manage Certificates → 创建 Apple Development。然后把 Team ID 记下来（10 位，类似 `857C9KMARL`）。

仓库 pbxproj 里写死了上游 Team `857C9KMARL`。打包机要用**你自己的 Team**，否则签不上。下面命令里的 `YOUR_TEAM_ID` 全部换成打包机这个 Team。

## 3. 依赖与 JS/原生准备

在仓库根目录：

```sh
cd ~/src/ds-harness-remote
git status -sb || true

export PATH="/opt/homebrew/bin:$HOME/.nvm/versions/node/$(node -v)/bin:$PATH"
node -v   # 确认 v24.x

pnpm install --frozen-lockfile
pnpm --filter './packages/**' -r build
pnpm --filter @dsh-remote/app-core run build:renderers
pnpm --dir apps/ios run verify:workspace
```

`pnpm install` 没有 lock 对齐时不要加 `--no-frozen-lockfile` 乱升级。缺包再排查，不要改 pnpm-lock。

**不要**跑裸的 `expo prebuild -p ios`。`apps/ios/ios/` 已经在树里。只有 Info.plist / 插件丢了才允许：

```sh
APPLE_TEAM_ID=YOUR_TEAM_ID pnpm --dir apps/ios run generate:ios
```

这是 `--no-clean`。跑完立刻 `git diff apps/ios/ios`：pbxproj 若丢掉 `DEVELOPMENT_TEAM` / `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION`，`git restore` 该文件再手改 Team。

装 Pods：

```sh
cd apps/ios/ios
pod install
```

必须打开 **`DSHRemote.xcworkspace`**，不要打开 `DSHRemote.xcodeproj`。

## 4. 用 Xcode 签出 IPA（推荐）

```sh
open ~/src/ds-harness-remote/apps/ios/ios/DSHRemote.xcworkspace
```

1. 左栏选 target **DSHRemote**，Signing & Capabilities：勾 Automatically manage signing，Team 选你的 Apple ID 团队。
2. 同样给 target **HostAttentionWidget**（bundle `io.github.liguobao.dshremote.attention`）选同一个 Team。两个 target 都要签。
3. 若 bundle id `io.github.liguobao.dshremote` 被官方占用、免费账号注册不上：改成你自己的，例如 `com.yourname.dshremote` 和 `com.yourname.dshremote.attention`，两个一起改，保持 `.attention` 后缀。
4. 顶部 scheme 选 **DSHRemote**，destination 选 **Any iOS Device (arm64)**，不要模拟器。
5. Product → Archive。等 Archive 成功。
6. Organizer 里选这份 archive → Distribute App：
   - 有付费账号、只给自己设备：Ad Hoc（设备 UDID 要进 profile）
   - 免费账号 / 准备给 Sideloadly：Development
   - 也可以 Export → Development，导出目录里会有 `.ipa`

命令行等价（Team 换成你的）：

```sh
cd ~/src/ds-harness-remote/apps/ios/ios
TEAM=YOUR_TEAM_ID
OUT="$HOME/Desktop/DSHRemote-ipa"
mkdir -p "$OUT"

xcodebuild \
  -workspace DSHRemote.xcworkspace \
  -scheme DSHRemote \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$OUT/DSHRemote.xcarchive" \
  DEVELOPMENT_TEAM="$TEAM" \
  CODE_SIGN_STYLE=Automatic \
  archive

cat > "$OUT/ExportOptions.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>development</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>compileBitcode</key>
  <false/>
  <key>stripSwiftSymbols</key>
  <true/>
</dict>
</plist>
EOF

xcodebuild -exportArchive \
  -archivePath "$OUT/DSHRemote.xcarchive" \
  -exportPath "$OUT/export" \
  -exportOptionsPlist "$OUT/ExportOptions.plist"
```

成功后 IPA 在 `$HOME/Desktop/DSHRemote-ipa/export/`，名字一般是 `DSHRemote.ipa`。把这个文件拷回开发机或直接给用户。

Archive 失败常见原因：

- 选了模拟器 destination
- Widget 没签名
- Team 仍是 `857C9KMARL` 而打包机没有这个团队
- Node 不是 24，Hermes 脚本失败
- 打开了 `.xcodeproj` 而不是 `.xcworkspace`

## 5. 用 Sideloadly 装到手机

1. 拷 IPA 到装着 Sideloadly 的 Mac。
2. 手机用数据线连上，解锁，信任电脑。
3. 打开 Sideloadly：IPA 拖进去，Apple ID 填用户自己的（不要用别人的）。
4. 点 Start，等安装完成。
5. 手机：设置 → 通用 → VPN 与设备管理 → 信任这个 Apple ID。
6. 免费账号大约 7 天要重签一次。

手机上如果已经装了官方 DSH Remote（同一 bundle id），Sideloadly 会覆盖。用户要保留官方包就改第 4 节的 bundle id 再打一包。

## 6. 手机上怎么连专线

打开刚装的 App：

1. 登录页默认应是 `http://129.204.31.210:8080`。不是的话点切换专线 → **使用专线** → 保存专线。
2. 用邮箱密码登录（自建 Server，不是 DeepSeek 官方账号）：

```text
邮箱: owner@dsh.local
密码: n7nyjFVpvL6RqKRE2g4z
```

3. 能看到 Mac Mini 那台 Host，再开会话。

Host（Mini）和手机必须填**同一个 origin**。Mini 的插件配置见 [frp-mac-mini-agent.md](frp-mac-mini-agent.md)。

若保存专线时报必须 HTTPS：跑的不是这份补丁树，回到第 1 节。若保存成功但请求失败：VPS 上的自建 Server / frps 可能还没装好（开发机 SSH 仍被拒）。专线地址对了也会连不上，先看 Mini 文档第 2–4 节。

## 7. 不要做的事

- 不要对 `apps/ios/ios` 跑不带 `--no-clean` 的 `expo prebuild`。
- 不要用 `expo run:ios` 打模拟器包当 IPA 交给 Sideloadly。
- 不要用官方 TestFlight 包连 `http://129.204.31.210:8080`。
- 不要把证书、`.p8`、Apple 密码写进仓库。
- 不要在打包机上 `git restore` 掉 Info.plist 里的 `NSAllowsArbitraryLoads`。
- 不要把 Mini 的 DSH Web `127.0.0.1` 当成手机 Server 地址。

## 8. 验收

- [ ] `xcodebuild -version` 能跑，不是 Command Line Tools
- [ ] `rg 129.204.31.210 packages/app-core/src/screens/setup-screens.tsx` 有命中
- [ ] Info.plist 含 `NSAllowsArbitraryLoads`
- [ ] Archive 成功，导出 `.ipa`
- [ ] Sideloadly 装上，桌面能打开
- [ ] 登录页专线是 `http://129.204.31.210:8080`
- [ ] VPS Server 起来之后，用 `owner@dsh.local` 能登录并看到 Mini Host

## 9. 把 IPA 交回去

把文件放到开发机或用户桌面，路径写进回复，例如：

```text
~/Desktop/DSHRemote-ipa/export/DSHRemote.ipa
```

体积大约几百 MB。不要只说「打好了」却不给路径。
