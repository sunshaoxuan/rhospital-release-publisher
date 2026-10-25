import base64
import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("guard", ROOT / "src/codegraphPrerequisites.py")
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
CLASSES = json.loads((ROOT / "test/fixtures/codegraph/guild-classes.json").read_text())

class CodegraphPrerequisitesTest(unittest.TestCase):
    def observation(self):
        return dict(database="snailjob", recovery=False,
                    jobs=[dict(id=873, executor_info="weeklyRewardResetJob", job_status=0, deleted=873)],
                    tasks=[dict(task_status=3)], batches=[dict(task_batch_status=3)], active_workflows=[])

    def test_scheduler_passes_archived_and_drained_or_never_configured(self):
        for status in (3, 5, 6):
            observation = self.observation()
            observation["tasks"][0]["task_status"] = status
            observation["batches"][0]["task_batch_status"] = status
            self.assertEqual(guard.scheduler(observation)["jobs"], 1)
        observation = self.observation(); observation["jobs"] = []
        observation["tasks"] = []; observation["batches"] = []
        self.assertEqual(guard.scheduler(observation)["jobs"], 0)

    def test_scheduler_rejects_unarchived_enabled_workflow_retry_and_unknown(self):
        for location, key, value in (("jobs", "deleted", 0), ("jobs", "job_status", 1),
                                     ("tasks", "task_status", 2), ("tasks", "task_status", 4),
                                     ("tasks", "task_status", 88), ("batches", "task_batch_status", 1),
                                     ("batches", "task_batch_status", 2), ("batches", "task_batch_status", 4)):
            observation = self.observation(); observation[location][0][key] = value
            with self.subTest(location=location, key=key, value=value), self.assertRaises(ValueError):
                guard.scheduler(observation)
        for key, value in (("database", "other"), ("recovery", True), ("active_workflows", [{"id": 4}])):
            observation = self.observation(); observation[key] = value
            with self.assertRaises(ValueError): guard.scheduler(observation)
        observation = self.observation(); del observation["tasks"]
        with self.assertRaises(KeyError): guard.scheduler(observation)

    def test_preparation_A_requires_real_callback_bytecode_and_annotations(self):
        a = base64.b64decode(CLASSES["A"])
        b = base64.b64decode(CLASSES["B"])
        guard.preparation_class(a)
        for candidate in (b, a.replace(b"ACTIVE", b"WRONG!"), a.replace(b"PreUpdate", b"BadUpdate"), b"invalid"):
            with self.assertRaises((ValueError, KeyError)): guard.preparation_class(candidate)

    def test_target_and_rollback_capability(self):
        contract = dict(schemaVersion=1, phase="B", predecessor="guild-preparation-a-v1",
                        weeklyExecutorsRetired=["weeklyRewardResetJob", "giftDistributionJob"],
                        migration="scripts/migration/20261025_finalize_guild_status.sql")
        with tempfile.TemporaryDirectory(dir=ROOT / ".codex-work") as directory:
            jar = pathlib.Path(directory) / "app.jar"
            def write(phase, metadata=None, retired=False):
                with zipfile.ZipFile(jar, "w") as archive:
                    archive.writestr("BOOT-INF/classes/com/zly/hospital/model/Guild.class", base64.b64decode(CLASSES[phase]))
                    if metadata is not None: archive.writestr("BOOT-INF/classes/codegraph-release-contract.json", json.dumps(metadata))
                    if retired: archive.writestr("BOOT-INF/classes/com/zly/hospital/service/WeeklyRewardService.class", b"old")
            write("A"); guard.image(jar, "A"); guard.image(jar, "compatible")
            with self.assertRaises(KeyError): guard.image(jar, "B")
            write("B", contract); guard.image(jar, "B"); guard.image(jar, "compatible")
            with self.assertRaises(ValueError): guard.image(jar, "A")
            write("A", contract)
            with self.assertRaises(ValueError): guard.image(jar, "B")
            write("B", contract, True)
            with self.assertRaises(ValueError): guard.image(jar, "B")
            contract["phase"] = "unknown"; write("B", contract)
            with self.assertRaises(ValueError): guard.image(jar, "B")

if __name__ == "__main__": unittest.main(verbosity=2)
