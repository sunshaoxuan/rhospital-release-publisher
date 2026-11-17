cd {{composeDir}}
service_name={{serviceName}}
container_id=$(docker ps -q --filter "label=com.docker.swarm.service.name=$service_name" --filter health=healthy | head -n 1)
[ -n "$container_id" ] || { echo "ERROR: no healthy target container is available for trade-pool verification"; exit 1; }
{{auditCommand}}
release_started_at=$(cat .last-game-release-start)
{{catalogLogs}}
page_result=$(docker exec "$container_id" curl -sS -o /dev/null -w '%{http_code}|%{redirect_url}' http://127.0.0.1:8090/admin/tradepool)
page_status=${page_result%%|*}
[ "$page_status" = 302 ] || { echo "ERROR: anonymous trade-pool page did not redirect"; exit 1; }
printf "%s\n" "$page_result" | grep -Eq '/login\?redirect=(%2F|/)admin(%2F|/)tradepool' || { echo "ERROR: trade-pool login redirect target is wrong"; exit 1; }
admin_api_result=$(docker exec "$container_id" curl -sS -o /dev/null -w '%{http_code}|%{redirect_url}' http://127.0.0.1:8090/api/admin/toilet-market/pool)
admin_api_status=${admin_api_result%%|*}
case "$admin_api_status" in 302|401|403) ;; *) echo "ERROR: anonymous admin API request was not denied"; exit 1;; esac
if [ "$admin_api_status" = 302 ]; then printf "%s\n" "$admin_api_result" | grep -q '/login' || { echo "ERROR: admin API redirect is not a login redirect"; exit 1; }; fi
echo "tradepool_page=$page_result admin_api=$admin_api_result"
echo 'tradepool_release_validation=PASS'
