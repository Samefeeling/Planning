# 计划板数据与 SharePoint List 建议

以下是基于本分支实现的设计建议，不代表新增 List 已接入。优先补全计划共享、到岗日历和备料闭环，再增加更细的主数据。

## 现有数据的职责和缺口

| 数据 | 职责 | 目前实现 |
| --- | --- | --- |
| Planning1.csv | Epicor 订单、数量、交期、工时、产线 | 读取；交期仍由 Epicor 管理 |
| JobMaterialReq.csv | 每张订单消耗的零件、需求数量、前后工序关联 | 读取；当前没有读取已发料数量、物料行号、单位换算 |
| ASSY_Operator | 人员 ID、姓名、Skills、Position、Supervisor | 读取；可选 OnShift、PlannedLeave，但没有逐日排班记录 |
| ASSY_Production | 每订单每天产出、废品、返工、暂停、实际开工、完工及当班人员快照 | 读取既有行后做差异回写；不是完整的共享计划恢复入口 |
| OPS_PartOnhand.csv（拟新增） | 仓库库存及可用数量 | 尚未接入；PlanningCsvSource 的 inventory、BOM、PO 当前返回空数组 |

ASSY_Production 建议维持“一张订单 × 一个生产日”一行，沿用唯一 RecordKey = JobNum|YYYY-MM-DD；不要把历史当班人员快照改成当前人员分配。具体字段见 [现有 schema](sharepoint-production-schema.md)。

当前未配置 VITE_PERSIST_API_URL 时，完整计划保存在浏览器 localStorage。ASSY_Production 的差异回写并不能自动恢复另一台电脑的拖拽日期、人员时间段、加班批准和产线顺序。需要共享存储适配器，以及重新载入和冲突处理。

## 优先新增的 List

| 优先级 | 建议名称及粒度 | 核心字段 | 用途 |
| --- | --- | --- | --- |
| 1 | ASSY_Plan：每 PlanId × JobNum 一行 | PlanId、JobNum、Line、Sequence、PinnedStart、OvertimeApproved、DoubleBookApproval、Revision、Modified、ModifiedBy | 共享主管的排程决定；CSV 刷新不覆盖手动计划 |
| 1 | ASSY_CrewAssignment：每人员分配时间段一行 | AssignmentId、PlanId、JobNum、OperatorId、FromDay、ToDayExclusive、ApprovedOverlap | 保存临时借人、部分日期参与、调岗和冲突批准；关联 ASSY_Operator 的稳定 ID |
| 1 | ASSY_Attendance：每 OperatorId × Date × Shift 一行 | RecordKey、OperatorId、Date、Shift、Present、AvailableHours、CurrentLine、LeaveReason | 让 Team 的分母、五日人员容量和可分配人员来自真实到岗/请假/培训记录 |
| 2 | ASSY_MaterialPick：每订单物料行 × 仓库/库位/批次一行 | PickKey、JobNum、AssemblySeq、MtlSeq、PartNum、Warehouse、Bin、Lot、UOM、ReservedQty、PickedQty、IssuedQty、Status、ConfirmedBy、ConfirmedAt、SnapshotId | 区分有库存、已预留、已拣、已发料、缺料；支撑开工前备料确认 |
| 2 | ASSY_Calendar：每日期 × 产线 × 班次一行 | Date、Line、Shift、IsWorkingDay、StartTime、EndTime、BreakMinutes、CapacityOverride、Reason | 节假日、停线和加班进入真实可用产能；替代固定周一至周五规则 |

如果初期只想增加两个 List，先做 ASSY_Plan 和 ASSY_Attendance。人数约 15 人时，ASSY_Plan 可以暂存整个订单的 CrewAssignments JSON 时间段数组；以后拆成 ASSY_CrewAssignment 时再迁移。不要同时把两种结构都当作分配数据的权威来源。

CurrentLine 属于当天调度安排，Skills 属于长期能力，两者应分开。小团队可以继续把 Skills 留在 ASSY_Operator。只有需要熟练度、证书有效期或分技能工时系数时，才增加 ASSY_OperatorSkill（OperatorId × SkillCode，含 Level、Efficiency、ValidUntil）。

后续按需增加 ASSY_LineConfig（产线并行工位数、默认班次、生效日），以及 ASSY_PlanChange（排程事件、原因、前后值、操作人）。普通字段修改历史可先使用 SharePoint 版本记录，不必一开始另建完整审计系统。

## 库存 CSV 需要提供什么

OPS_PartOnhand.csv 建议至少包含 Company/Site、PartNum、Warehouse、Bin、Lot（适用时）、UOM、OnHandQty、ReservedQty 或清楚定义的 AvailableQty、QualityHoldQty，以及 SnapshotAt/ExportId。

仓库可拣量不能直接用 OnHandQty：
- 已预留给其他订单、质检冻结和不可拣库位必须排除。
- 若 ERP 已提供净 AvailableQty，不要重复扣减 ReservedQty。
- 多张订单争用同一零件时，必须按订单分配/预留，不能让每张订单都“看到”同一批库存。
- JobMaterialReq 还需要明确 RequiredQty 是订单总需求还是单件用量；单件 QtyPer 必须乘对应订单数量。
- 加入 IssuedQty、AssemblySeq/MtlSeq、UOM，才能计算尚待发料数量并区分同一订单内重复使用的同一零件。
- 已在 ERP 入账的发料、预留和本地拣料记录要用单据 ID/状态对账，避免重复扣库存。
- 物料导出与库存导出应尽量属于同一批快照，过期或缺失数据应显示“未核实”，不能自动标为“备料完成”。

若要预测缺料什么时候解除，还需采购/调拨未到货 CSV（PartNum、Site/Warehouse、OpenQty、ExpectedReceiptDate、单据号和状态）。这类 ERP 事实继续由 CSV/API 同步即可，不必人工维护另一份 List。此前工序生产的组件继续由 JobMaterialReq 的订单关联提供完工约束。

## 接入顺序与验证

1. 接入共享计划的读写恢复；另一个浏览器打开同一 PlanId 必须得到相同安排。
2. 接入逐日到岗；缺勤和请假既不计入 Team 分母，也不提供当天排程容量。
3. 接入库存与物料行，再实现预留/拣料状态；两张订单争抢同一库存必须被识别。
4. 用产线日历替换固定工作周，再扩展技能等级及修改事件。

共享更新需要版本冲突控制，不能默默覆盖另一位主管的修改。Microsoft Graph 更新 listItem 支持 If-Match / eTag，不匹配返回 412；客户端应重新读取并让冲突得到处理。多行人员分配还需按 Revision/完整快照发布，避免读到半更新的计划。[Microsoft Graph 文档](https://learn.microsoft.com/en-us/graph/api/listitem-update?view=graph-rest-1.0)

新增 List 只是数据结构；上述读取、排程约束、界面操作和回写仍需逐项实现。

