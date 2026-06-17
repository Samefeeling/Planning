# Planning
resero-planning/
├── README.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── .env.example                      # SHAREPOINT_SITE_URL, PERSIST_API_URL 等
│
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   │
│   ├── domain/                       # ★ 纯类型 + 业务规则,零依赖,最先让 Claude Code 写
│   │   ├── types.ts                  # Demand, Inventory, BOM, Supply, Machine, Tool, Shift...
│   │   ├── ids.ts                    # branded types: MachineId, ToolId, PartId, JobId
│   │   └── constants.ts              # DIE_CHANGE_MINUTES, color-change 规则等
│   │
│   ├── data/                         # ★ 数据源 adapter 层 (可替换)
│   │   ├── DataSource.ts             # interface: fetchDemand(), fetchInventory()... 统一契约
│   │   ├── excel/
│   │   │   ├── SharePointExcelSource.ts   # 实现 DataSource,用 SheetJS 解析
│   │   │   ├── parsers/               # 每张表一个 parser + 列映射 + 校验
│   │   │   │   ├── demand.parser.ts
│   │   │   │   ├── inventory.parser.ts
│   │   │   │   ├── bom.parser.ts
│   │   │   │   ├── supply.parser.ts
│   │   │   │   ├── machine.parser.ts
│   │   │   │   ├── tool.parser.ts
│   │   │   │   ├── shift.parser.ts
│   │   │   │   ├── machineToTool.parser.ts
│   │   │   │   └── toolToPart.parser.ts
│   │   │   └── sharepoint.client.ts  # 取 SharePoint 文件 (Graph API / 手动上传 fallback)
│   │   └── mock/
│   │       └── MockSource.ts         # 本地假数据,开发/测试用
│   │
│   ├── engine/                       # ★ 排产计算引擎 (纯函数,可单测,前端跑)
│   │   ├── netRequirements.ts        # demand - inventory → 需生产成品
│   │   ├── materialExplosion.ts      # BOM 展开 → 原料需求
│   │   ├── materialAvailability.ts   # 原料 + 在途PO交货期 → 何时可排产
│   │   ├── routing.ts                # part → tool/insert → 可用 machine 解析
│   │   ├── changeover.ts             # 相邻 job 比对 → Die/Tool/Color change 检测
│   │   ├── duration.ts               # Calculated_LaborHrs → 甘特条长度/时间块
│   │   ├── constraints.ts            # machine↔tool↔part↔insert 约束校验
│   │   └── validate.ts               # 拖放后整体校验,返回 warnings[]
│   │
│   ├── store/                        # 状态管理 (Zustand 推荐)
│   │   ├── planStore.ts              # 当前排产计划 (jobs → machine/time 分配)
│   │   ├── dataStore.ts              # 加载的源数据
│   │   └── selectors.ts             # 派生数据 (按机器分组、冲突列表)
│   │
│   ├── persistence/                  # ★ 持久化 adapter (单人,存后端)
│   │   ├── PlanRepository.ts         # interface: save(plan), load(), list()
│   │   └── ApiPlanRepository.ts      # 调你的后端 REST 实现
│   │
│   ├── features/
│   │   ├── gantt/                    # 甘特图主界面
│   │   │   ├── GanttBoard.tsx        # 10 条机器泳道
│   │   │   ├── MachineLane.tsx
│   │   │   ├── JobCard.tsx           # 可拖拽,长度=工时,角标=changeover/缺料
│   │   │   ├── ChangeoverBadge.tsx
│   │   │   ├── MaterialStatusBadge.tsx
│   │   │   └── useDragDrop.ts        # @dnd-kit 封装
│   │   ├── jobpool/                  # 待排产订单池
│   │   │   └── JobPool.tsx
│   │   ├── inspector/                # 选中 job 的详情/校验面板
│   │   │   └── JobInspector.tsx
│   │   └── refresh/                  # 每小时 + 按需刷新
│   │       └── useScheduledRefresh.ts
│   │
│   ├── lib/
│   │   ├── time.ts                   # 工时↔shift 日历换算
│   │   └── result.ts                 # Result<T,E> 错误处理
│   │
│   └── ui/                           # 通用组件 (shadcn/ui)
│
└── tests/
    └── engine/                       # 引擎单测 (这部分最该有测试)
        ├── netRequirements.test.ts
        ├── changeover.test.ts
        └── materialAvailability.test.ts
