function expectedTomcatVersion(pom) {
  const source = String(pom).replace(/<!--[\s\S]*?-->/g, '');
  const matches = [...source.matchAll(/<tomcat\.version>\s*([^<]+?)\s*<\/tomcat\.version>/g)];
  if (matches.length !== 1 || !/^10\.1\.[0-9]+$/.test(matches[0][1])
      || Number(matches[0][1].split('.')[2]) < 59) {
    throw new Error('Tomcat安全检查要求唯一的tomcat.version，且为10.1.59或更新的10.1补丁版本');
  }
  return matches[0][1];
}

function tomcatJarCheckScript(version) {
  expectedTomcatVersion(`<tomcat.version>${version}</tomcat.version>`);
  return [
    'set -eu',
    'listing=$(mktemp)',
    `trap 'rm -f "$listing"' EXIT`,
    'jar tf /app/app.jar > "$listing"',
    `test "$(grep -c '^BOOT-INF/lib/tomcat-' "$listing")" -eq 3`,
    ...['core', 'el', 'websocket'].map(component =>
      `test "$(grep -Fxc 'BOOT-INF/lib/tomcat-embed-${component}-${version}.jar' "$listing")" -eq 1`),
    `echo 'tomcat_security_version=PASS version=${version} components=core,el,websocket'`
  ].join('\n');
}

module.exports = {expectedTomcatVersion, tomcatJarCheckScript};
