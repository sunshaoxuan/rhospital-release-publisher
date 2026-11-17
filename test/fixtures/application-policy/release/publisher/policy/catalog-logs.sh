migration_logs_file=$(mktemp)
trap 'rm -f "$migration_logs_file"' EXIT
set +e
timeout 20 docker logs --since "$release_started_at" "$container_id" >"$migration_logs_file" 2>&1
migration_logs_status=$?
set -e
migration_logs_bytes=$(wc -c <"$migration_logs_file")
echo "catalog_log_collection_exit=$migration_logs_status bytes=$migration_logs_bytes"
case "$migration_logs_status" in 0) ;; 124) echo "WARNING: container log collection reached 20 seconds; validating captured output" ;; *) echo "ERROR: container log collection failed with exit $migration_logs_status"; exit 1;; esac
grep -Ei "catalog database upgrade (finished|failed)" "$migration_logs_file" | tail -n 20
if grep -qi "catalog database upgrade failed" "$migration_logs_file"; then echo "ERROR: catalog database upgrade failure detected"; exit 1; fi
grep -q "catalog database upgrade finished outcome=" "$migration_logs_file" || { echo "ERROR: catalog upgrade completion log is missing"; exit 1; }
rm -f "$migration_logs_file"
trap - EXIT
