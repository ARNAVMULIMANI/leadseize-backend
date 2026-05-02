import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { chat } from '../services/ai';
import { checkAndTriggerHandoff } from '../services/handoff';
import logger from '../lib/logger';

const router = Router();
const BASE_URL = process.env.BASE_URL || 'https://leadseize-backend-production.up.railway.app';

function buildSystemPrompt(agentName: string, businessDescription: string, scrapedContext?: string | null): string {
  return `You are a friendly real estate ISA (Inside Sales Agent) chatting on behalf of ${agentName} via their website chat widget.

Business context: ${businessDescription}
${scrapedContext ? `Additional context: ${scrapedContext}` : ''}

Qualify inbound leads through natural conversation. Follow these rules:
1. Be warm, professional, and conversational. Keep replies to 2-3 short sentences max.
2. Ask ONE qualifying question at a time. Never stack questions.
3. Work through these topics in order: buying/selling/both → area/neighborhood → budget → timeline → pre-approved (if buying).
4. Once all topics are covered, let them know a team member will follow up personally.
5. Never reveal you are an AI. If asked directly, say you're a member of the ${agentName} team.
6. Never discuss commission, fees, or make specific property recommendations.`;
}

router.get('/:agentId/script', async (req: Request<{ agentId: string }>, res: Response, next: NextFunction) => {
  try {
    const { agentId } = req.params;
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });

    if (!agent) {
      res.status(404).type('application/javascript').send('// LeadSeize: agent not found');
      return;
    }

    res
      .type('application/javascript')
      .set('Cache-Control', 'public, max-age=3600')
      .send(generateWidgetScript(agentId, agent.name, BASE_URL));
  } catch (err) {
    next(err);
  }
});

