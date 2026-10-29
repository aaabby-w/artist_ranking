// Private inbox and first-visit walkthrough. All writes use self-scoped RPCs.
let inboxRows = [], inboxOwner = null, inboxBusy = false, tourOpen = false;
function renderInbox() {
  let b=document.querySelector('#inbox');
  if(!b){b=document.createElement('button');b.id='inbox';b.className='inbox-button';document.querySelector('header > div').prepend(b);b.onclick=openInbox;}
  b.hidden=!user;const unread=inboxOwner===user?.id?inboxRows.filter(n=>!n.read_at).length:0;
  b.classList.toggle('has-unread',unread>0);b.setAttribute('aria-label',`通知，${unread}条未读`);
  b.innerHTML=`<span aria-hidden="true">✉</span>${unread?'<i aria-hidden="true"></i>':''}`;
}
async function refreshInbox(){
 if(demo||!user){inboxRows=[];inboxOwner=null;renderInbox();return;}
 const owner=user.id;const r=await client.from('guild_notifications').select('*').order('created_at',{ascending:false}).limit(100);
 if(owner!==user?.id||r.error)return;
 inboxRows=r.data||[];inboxOwner=owner;renderInbox();
 if(profile?.role==='artist'&&!profile.onboarding_done&&!tourOpen&&!document.querySelector('#dialog').open){tourOpen=true;showTour(0);}
}
function openInbox(){
 modal('你的信箱 ✉',inboxRows.length?inboxRows.map(n=>`<article class="submission"><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small>${esc(new Date(n.created_at).toLocaleString('zh-CN'))}</small><div class="actions">${n.task_id?`<button data-inbox-task="${esc(n.task_id)}">查看任务</button>`:''}${!n.read_at?`<button data-read-note="${esc(n.id)}">标记已读</button>`:''}</div></article>`).join(''):'<p>还没有新消息，安心画画吧 (｡･ω･｡)</p>');
 document.querySelectorAll('[data-read-note]').forEach(b=>b.onclick=async()=>{if(inboxBusy)return;inboxBusy=true;try{const r=await client.rpc('guild_read_notification',{p_id:b.dataset.readNote});if(r.error)throw r.error;await refreshInbox();openInbox();}catch(e){error(e)}finally{inboxBusy=false}});
 document.querySelectorAll('[data-inbox-task]').forEach(b=>b.onclick=()=>detail(b.dataset.inboxTask));
}
function showTour(step){
 const steps=[['欢迎来到会馆','这是给你的第一封站内欢迎信。先用原表或群里熟悉的昵称登记，方便大家认出你。'],['任务公告栏','这里可以看交付要求、分值和截止日期。开通后，可认领仍开放的任务。'],['我的画桌','认领或由负责人分配的任务都在这里。上传 PNG、JPG 或 WebP 后提交验收，打回时查看修改意见再提交。'],['稿件展示与贡献榜','验收通过的作品会展示，贡献按验收记录统计。历史稿件由负责人补传，原表署名需核对后连接账号。'],['信箱与奖励','右上角信封有红点并轻晃时，表示有新通知。100 元是本期美术组专项奖励，并列第一均分。']];
 const [title,body]=steps[step];modal(`${step+1} / ${steps.length} · ${title}`,`<p class="detail-copy">${esc(body)}</p><div class="actions"><button id="tour-next" class="primary">${step===steps.length-1?'我知道啦，开始逛逛':'下一步'}</button><button id="tour-skip">稍后再看</button></div>`);
 document.querySelector('#tour-next').onclick=async()=>{if(step<steps.length-1)return showTour(step+1);const r=await client.rpc('guild_finish_onboarding');if(r.error)return error(r.error);profile.onboarding_done=true;document.querySelector('#dialog').close();};
 document.querySelector('#tour-skip').onclick=()=>document.querySelector('#dialog').close();
}
