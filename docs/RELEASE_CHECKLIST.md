# 发布检查清单

**文档编号**: RELEASE-CHECKLIST
**版本**: 1.0
**日期**: 2026-07-09
**状态**: 当前有效草案
**适用版本**: v1.7.x+

---

## 一、发布原则

1. `main` 必须始终保持可发布。
2. 任何发布前必须先 `npm run build`，再 `npm test`，因为测试会导入 `dist/`。
3. 不发布未文档化的新环境变量、新工具或行为变更。
4. 不发布包含真实凭证、`.env`、生产连接串或私有 token 的提交。
5. Patch 版本只做修复和文档/工程改进；新传输、新认证、新引擎进入 minor/major。
6. `.env.example` 可以发布，但只能包含本地开发示例或占位符。

---

## 二、发布前检查

### 2.1 工作区和分支

- [ ] 当前分支正确，优先在 feature 分支完成开发，再合入 `main`。
- [ ] `git status --short --branch` 仅包含本次发布预期文件。
- [ ] 没有未解释的大型二进制文件或生成产物。
- [ ] 没有 `.env`、`.env.*`（`.env.example` 除外）、真实证书、生产凭证。
- [ ] 已 `git fetch origin` 并确认本地基于最新远端。

建议命令：

```powershell
git fetch origin
git status --short --branch
git log --oneline --decorate -n 5
```

### 2.2 版本和变更记录

- [ ] `package.json` version 已更新。
- [ ] `package-lock.json` version 与 `package.json` 一致。
- [ ] `CHANGELOG.md` 新增对应版本章节。
- [ ] README/API/CONFIG/ERRORS 等文档已同步行为变更。
- [ ] 若有架构决策，ADR 状态已更新。

### 2.3 安全检查

- [ ] `sql_query` 仍在 MCP 层执行 `isReadOnlyQuery` 后再调用 driver。
- [ ] 新增写操作检查 `readonly`。
- [ ] Redis 操作检查 `keyPrefix`。
- [ ] MongoDB 操作检查 allowlist 和 NoSQL 注入风险。
- [ ] 错误、日志、审计输出经过凭证脱敏。
- [ ] 新增 HTTP 或远程能力默认不暴露到 `0.0.0.0`。

建议搜索：

```powershell
rg -n "password|passwd|secret|token|api_key|mongodb://|postgres://|mysql://|redis://|mssql://|oracle:" . --glob '!node_modules/**' --glob '!package-lock.json'
```

---

## 三、本地验证命令

必须按顺序执行：

```powershell
npm ci
npm run build
npm test
npm run lint
npm run format:check
npm run typecheck
npm run test:coverage:check
npm pack --dry-run
```

说明：

- 如果只是文档改动，可以不运行全部命令，但最终发布前必须运行。
- 如果 `npm ci` 会重装依赖，请确认没有意外修改 `package-lock.json`。
- `npm pack --dry-run` 必须人工核对输出文件列表。

---

## 四、包产物核对

### 4.1 必须包含

- [ ] `dist/`
- [ ] `README.md`
- [ ] `README_en.md`（如果存在并维护）
- [ ] `.env.example`
- [ ] `CHANGELOG.md`
- [ ] `LICENSE`
- [ ] `MIGRATION.md`
- [ ] `AGENTS.md`
- [ ] `package.json`

### 4.2 必须排除

- [ ] `.env`
- [ ] `.env.*`（`.env.example` 除外）
- [ ] `node_modules/`
- [ ] `coverage/`
- [ ] `.git/`
- [ ] 临时日志和测试输出
- [ ] 真实数据库凭证或私有 token

### 4.3 需明确决策

| 目录/文件 | 默认建议 | 说明 |
|-----------|----------|------|
| `src/` | 不进入 npm 包 | 运行时使用 `dist/` |
| `test/` | 不进入 npm 包 | 开发仓库保留即可 |
| `docs/` | 可不进入 npm 包 | README 指向仓库文档；如进入需控制体积 |
| `scripts/` | 按需 | healthcheck 或 docs 生成脚本如运行时需要才包含 |

