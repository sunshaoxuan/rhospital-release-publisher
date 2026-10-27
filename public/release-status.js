(function(root){
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=value=>value?new Date(value).toLocaleString(): '未采样';
  function supplemental(record,now=Date.now()){
    const evidenceState=record.applicability==='MATCHED'&&now-Date.parse(record.finishedAt)>86400000?'STALE':record.applicability;
    const applicable=evidenceState==='MATCHED';
    const applicability={MATCHED:'部署身份一致',STALE:'验收证据已超过24小时，需复核',DEPLOYMENT_CHANGED:'部署身份已变化，旧证据不适用于当前部署',UNKNOWN:'当前部署身份尚未核实'}[evidenceState]||'证据未核实';
    return `<div class="supplemental-result"><strong>关联补验收：${escape(record.result)}${record.result==='PARTIAL'?' · 验收尚未闭合':''}</strong>
      <p>${escape(applicability)} · 验收时间 ${escape(date(record.finishedAt))}</p>
      <ul>${record.checks.map(c=>`<li>${escape(c.label)}：${escape(c.result)}${applicable?'':'（历史结果）'}</li>`).join('')}${record.deferred.map(c=>`<li class="pending-approval">${escape(c.label)}：待批准，未执行。${escape(c.reason)}</li>`).join('')}</ul>
      <small>补验收独立留档，原执行记录保持不变。凭证 ${escape(record.receiptFile)}</small></div>`;
  }
  function markup(data,now=Date.now()){
    const d=data.deployment||{},fresh=d.freshness==='CURRENT'&&now-Date.parse(d.sampledAt)<=120000;
    const health=!d.sampledAt?'尚无已验证健康快照':fresh?(d.healthy?'健康快照':'健康快照未达标'):'旧快照，当前健康未确认';
    const state=d.freshness==='CURRENT'&&!fresh?'采样已过期':({CURRENT:'采样有效',STALE:'采样已过期',UNAVAILABLE:'本次采样失败',UNKNOWN:'尚未采样'}[d.freshness]||'尚未采样');
    const h=data.latestHistory,record=(data.supplemental?.records||[]).find(r=>r.historyId===h?.id);
    return `<p class="activity-summary">${data.activity?.busy?'发布器有活动任务':'发布器空闲，无正在执行的流水线'}。下方流程用于${data.activity?.busy?'显示活动任务或准备下一计划':'准备下一份计划，未自动执行'}。</p>
      <div class="outcome-grid"><article><h3>当前部署</h3><strong>${escape(d.image||'尚未核实')}</strong>
      <p>${escape(health)}${d.sampledAt?`：${escape(d.healthyCount)}/${escape(d.replicas)} 健康副本 · Swarm ${escape(d.updateState)}`:''}</p>
      <small>${escape(state)} · 采样时间 ${escape(date(d.sampledAt))}。健康快照不等于整体验收通过。</small></article>
      <article><h3>最近一次游戏执行记录</h3>${h?`<strong>${escape(h.appTag)} · ${escape(h.status)}</strong><p>原记录 ${escape(h.id)}</p>`:'<p>暂无游戏执行历史。</p>'}
      ${record?supplemental(!fresh&&record.applicability==='MATCHED'?{...record,applicability:'UNKNOWN'}:record,now):'<p>尚无可关联的有效补验收证据。</p>'}</article></div>
      ${data.supplemental?.invalidCount?'<p class="pending-approval">有无法验证的补验收文件，未纳入结果。</p>':''}`;
  }
  const api={markup,supplemental};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ReleaseStatusView=api;
})(typeof window==='undefined'?{}:window);
