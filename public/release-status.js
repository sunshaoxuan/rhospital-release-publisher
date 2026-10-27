(function(root){
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date=value=>value?new Date(value).toLocaleString(): '未采样';
  const time=value=>`<time${value?` datetime="${escape(value)}"`:''}>${escape(date(value))}</time>`;
  const identity=(label,value)=>`<label class="outcome-identity"><span>${escape(label)} · 可选中复制</span><input readonly aria-label="${escape(label)}，可选中复制" value="${escape(value||'尚未核实')}"></label>`;
  function supplemental(record,now=Date.now()){
    const evidenceState=record.applicability==='MATCHED'&&now-Date.parse(record.finishedAt)>86400000?'STALE':record.applicability;
    const applicable=evidenceState==='MATCHED';
    const applicability={MATCHED:'部署身份一致',STALE:'验收证据已超过24小时，需复核',DEPLOYMENT_CHANGED:'部署身份已变化，旧证据不适用于当前部署',UNKNOWN:'当前部署身份尚未核实'}[evidenceState]||'证据未核实';
    const checks=record.checks||[],deferred=record.deferred||[];
    return `<div class="supplemental-result">
      <div class="outcome-result-line"><strong>关联补验收：<span class="status-chip ${record.result==='PASS'?'tone-good':'tone-attention'}">${escape(record.result)}${record.result==='PARTIAL'?' · 验收尚未闭合':''}</span></strong></div>
      <p class="outcome-meta">${escape(applicability)} · 验收时间 ${time(record.finishedAt)}</p>
      ${deferred.length?`<div class="outcome-attention">${deferred.map(c=>`<p class="pending-approval">${escape(c.label)}：待批准，未执行。</p>`).join('')}</div>`:''}
      <details class="outcome-details" data-status-detail="${escape('acceptance:'+record.historyId+':'+record.receiptFile)}">
        <summary>查看验收明细 <span>${checks.length} 项已记录${deferred.length?` · ${deferred.length} 项待批准`:''}</span></summary>
        <ul class="outcome-checks">${checks.map(c=>`<li><span>${escape(c.label)}</span><span>${escape(c.result)}${applicable?'':'（历史结果）'}</span></li>`).join('')}${deferred.map(c=>`<li class="pending-approval"><span>${escape(c.label)}：待批准，未执行。${escape(c.reason)}</span></li>`).join('')}</ul>
        ${identity('补验收凭证',record.receiptFile)}
      </details>
      <p class="outcome-note">补验收独立留档，原执行记录保持不变。</p>
    </div>`;
  }
  function markup(data,now=Date.now()){
    const d=data.deployment||{},fresh=d.freshness==='CURRENT'&&now-Date.parse(d.sampledAt)<=120000;
    const health=!d.sampledAt?'尚无已验证健康快照':fresh?(d.healthy?'健康快照':'健康快照未达标'):'旧快照，当前健康未确认';
    const state=d.freshness==='CURRENT'&&!fresh?'采样已过期':({CURRENT:'采样有效',STALE:'采样已过期',UNAVAILABLE:'本次采样失败',UNKNOWN:'尚未采样'}[d.freshness]||'尚未采样');
    const h=data.latestHistory,record=(data.supplemental?.records||[]).find(r=>r.historyId===h?.id);
    const busy=Boolean(data.activity?.busy),tone=fresh?(d.healthy?'tone-good':'tone-alert'):'tone-attention';
    return `<div class="activity-summary ${busy?'activity-busy':'activity-idle'}"><strong>${busy?'发布器有活动任务':'发布器空闲'}</strong><span>${busy?'下方流程用于显示活动任务或准备下一计划。':'无正在执行的流水线。下方流程用于准备下一份计划，未自动执行。'}</span></div>
      <div class="outcome-grid">
        <article class="outcome-card deployment-card"><div class="outcome-card-head"><h3>当前部署</h3><span class="status-chip ${tone}">${escape(state)}</span></div>
          <strong class="outcome-version">${escape(d.image?.split('@')[0]||'尚未核实')}</strong>
          <p class="outcome-health ${tone}">${escape(health)}</p>
          ${d.sampledAt?`<dl class="outcome-facts"><div><dt>快照中的健康副本</dt><dd>${escape(d.healthyCount)}/${escape(d.replicas)}</dd></div><div><dt>Swarm 状态</dt><dd>${escape(d.updateState)}</dd></div></dl>`:''}
          <p class="outcome-meta">采样时间 ${time(d.sampledAt)}</p>
          <p class="outcome-note">健康快照不等于整体验收通过。</p>
          <details class="outcome-details" data-status-detail="${escape('deployment:'+d.image)}"><summary>查看完整部署身份</summary>${identity('完整镜像',d.image)}</details>
        </article>
        <article class="outcome-card history-outcome-card"><div class="outcome-card-head"><h3>最近一次游戏执行记录</h3><span class="outcome-eyebrow">历史记录</span></div>
          ${h?`<div class="outcome-history-line"><strong class="outcome-version">${escape(h.appTag)}</strong><span class="status-chip ${h.status==='EXECUTED'?'tone-good':'tone-attention'}">${escape(h.status)}</span></div>
          <details class="outcome-details history-identity" data-status-detail="${escape('history:'+h.id)}"><summary>查看原执行记录身份</summary>${identity('原记录',h.id)}</details>`:'<p class="outcome-meta">暂无游戏执行历史。</p>'}
          ${record?supplemental(!fresh&&record.applicability==='MATCHED'?{...record,applicability:'UNKNOWN'}:record,now):'<p class="outcome-meta">尚无可关联的有效补验收证据。</p>'}
        </article>
      </div>
      ${data.supplemental?.invalidCount?'<p class="pending-approval outcome-invalid">有无法验证的补验收文件，未纳入结果。</p>':''}`;
  }
  function rememberDetails(container){return new Set(Array.from(container.querySelectorAll('details[data-status-detail][open]'),d=>d.getAttribute('data-status-detail')));}
  function restoreDetails(container,open){for(const detail of container.querySelectorAll('details[data-status-detail]'))if(open.has(detail.getAttribute('data-status-detail')))detail.open=true;}
  function render(container,data,now=Date.now()){const open=rememberDetails(container);container.innerHTML=markup(data,now);restoreDetails(container,open);}
  const api={markup,supplemental,render,rememberDetails,restoreDetails};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ReleaseStatusView=api;
})(typeof window==='undefined'?{}:window);
