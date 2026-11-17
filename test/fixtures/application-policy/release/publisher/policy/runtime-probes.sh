stripe_code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8190/api/payment/webhook -H 'Content-Type: application/json' --data '{}')
paddle_code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8190/api/paddle/webhook -H 'Content-Type: application/json' --data '{}')
echo "$stripe_code" | grep -Eq '^(400|401|403)$'
echo "$paddle_code" | grep -Eq '^(400|401|403)$'
docker ps --format '{{.Names}}' | grep -Fxq snail-job
docker ps --format '{{.Names}}' | grep -Eq 'newrelic|new-relic'
echo game_prd2_runtime_contract=PASS stripe_unsigned=$stripe_code paddle_unsigned=$paddle_code