router.post('/:agentId/message', async (req: Request<{ agentId: string }>, res: Response, next: NextFunction) => {
  try {
    const { agentId } = req.params;
    const { message, sessionId } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'message is required' });
      return;
    }
    if (!sessionId || typeof sessionId !== 'string') {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const fromNumber = `webchat_${sessionId}`;

    let lead = await prisma.lead.findFirst({
      where: { fromNumber, agentId },
      orderBy: { createdAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });

    if (!lead) {
      const created = await prisma.lead.create({
        data: { agentId, channel: 'webchat', fromNumber },
      });
      lead = await prisma.lead.findUniqueOrThrow({
        where: { id: created.id },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
    }

    await prisma.message.create({
      data: { leadId: lead.id, role: 'lead', content: message.trim() },
    });

    const history = lead.messages.map((m) => ({
      role: m.role === 'lead' ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));
    history.push({ role: 'user', content: message.trim() });

    const systemPrompt = buildSystemPrompt(agent.name, agent.businessDescription, agent.scrapedContext);
    const reply = await chat([{ role: 'system', content: systemPrompt }, ...history]);

    await Promise.all([
      prisma.message.create({ data: { leadId: lead.id, role: 'ai', content: reply } }),
      prisma.lead.update({ where: { id: lead.id }, data: { lastMessageAt: new Date() } }),
    ]);

    checkAndTriggerHandoff(lead.id).catch((err) =>
      logger.error('[Widget] Handoff check failed', { leadId: lead!.id, err })
    );

    res.json({ reply });
  } catch (err) {
    next(err);
  }
});

function generateWidgetScript(agentId: string, agentName: string, baseUrl: string): string {
  const escapedName = agentName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const initial = agentName.charAt(0).toUpperCase();

  return `(function(){
'use strict';
var AID='${agentId}',ANAME='${escapedName}',BASE='${baseUrl}';
var SK='ls_'+AID,HK=SK+'_h';
var sid='';
try{sid=localStorage.getItem(SK)||'';if(!sid){sid='wc_'+Date.now().toString(36)+'_'+Math.random().toString(36).substr(2,8);localStorage.setItem(SK,sid);}}catch(e){sid='wc_'+Date.now().toString(36)+'_'+Math.random().toString(36).substr(2,8);}
var hist=[];try{hist=JSON.parse(localStorage.getItem(HK)||'[]');}catch(e){hist=[];}
var st=document.createElement('style');
st.textContent='#ls-btn{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:#2563eb;cursor:pointer;z-index:2147483647;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(37,99,235,.5);transition:transform .15s,box-shadow .15s;border:none;outline:none}'
+'#ls-btn:hover{transform:scale(1.1);box-shadow:0 6px 28px rgba(37,99,235,.65)}'
+'#ls-win{position:fixed;bottom:92px;right:24px;width:360px;height:520px;background:#0f172a;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.6);display:none;flex-direction:column;overflow:hidden;z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}'
+'#ls-hdr{background:#1e293b;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #334155;flex-shrink:0}'
+'#ls-hdr-l{display:flex;align-items:center;gap:10px}'
+'#ls-av{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#fff;flex-shrink:0}'
+'#ls-hdr-name{color:#f1f5f9;font-size:14px;font-weight:600;line-height:1.2;margin:0}'
+'#ls-hdr-status{color:#4ade80;font-size:11px;font-weight:500;margin:2px 0 0}'
+'#ls-x{background:none;border:none;cursor:pointer;color:#64748b;font-size:22px;line-height:1;padding:2px 6px;border-radius:6px;transition:color .15s;outline:none}'
+'#ls-x:hover{color:#f1f5f9}'
+'#ls-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}'
+'#ls-msgs::-webkit-scrollbar{width:4px}#ls-msgs::-webkit-scrollbar-track{background:transparent}#ls-msgs::-webkit-scrollbar-thumb{background:#334155;border-radius:2px}'
+'.ls-m{max-width:84%;padding:10px 14px;border-radius:12px;font-size:13.5px;line-height:1.55;word-break:break-word}'
+'.ls-ai{background:#1e293b;color:#cbd5e1;border-bottom-left-radius:3px;align-self:flex-start}'
+'.ls-usr{background:#2563eb;color:#fff;border-bottom-right-radius:3px;align-self:flex-end}'
+'.ls-dot{display:flex;gap:5px;align-items:center;padding:12px 14px}'
+'.ls-dot span{width:7px;height:7px;border-radius:50%;background:#475569;animation:ls-b 1.2s infinite}'
+'.ls-dot span:nth-child(2){animation-delay:.2s}.ls-dot span:nth-child(3){animation-delay:.4s}'
+'@keyframes ls-b{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}'
+'#ls-foot{padding:12px;border-top:1px solid #1e293b;display:flex;gap:8px;flex-shrink:0;background:#0f172a}'
+'#ls-inp{flex:1;background:#1e293b;border:1.5px solid #334155;border-radius:10px;padding:10px 14px;color:#f1f5f9;font-size:13.5px;outline:none;transition:border-color .15s;font-family:inherit}'
+'#ls-inp::placeholder{color:#475569}#ls-inp:focus{border-color:#3b82f6}'
+'#ls-snd{background:#2563eb;border:none;border-radius:10px;padding:10px 16px;cursor:pointer;color:#fff;font-size:13px;font-weight:600;transition:background .15s;white-space:nowrap;font-family:inherit;outline:none}'
+'#ls-snd:hover{background:#1d4ed8}#ls-snd:disabled{background:#1e3a5f;cursor:not-allowed}';
document.head.appendChild(st);
var btn=document.createElement('button');
btn.id='ls-btn';btn.setAttribute('aria-label','Chat with us');
btn.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var win=document.createElement('div');win.id='ls-win';
win.innerHTML='<div id="ls-hdr"><div id="ls-hdr-l"><div id="ls-av">${initial}</div><div><p id="ls-hdr-name">'+esc(ANAME)+'</p><p id="ls-hdr-status">&#9679; Online now</p></div></div><button id="ls-x" aria-label="Close">&#215;</button></div>'
+'<div id="ls-msgs"></div>'
+'<div id="ls-foot"><input id="ls-inp" type="text" placeholder="Ask a question…" autocomplete="off"/><button id="ls-snd">Send</button></div>';
document.body.appendChild(btn);document.body.appendChild(win);
var mc=win.querySelector('#ls-msgs'),inp=win.querySelector('#ls-inp'),snd=win.querySelector('#ls-snd');
var open=false,busy=false;
hist.forEach(function(m){addMsg(m.r,m.c,false);});
if(hist.length===0){addMsg('ai','Hi there! I\\'m here to help with any real estate questions. Are you looking to buy, sell, or both?',false);}
btn.addEventListener('click',function(){open=!open;win.style.display=open?'flex':'none';if(open){inp.focus();scroll();}});
win.querySelector('#ls-x').addEventListener('click',function(){open=false;win.style.display='none';});
snd.addEventListener('click',send);
inp.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
function send(){
  if(busy)return;
  var txt=inp.value.trim();if(!txt)return;
  inp.value='';
  addMsg('usr',txt,true);
  busy=true;snd.disabled=true;
  var t=addDots();
  fetch(BASE+'/widget/'+AID+'/message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:txt,sessionId:sid})})
  .then(function(r){if(!r.ok)throw new Error(''+r.status);return r.json();})
  .then(function(d){t.remove();addMsg('ai',d.reply,true);})
  .catch(function(){t.remove();addMsg('ai','Sorry, something went wrong. Please try again in a moment.',false);})
  .finally(function(){busy=false;snd.disabled=false;inp.focus();});
}
function addMsg(role,text,save){
  var d=document.createElement('div');
  d.className='ls-m '+(role==='usr'||role==='user'?'ls-usr':'ls-ai');
  d.textContent=text;
  mc.appendChild(d);scroll();
  if(save){hist.push({r:role,c:text});if(hist.length>100)hist=hist.slice(-100);try{localStorage.setItem(HK,JSON.stringify(hist));}catch(e){}}
  return d;
}
function addDots(){
  var d=document.createElement('div');d.className='ls-m ls-ai ls-dot';
  d.innerHTML='<span></span><span></span><span></span>';
  mc.appendChild(d);scroll();return d;
}
function scroll(){mc.scrollTop=mc.scrollHeight;}
function esc(s){return s.replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
})();`;
}

export default router;
