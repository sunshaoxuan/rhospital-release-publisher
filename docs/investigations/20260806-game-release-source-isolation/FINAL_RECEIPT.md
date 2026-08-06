# FINAL RECEIPT

task_type: game release source failure investigation and publisher repair

root_cause: 发布器在包含未提交游戏运行文件的开发仓库直接执行源码门禁和构建。

implemented: 每个执行任务使用目标提交的隔离 Git 工作树，任务结束自动清理。

production_change: none

online_game_status: `hospital-backend:20260805`, Swarm completed, HTTP 200

tests: 122 passed, 0 failed

real_rehearsal: target `7d8aeae7`, source gate passed, developer status preserved, isolated worktree removed

rollback: 回退本次发布器提交并重启发布器服务。开发仓库与生产游戏不需要回滚。
