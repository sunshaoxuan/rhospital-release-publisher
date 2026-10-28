// Remote recovery has its own deadline; losing the local SSH client is not proof
// that a Swarm mutation was cancelled. Retained attempts must never auto-replay.
function supervisedRestore(composeDir, id, body) {
  const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
  return [
    `cd ${quote(composeDir)}`, 'umask 077',
    'command -v timeout >/dev/null', 'command -v flock >/dev/null',
    'mkdir -p .publisher-maintenance',
    'exec 8>.publisher-maintenance/operation.lock',
    'flock -n 8 || { echo "ERROR: Meelok maintenance operation is already running; do not retry"; exit 75; }',
    `state_dir="$PWD/.publisher-maintenance/${id}"`,
    'state_file="$state_dir/restore.state"',
    'if [ -e "$state_file" ]; then',
    '  if [ "$(cat "$state_file")" = VERIFIED ] && [ ! -e .meelok-release-pause ] && [ -s "$state_dir/marker.completed" ] && sha256sum -c "$state_dir/snapshot.sha256" >/dev/null; then echo meelok_restore=ALREADY_VERIFIED; exit 0; fi',
    '  echo "ERROR: prior Meelok recovery outcome requires reconciliation; automatic replay refused"; exit 75',
    'fi',
    'if [ ! -e .meelok-release-pause ]; then echo meelok_restore=NOT_REQUIRED; exit 0; fi',
    'mkdir -p "$state_dir"',
    '[ ! -e "$state_dir/marker.completed" ] || { echo "ERROR: retained terminal evidence without state; do not replay"; exit 75; }',
    'original_marker=$(cat .meelok-release-pause)',
    'printf "ATTEMPTED\\n" > "$state_file.tmp"; mv "$state_file.tmp" "$state_file"',
    'sync -f "$state_file"; sync -f "$state_dir"',
    'echo "meelok_recovery=ATTEMPTED remote_pid=$$ timeout_seconds=2100 assets=RETAINED"',
    'meelok_owned_restore() {', 'set -euo pipefail', ...body, '}',
    'export -f meelok_owned_restore',
    'if timeout --verbose --signal=TERM --kill-after=5s 2100s bash -c meelok_owned_restore </dev/null; then recovery_rc=0; else recovery_rc=$?; fi',
    'if [ "$recovery_rc" -eq 0 ] && [ -s "$state_dir/marker.completed" ] && [ "$(cat "$state_dir/marker.completed")" = "$original_marker" ] && [ ! -e .meelok-release-pause ]; then recovery_state=VERIFIED; sync -f "$state_dir/marker.completed"; else recovery_state=UNKNOWN; [ "$recovery_rc" -ne 0 ] || recovery_rc=76; fi',
    'printf "%s\\n" "$recovery_state" > "$state_file.tmp"; mv "$state_file.tmp" "$state_file"',
    'sync -f "$state_file"; sync -f "$state_dir"',
    'echo "meelok_recovery=$recovery_state exit_code=$recovery_rc assets=RETAINED"',
    'exit "$recovery_rc"'
  ];
}
module.exports = {supervisedRestore};
