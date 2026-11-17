const crypto=require('node:crypto');
const STEP_FIELDS=['key','title','summary','status','actionType','productionAction','executable','finalCheck','recoveryOnly',
 'recoveryBoundary','cutoverCommit','notificationOnly','timeoutSeconds','elapsedMs','durationMs','startedAt','finishedAt'];
function summaryStep(step){
 const result=Object.fromEntries(STEP_FIELDS.filter(key=>Object.hasOwn(step,key)).map(key=>[key,step[key]]));
 result.logCount=Array.isArray(step.logs)?step.logs.length:0;return result;
}
function summaryPlan(plan){return {...plan,detailLevel:'summary',steps:(plan.steps||[]).map(summaryStep)};}
function detailStep(step){const logs=Array.isArray(step.logs)?step.logs:[];return {...step,logs:logs.slice(-500),logCount:logs.length,logsTruncated:logs.length>500};}
function stepByKey(plan,key){
 const step=plan?.steps?.find(step=>step.key===key);
 if(!step){const error=new Error('此步骤已不可用，请刷新计划');error.statusCode=404;throw error;}return step;
}
function projectJob(job,{view='summary',stepKey='',includeLogs=false,revision=0}={}){
 if(!['summary','step'].includes(view)||view==='summary'&&(stepKey||includeLogs))throw new Error('无效的任务查看范围');
 const {logs,plan,...metadata}=job;
 const result={...metadata,viewRevision:revision,plan:plan?summaryPlan(plan):null,logCount:Array.isArray(logs)?logs.length:0};
 if(view==='step')result.stepDetail=detailStep(stepByKey(plan,stepKey));
 if(includeLogs){result.logs=(logs||[]).slice(-500);result.logsTruncated=(logs||[]).length>500;}
 return result;
}
function createPreviewStore({now=Date.now}={}){
 const entries=new Map(),expiry=5*60*1000;
 const purge=()=>{for(const [id,entry] of entries)if(now()-entry.createdAt>=expiry)entries.delete(id);};
 return {
  put(plan){purge();while(entries.size>=4)entries.delete(entries.keys().next().value);
   const id=crypto.randomUUID();entries.set(id,{createdAt:now(),plan:structuredClone(plan)});return {...summaryPlan(plan),previewId:id};},
  step(id,key){purge();const entry=entries.get(id);
   if(!entry){const error=new Error('这份预览已过期，请重新生成发布流程');error.statusCode=410;throw error;}
   return {previewId:id,stepDetail:detailStep(stepByKey(entry.plan,key))};}
 };
}
module.exports={summaryStep,summaryPlan,detailStep,stepByKey,projectJob,createPreviewStore};
