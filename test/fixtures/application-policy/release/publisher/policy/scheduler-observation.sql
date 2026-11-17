BEGIN READ ONLY;
SELECT json_build_object('database',current_database(),'recovery',pg_is_in_recovery(),
'jobs',coalesce((SELECT json_agg(to_jsonb(j) ORDER BY j.id) FROM sj_job j WHERE j.executor_info IN ({{executors}})),'[]'),
'tasks',coalesce((SELECT json_agg(json_build_object('id',t.id,'job_id',t.job_id,'task_status',t.task_status,'retry_count',t.retry_count)) FROM sj_job_task t JOIN sj_job j ON j.id=t.job_id WHERE j.executor_info IN ({{executors}})),'[]'),
'batches',coalesce((SELECT json_agg(json_build_object('id',t.id,'job_id',t.job_id,'task_batch_status',t.task_batch_status)) FROM sj_job_task_batch t JOIN sj_job j ON j.id=t.job_id WHERE j.executor_info IN ({{executors}})),'[]'),
'active_workflows',coalesce((SELECT json_agg(to_jsonb(w)) FROM sj_workflow w WHERE w.deleted=0 AND w.workflow_status=1 AND
({{workflowPredicate}} OR EXISTS
(SELECT 1 FROM sj_workflow_node n JOIN sj_job j ON j.id=n.job_id WHERE n.workflow_id=w.id AND n.workflow_node_status=1 AND j.executor_info IN ({{executors}})))),'[]'));
ROLLBACK;
