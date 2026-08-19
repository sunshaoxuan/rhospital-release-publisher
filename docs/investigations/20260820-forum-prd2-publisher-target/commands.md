# 命令记录

以下命令均为只读检查、测试、Git 提交或 dry run 计划生成。

```powershell
git -C C:\workspace\hospital-backend diff --name-status e7b67154625f4ec1021c82c01067c14a9c516f47..d2fd6f033fd3b262b6c87b08c9065f2cd43b4337 -- integrations/flarum
git -C C:\workspace\hospital-backend show 63de6fce -- integrations/flarum
ssh -o BatchMode=yes -i C:\workspace\Secure\sunsxaws.pem root@92.113.124.185 "hostname; ...; docker compose ps --format json"
npm test
Invoke-RestMethod http://127.0.0.1:8794/api/config?releaseTarget=forum
Invoke-RestMethod http://127.0.0.1:8794/api/remote-tag?releaseTarget=forum...
Invoke-RestMethod http://127.0.0.1:8794/api/plan -Method Post -Body <forum-dry-run-request>
git push origin main
```

生产动作状态：未执行。
