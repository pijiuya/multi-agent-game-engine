# Agent 动作扩展使用手册

本文面向希望通过 LLM 或 vibe coding 编写新动作的用户。你可以把自己写好的动作算法粘贴到「高级设置 / 动作扩展」窗口中，让系统自动检查动作是否可靠，再决定是否启用。

## 1. 这个功能解决什么问题

默认情况下，agent 只能执行内置动作，例如移动、说话、观察、互动、等待。如果你的场景需要新的行为，例如：

- 摧毁某个物体
- 修理某个设施
- 给另一个 agent 物品
- 改变区域状态
- 触发一个剧情事件

就可以通过动作扩展添加新的动作。

动作扩展的目标不是让 LLM 随意修改世界，而是让用户定义一个受控动作。LLM 只能提出动作请求，系统会先检查动作是否合法，然后再执行。

## 2. 推荐使用流程

1. 在高级设置中打开「动作扩展」。
2. 选择「新建动作」。
3. 描述你想要的动作，例如「让 agent 可以摧毁附近的 item」。
4. 使用 LLM 或 vibe coding 生成动作代码。
5. 将代码粘贴到动作编辑窗口。
6. 点击「检查动作」。
7. 根据系统指出的问题修改代码。
8. 检查通过后点击「启用动作」。
9. 在 agent 的动作空间中勾选这个新动作。
10. 启动模拟，让 agent 在合适的情境中使用它。

## 3. 动作扩展的基本结构

每个动作必须包含四部分：

- `ACTION`：动作的元数据，告诉系统这个动作叫什么、需要什么参数。
- `validate(world, agent_id, payload)`：检查动作是否合法。
- `apply(world, agent_id, payload)`：真正执行动作。
- 返回事件：告诉前端和日志发生了什么。

最小结构如下：

```python
ACTION = {
    "type": "destroy_item",
    "description": "Destroy an item near the agent.",
    "payload_schema": {
        "target_id": "string"
    },
    "permissions": ["world.items.delete"]
}


def validate(world, agent_id, payload):
    return True, "ok"


def apply(world, agent_id, payload):
    return {
        "event_type": "action",
        "message": "action applied",
        "payload": payload
    }
```

## 4. 字段说明

### ACTION.type

动作的唯一名称。建议使用小写英文和下划线。

好的例子：

```python
"destroy_item"
"repair_item"
"give_item"
"open_door"
```

不推荐：

```python
"Destroy Item"
"摧毁物品"
"delete"
```

### ACTION.description

给 LLM 和用户看的动作说明。写清楚动作什么时候应该使用。

例如：

```python
"Destroy a nearby item when the agent has permission and the item is within range."
```

### ACTION.payload_schema

声明动作需要哪些参数。系统会用它检查 LLM 返回的 JSON 是否完整。

例如：

```python
"payload_schema": {
    "target_id": "string",
    "reason": "string"
}
```

LLM 应该返回：

```json
{
  "type": "destroy_item",
  "payload": {
    "target_id": "item_box_001",
    "reason": "The box blocks the path."
  }
}
```

### ACTION.permissions

声明动作需要哪些权限。权限用于提醒用户这个动作会改变什么。

常见权限建议：

```python
"world.items.read"
"world.items.update"
"world.items.delete"
"world.agents.update"
"world.events.create"
"world.map.update"
```

危险权限，例如删除物品、修改地图、批量修改 agent，应该在 UI 中显示为高风险。

## 5. validate 函数怎么写

`validate` 只负责检查，不应该修改世界。

它必须返回：

```python
return True, "ok"
```

或者：

```python
return False, "失败原因"
```

典型检查包括：

- 参数是否存在
- 目标 item 是否存在
- agent 是否存在
- 距离是否足够近
- 目标是否处于允许状态
- agent 是否有对应能力
- 动作是否会破坏核心规则

## 6. apply 函数怎么写

`apply` 负责真正修改世界。它只会在 `validate` 通过后运行。

它应该返回一个事件对象：

```python
return {
    "event_type": "action",
    "message": "Mira destroyed Wooden Box.",
    "payload": {
        "target_id": "item_box_001"
    }
}
```

系统会把这个事件写入事件日志，前端也可以显示它。

## 7. 完整例子：摧毁附近物品

下面是一个 `destroy_item` 动作。它要求目标物品存在，并且 agent 距离目标物品不超过 120。

```python
from math import hypot


ACTION = {
    "type": "destroy_item",
    "description": "Destroy a nearby item. Use only when the item blocks the agent or the scene logic allows it.",
    "payload_schema": {
        "target_id": "string"
    },
    "permissions": ["world.items.read", "world.items.delete", "world.events.create"]
}


def validate(world, agent_id, payload):
    target_id = str(payload.get("target_id", "")).strip()
    if not target_id:
        return False, "target_id is required"

    agent_state = world.agent_states.get(agent_id)
    if agent_state is None:
        return False, "agent not found"

    item = world.map.item_by_id(target_id)
    if item is None:
        return False, "target item not found"

    distance = hypot(
        agent_state.position.x - item.position.x,
        agent_state.position.y - item.position.y
    )
    if distance > 120:
        return False, "target item is out of range"

    if item.state.get("indestructible"):
        return False, "target item is indestructible"

    return True, "ok"


def apply(world, agent_id, payload):
    target_id = str(payload["target_id"])
    profile = world.agent_profiles[agent_id]
    item = world.map.item_by_id(target_id)
    item_name = item.name if item else target_id

    world.map.items = [
        existing_item
        for existing_item in world.map.items
        if existing_item.id != target_id
    ]

    return {
        "event_type": "action",
        "message": f"{profile.name} destroyed {item_name}.",
        "payload": {
            "target_id": target_id,
            "item_name": item_name
        }
    }
```