---

## 五、发布流程

### 5.1 创建发布提交

```powershell
git status --short
git add -A
git commit -m "chore: release vX.Y.Z"
```

提交前确认：

- [ ] commit message 版本号正确。
- [ ] 没有混入下个版本未完成代码。
- [ ] 文档和代码描述一致。

### 5.2 打 tag

```powershell
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

如果 push 失败：

- [ ] 不要重复创建新 tag。
- [ ] 先检查认证和远端状态。
- [ ] 如果 tag 已推送但 commit 有误，停止并制定修复策略，不要随意强推。

### 5.3 npm 发布前

```powershell
npm whoami
npm pack --dry-run
```

确认：

- [ ] 包名和版本正确。
- [ ] tarball 内容正确。
- [ ] README 渲染无明显问题。
- [ ] optionalDependencies 行为符合预期，尤其是 Oracle 驱动。

### 5.4 npm 发布

```powershell
npm publish --access public
```

发布后：

- [ ] npm 页面版本正确。
- [ ] GitHub tag 与 npm version 一致。
- [ ] CHANGELOG 中链接和日期正确。
- [ ] 如有 GitHub Release，内容与 CHANGELOG 一致。

---

## 六、发布后验证

建议在临时目录验证安装和启动：

```powershell
mkdir tmp-polyglot-release-check
cd tmp-polyglot-release-check
npm init -y
npm install @yclenove/polyglot-db-mcp-server@X.Y.Z
npx polyglot-db-mcp-server --help
```

如支持 CLI init：

```powershell
npx polyglot-db-mcp-server init
npx polyglot-db-mcp-server test
```

验证点：

- [ ] binary 可执行。
- [ ] `--help` 正常。
- [ ] 默认 stdio 模式不输出非 MCP stdout。
- [ ] README 快速开始可复现。

---

## 七、回滚和补救

| 场景 | 处理 |
|------|------|
| npm 发布后发现文档错误 | 发 patch 版本修正文档 |
| npm 发布后发现代码 P0 bug | 立即发布 patch，CHANGELOG 标注修复 |
| tag 推错但未 npm publish | 删除本地/远端 tag 前需团队确认 |
| npm 包包含凭证 | 立即撤回/弃用版本，轮换凭证，发安全公告 |
| CI 漏测 | 修复 CI 后补 patch，不在同一版本悄悄覆盖 |

---

## 八、版本类型规则

| 类型 | 示例 | 允许内容 |
|------|------|----------|
| Patch | `1.7.1` | bugfix、测试补齐、文档、发布工程、小型兼容改进 |
| Minor | `1.8.0` | 新 transport、新工具、新非破坏性能力 |
| Major | `2.0.0` | OAuth/RBAC、权限模型、破坏性配置调整 |

---

## 九、最终发布签核

发布负责人发布前逐项填写：

| 项目 | 结果 | 备注 |
|------|------|------|
| 版本号一致 | ☐ 通过 / ☐ 不通过 | |
| build | ☐ 通过 / ☐ 不通过 | |
| test | ☐ 通过 / ☐ 不通过 | |
| lint | ☐ 通过 / ☐ 不通过 | |
| typecheck | ☐ 通过 / ☐ 不通过 | |
| format:check | ☐ 通过 / ☐ 不通过 | |
| coverage check | ☐ 通过 / ☐ 不通过 | |
| pack dry-run | ☐ 通过 / ☐ 不通过 | |
| secrets scan | ☐ 通过 / ☐ 不通过 | |
| CHANGELOG | ☐ 通过 / ☐ 不通过 | |
| README/API/CONFIG | ☐ 通过 / ☐ 不通过 | |
| tag push | ☐ 通过 / ☐ 不通过 | |
| npm publish | ☐ 通过 / ☐ 不通过 | |
