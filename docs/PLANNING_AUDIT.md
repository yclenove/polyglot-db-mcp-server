# 迭代规划完备性审计

**文档编号**: PLANNING-AUDIT
**版本**: 1.0
**日期**: 2026-07-09
**状态**: 当前有效
**审计对象**: `docs/ROADMAP.md` 及当前规划文档包

---

## 一、审计目的

本文件用于判断“迭代计划是否足够完备，可以指导后续开发”。它不是某一个版本的需求文档，而是整个规划体系的质量门禁。

一个规划包被认为足够完备，需要同时具备：

1. 长期方向。
2. 近期可执行任务。
3. 中期架构决策。
4. 远期演进边界。
5. 配置、错误、发布、质量等治理文档。
6. 可验证的引用链和验收标准。

---

## 二、当前规划包清单

| 类别 | 文档 | 状态 | 是否满足 |
|------|------|------|----------|
| 总路线图 | `docs/ROADMAP.md` | 当前有效 | 是 |
| 文档索引 | `docs/INDEX.md` | 当前有效 | 是 |
| v1.7.1 质量补丁 | `docs/ITER-v1.7.1-迭代计划.md` | 待执行 | 是 |
| v1.7.2 发布工程 | `docs/ITER-v1.7.2-迭代计划.md` | 待执行 | 是 |
| v1.7.3 开发体验 | `docs/ITER-v1.7.3-迭代计划.md` | 待执行 | 是 |
| v1.8 HTTP PRD | `docs/PRD-v1.8.0.md` | 草案 | 是 |
| v1.8 HTTP ADR | `docs/ADR-001-streamable-http.md` | Proposed | 是 |
| v1.8 实施计划 | `docs/ITER-v1.8.0-迭代计划.md` | 草案 | 是 |
| v2.0 企业安全 PRD | `docs/PRD-v2.0.0.md` | 草案 | 是 |
| v2.0 OAuth/RBAC ADR | `docs/ADR-002-oauth-rbac.md` | Proposed | 是 |
| v2.0 迁移指南 | `docs/MIGRATION-v2.0.0.md` | 草案 | 是 |
| v3.0 插件 ADR | `docs/ADR-003-plugin-architecture.md` | Proposed | 是 |
| 配置治理 | `docs/CONFIG.md` | 草案 | 是 |
| 错误治理 | `docs/ERRORS.md` | 草案 | 是 |
| 发布治理 | `docs/RELEASE_CHECKLIST.md` | 草案 | 是 |
| 质量模板 | `docs/QUALITY-v1.7.1-质量报告.md`, `docs/QUALITY-v1.8.0-质量报告.md` | 模板 | 是 |

---

## 三、完备性矩阵

| 维度 | 要求 | 当前证据 | 结果 |
|------|------|----------|------|
| 战略方向 | 至少覆盖 6-12 个月 | ROADMAP 覆盖 2026 Q3 ~ 2027 Q2 | 通过 |
| 近期执行 | 至少一个 patch 可直接开工 | v1.7.1/v1.7.2/v1.7.3 | 通过 |
| 中期功能 | HTTP 传输有 PRD/ADR/ITER | v1.8 三件套 | 通过 |
| 企业安全 | 认证授权有 PRD/ADR/迁移 | v2.0 PRD/ADR/MIGRATION | 通过 |
| 远期平台 | 插件化有前置 ADR | ADR-003 | 通过 |
| 配置治理 | 环境变量和连接示例明确 | CONFIG | 通过 |
| 错误治理 | code/message/hint 规范明确 | ERRORS | 通过 |
| 发布治理 | 发布前后 checklist 明确 | RELEASE_CHECKLIST | 通过 |
| 质量门禁 | 至少近期版本有模板 | QUALITY v1.7.1/v1.8.0 | 通过 |
| 引用一致性 | docs 引用可检查 | 引用检查脚本输出 missing refs 0 | 需每次提交前复跑 |

---

## 四、必须保持的全局不变量

这些不变量跨所有版本有效：

1. `sql_query` 必须在 MCP 层先执行 `isReadOnlyQuery`，再调用 driver。
2. Drivers 继续保留 readonly 保护。
3. Redis 写操作必须保留 keyPrefix 检查。
4. MongoDB 操作必须保留 allowlist 和 NoSQL 注入检查。
5. 错误、日志、审计不得泄露真实凭证。
6. 默认 stdio 启动不得被 HTTP/OAuth 改造破坏。
7. 新增环境变量必须写入 `docs/CONFIG.md`。
8. 新增错误码或错误行为必须写入 `docs/ERRORS.md`。
9. 发布前必须执行 `docs/RELEASE_CHECKLIST.md`。
10. 破坏性架构决策必须先有 ADR。

---

## 五、提交前审计命令

规划文档提交前建议运行：

```powershell
git diff --check
git status --short --branch
```

引用检查可使用：

```powershell
@'
from pathlib import Path
import re
files = list(Path('docs').glob('*.md'))
missing = []
for f in files:
    text = f.read_text(encoding='utf-8-sig')
    for m in re.findall(r'`(docs/[^`]+?)`', text):
        if '*' in m:
            continue
        p = Path(m.replace('/', '\\\\'))
        if not p.exists():
            missing.append((str(f), m))
print('missing refs:', len(missing))
for item in missing:
    print(item[0], '->', item[1])
'@ | python -
```

---

## 六、剩余非阻塞改进

这些不是当前规划包完备性的阻塞项，但后续可以继续增强：

| 优先级 | 改进 | 建议版本 |
|--------|------|----------|
| P1 | README/API/CHANGELOG 与规划文档口径最终对齐 | 提交规划前或 v1.7.2 |
| P1 | `.env.example` 落地并与 CONFIG 对齐 | v1.7.2 |
| P1 | `docs/QUALITY-v1.7.1-质量报告.md` 根据真实执行结果填写 | v1.7.1 完成前 |
| P2 | OAuth/RBAC 迁移示例扩展为完整 cookbook | v2.0 RC |
| P2 | 插件示例 manifest 增加真实 demo | v3.0 alpha |

---

## 七、审计结论

截至本模板创建时，规划包已经具备从 v1.7.x 到 v3.0 的连续演进路径：

1. v1.7.x 收敛质量、发布工程和开发体验。
2. v1.8.0 引入 HTTP 传输和运维能力。
3. v2.0.0 引入企业认证授权和迁移路径。
4. v3.0.0 预留插件化生态架构。

在执行前仍需人工评审优先级和排期，但作为“长期迭代规划包”，结构已完整。
