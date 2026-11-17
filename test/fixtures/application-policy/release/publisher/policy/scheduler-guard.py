"""Publisher-side CodeGraph guards. No networking or mutations; caller supplies observations."""
import json
import pathlib
import struct
import sys
import zipfile

EXECUTORS = {"weeklyRewardResetJob", "giftDistributionJob"}

def require(condition, message):
    if not condition:
        raise ValueError(message)

def scheduler(observation):
    require(observation["database"] == "snailjob" and observation["recovery"] is False,
            "unexpected scheduler database identity")
    jobs = observation["jobs"]
    require(all(j["executor_info"] in EXECUTORS for j in jobs), "unexpected executor")
    require(all(j["job_status"] == 0 and isinstance(j["deleted"], int) and j["deleted"] > 0 for j in jobs),
            "retired schedules must already be disabled and archived")
    # Failure is conservative: a failed task may still be eligible for retry. Archive/drain it before release.
    for table, key in (("tasks", "task_status"), ("batches", "task_batch_status")):
        require(all(t[key] in (3, 5, 6) for t in observation[table]), "pending, failed-retry or unknown " + table)
    require(not observation["active_workflows"], "active workflow references a retired executor")
    return {"jobs": len(jobs), "tasks": len(observation["tasks"]), "batches": len(observation["batches"])}

def class_methods(data):
    require(data[:4] == b"\xca\xfe\xba\xbe", "invalid Guild class")
    offset = 8
    def u1():
        nonlocal offset
        value = data[offset]; offset += 1; return value
    def u2():
        nonlocal offset
        value = struct.unpack_from(">H", data, offset)[0]; offset += 2; return value
    def u4():
        nonlocal offset
        value = struct.unpack_from(">I", data, offset)[0]; offset += 4; return value
    pool = [None] * u2()
    index = 1
    while index < len(pool):
        tag = u1()
        if tag == 1:
            size = u2(); pool[index] = data[offset:offset+size].decode("utf-8"); offset += size
        elif tag in (3, 4): offset += 4
        elif tag in (5, 6): offset += 8; index += 1
        elif tag in (7, 8, 16, 19, 20): pool[index] = (tag, u2())
        elif tag in (9, 10, 11, 12, 17, 18): pool[index] = (tag, u2(), u2())
        elif tag == 15: offset += 3
        else: raise ValueError("unknown class constant tag")
        index += 1
    offset += 6
    interfaces = u2()
    offset += 2 * interfaces
    def members():
        nonlocal offset
        found = {}
        for _ in range(u2()):
            u2(); name = pool[u2()]; descriptor = pool[u2()]; attributes = {}
            for _ in range(u2()):
                label = pool[u2()]; size = u4(); attributes[label] = data[offset:offset+size]; offset += size
            found[(name, descriptor)] = attributes
        return found
    members()
    return pool, members()

def preparation_class(data):
    pool, methods = class_methods(data)
    callback = methods.get(("normalizeLegacyStatusBeforeWrite", "()V"), {})
    annotations = callback.get("RuntimeVisibleAnnotations", b"")
    expected = {pool.index("Ljakarta/persistence/PrePersist;"), pool.index("Ljakarta/persistence/PreUpdate;")}
    require(len(annotations) == 10 and struct.unpack_from(">H", annotations)[0] == 2,
            "preparation A persistence callbacks missing")
    require({struct.unpack_from(">H", annotations, p)[0] for p in (2, 6)} == expected,
            "preparation A callback annotations differ")
    attribute = callback.get("Code", b"")
    code = attribute[8:8+struct.unpack_from(">I", attribute, 4)[0]]
    require(len(code) == 15 and code[0:2] == bytes((0x2a, 0xb4)) and code[4] == 0xc7
            and code[7:9] == bytes((0x2a, 0xb2)) and code[11] == 0xb5 and code[14] == 0xb1,
            "preparation A callback does not normalize a null status")
    def field(position):
        ref = pool[struct.unpack_from(">H", code, position)[0]]
        require(ref[0] == 9, "expected field reference")
        owner = pool[pool[ref[1]][1]]
        pair = pool[ref[2]]
        return owner, pool[pair[1]], pool[pair[2]]
    require(field(2) == field(12) == ("com/zly/hospital/model/Guild", "status", "Lcom/zly/hospital/model/enums/GuildStatus;"),
            "preparation A callback status field differs")
    require(field(9) == ("com/zly/hospital/model/enums/GuildStatus", "ACTIVE", "Lcom/zly/hospital/model/enums/GuildStatus;"),
            "preparation A callback default differs")
    require(struct.unpack_from(">h", code, 5)[0] == 10, "preparation A callback branch differs")

def image(jar, phase):
    with zipfile.ZipFile(jar) as archive:
        data = archive.read("BOOT-INF/classes/com/zly/hospital/model/Guild.class")
        if phase == "A":
            preparation_class(data)
        else:
            require(phase in ("B", "compatible"), "unknown phase")
            if phase == "compatible" and "BOOT-INF/classes/codegraph-release-contract.json" not in archive.namelist():
                preparation_class(data)
                return
            contract = json.loads(archive.read("BOOT-INF/classes/codegraph-release-contract.json"))
            require(contract == {"schemaVersion": 1, "phase": "B", "predecessor": "guild-preparation-a-v1",
                    "weeklyExecutorsRetired": ["weeklyRewardResetJob", "giftDistributionJob"],
                    "migration": "scripts/migration/20261025_finalize_guild_status.sql"}, "B contract differs")
            _, methods = class_methods(data)
            require(("normalizeLegacyStatusBeforeWrite", "()V") not in methods, "temporary A callback remains")
            for retired in ("service/WeeklyRewardService", "config/initData/WeeklyRewardConfig",
                            "service/runner/WeeklyRewardResetJobHandler", "service/runner/GiftDistributionJobHandler"):
                require("BOOT-INF/classes/com/zly/hospital/" + retired + ".class" not in archive.namelist(),
                        "retired weekly implementation remains")

if __name__ == "__main__":
    try:
        if sys.argv[1] == "scheduler":
            print("codegraph_scheduler_prerequisites=PASS " + json.dumps(scheduler(json.loads(pathlib.Path(sys.argv[2]).read_text()))))
        elif sys.argv[1] == "image":
            image(sys.argv[2], sys.argv[3]); print("codegraph_image_" + sys.argv[3] + "=PASS")
        else: raise ValueError("unknown guard")
    except (ValueError, KeyError, IndexError, struct.error, OSError, zipfile.BadZipFile) as error:
        sys.exit("CodeGraph prerequisite rejected: " + str(error))