## 8. 系统会自动检查什么

点击「检查动作」后，系统应该至少检查这些内容：

- 是否定义了 `ACTION`
- `ACTION.type` 是否唯一
- `ACTION.type` 是否只包含小写字母、数字和下划线
- 是否定义了 `validate`
- 是否定义了 `apply`
- `validate` 是否只做检查，没有修改世界
- `apply` 是否返回事件对象
- `payload_schema` 是否和代码中使用的字段一致
- 是否声明了必要权限
- 是否使用了危险 API
- 是否可能访问本地文件、网络、系统命令或环境变量
- 是否可能无限循环
- 是否可能批量删除或批量修改世界对象

检查结果应该明确指出问题位置和修改建议。

例如：

```text
问题：apply 函数直接清空了 world.map.items。
风险：这会删除所有物品，而不是只删除目标物品。
建议：只删除 payload.target_id 对应的 item。
```

## 9. 不允许或高风险的写法

普通动作扩展不应该使用这些能力：

```python
import os
import subprocess
import socket
import requests
eval(...)
exec(...)
open(...)
while True:
```

原因是动作扩展应该只影响模拟世界，不应该访问用户电脑、启动系统命令、读取本地文件或访问网络。

如果确实需要这些能力，应该放到单独的可信插件系统中，并在 UI 中明确标记为「本地高权限扩展」。

## 10. 给 vibe coding 的提示词模板

你可以把下面这段发给 LLM，让它帮你生成动作：

```text
请为我的多 agent 模拟引擎写一个 Python 动作扩展。

要求：
- 必须定义 ACTION、validate(world, agent_id, payload)、apply(world, agent_id, payload)。
- LLM 只能通过 payload 提供参数。
- validate 只能检查，不能修改 world。
- apply 只能在 validate 通过后修改 world。
- 不要使用 os、subprocess、socket、requests、eval、exec、open。
- 不要无限循环。
- 返回事件对象，包含 event_type、message、payload。
- 如果目标不存在、距离太远或参数缺失，validate 要返回 False 和清楚原因。

我要实现的动作是：
【在这里写你的动作需求】
```

## 11. 好动作和坏动作的区别

好动作：

- 动作名称明确
- 参数少而清楚
- validate 覆盖失败情况
- apply 修改范围小
- 返回可读事件
- 不访问模拟世界以外的资源

坏动作：

- 直接让 LLM 传 Python 代码并执行
- 没有 validate
- 一次修改大量对象
- 失败时静默忽略
- 使用本地文件、网络或系统命令
- 动作效果和 description 不一致

## 12. 给产品界面的建议

动作扩展窗口建议包含这些区域：

- 动作名称
- 动作说明
- 代码编辑器
- 检查按钮
- 检查结果
- 权限列表
- 测试 payload
- 启用/停用开关
- agent 动作空间选择

检查结果最好按严重程度显示：

- 阻止启用：缺少 `validate`、缺少 `apply`、语法错误、危险系统调用
- 高风险：删除或批量修改世界对象、权限声明不足
- 建议修改：说明不清楚、事件消息不可读、payload_schema 不完整

## 13. 和 LLM 控制 agent 的关系

动作启用后，系统会把动作定义加入 agent 的可用动作空间。LLM 看到的是动作说明和参数结构，不会看到完整 Python 代码。

例如 LLM 只需要知道：

```json
{
  "type": "destroy_item",
  "description": "Destroy a nearby item.",
  "payload_schema": {
    "target_id": "string"
  }
}
```

当 LLM 选择这个动作时，仍然必须经过 `validate` 和规则系统。这样即使 LLM 选择了错误目标，动作也会被拒绝，而不是破坏世界。

## 14. MVP 实现建议

第一版可以先支持本地可信用户：

- 用户在 UI 中粘贴 Python 动作代码
- 后端保存到 `runtime_project/actions/`
- 点击检查时做静态检查和一次沙盒测试
- 检查通过后注册到动作表
- agent 的 `action_space` 可以选择启用哪些动作

第一版不要支持远程用户上传任意 Python 后直接执行。如果未来要开放给多人或云端用户，应改成受限 DSL、子进程沙箱或隔离容器。

## 15. 最重要的设计原则

动作扩展应该遵守一句话：

LLM 提议动作，扩展定义动作，规则系统批准动作，世界状态只由受控执行器修改。

这样用户可以不断增加 agent 的能力，同时不会让一个错误的模型输出或一段不可靠的 vibe coding 代码直接破坏整个模拟世界。
