const express = require('express');
const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const INTERCOM_ACCESS_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
const INTERCOM_BOT_ADMIN_ID = process.env.INTERCOM_BOT_ADMIN_ID;

const SYSTEM_PROMPT = `You are a senior customer support agent at iSpeedToLead. You write warm, clear, empathetic replies that sound human.

iSpeedToLead is the #1 marketplace for motivated real estate leads. Customers buy property leads, use Coupon Club memberships, and purchase packages with balance, Premium, DealSpeed, or free lead packs.

VOICE: Warm, empathetic, calm, professional. Always "we" not "I". Sign off: "Warm regards, [Name], iSpeedToLead Support Team"

POLICIES:
- Lead refunds: proof optional; with proof 24h, without 2-5 business days; team may warm transfer
- Balance refunds: must go through https://app.ispeedtolead.com/issue/create
- Duplicate charge: can refund to card. Renewal charge: NOT refund-to-card - offer balance/extension/bonus credits
- Missing package items: acknowledge, never promise release date, offer bonus credits
- Cancellation: account settings or https://app.ispeedtolead.com/issue/create

RULES: Never promise fix dates. Reply body only. Always "we".`;

const QUICK_PROMPTS = {
  q_lead_refund:  'Customer requesting refund for bad lead. Proof optional but speeds review. With proof: 24 hours. Without: 2-5 business days. Team may call lead and attempt warm transfer.',
  q_lead_quality: 'Customer unhappy with lead quality. Acknowledge empathetically. Explain review process and offer to investigate.',
  q_duplicate:    'Customer disputing duplicate charge. Duplicate charges can be reviewed and refunded to card. Apologize and explain next steps.',
  q_renewal:      'Customer complaining about renewal charge. Renewal charges not refund-to-card. Offer account balance, service extension, or bonus credits.',
  q_cancel:       'Customer wants to cancel. Two ways: account settings subscription section, or submit ticket at https://app.ispeedtolead.com/issue/create.',
  q_missing:      'Customer cannot find a deliverable from their package. Acknowledge, explain still being finalized, do NOT promise release date, offer bonus credits.',
  q_resolved:     'Confirm issue resolved. Thank customer for patience. Mention they will receive a CSAT survey. Close warmly.',
};

// ── Canvas helpers ────────────────────────────────────────────────────────────
function canvas(components, stored) {
  return { canvas: { content: { components }, stored_data: stored || {} } };
}
function t(text, style) { const c = { type: 'text', text: String(text) }; if (style) c.style = style; return c; }
function b(id, label, style) { return { type: 'button', id, label, style: style || 'primary', action: { type: 'submit' } }; }
function inp(id, label, placeholder) { return { type: 'input', id, label, placeholder: placeholder || '', save_state: 'unsaved' }; }
function sp() { return { type: 'spacer', size: 's' }; }
function dv() { return { type: 'divider' }; }

function homeScreen(lastMsg, urgency, stored) {
  const c = [];
  c.push(t('AI Reply Assistant', 'header'));
  c.push(dv());
  if (urgency === 'high')   { c.push(t('🔴 High urgency — handle with priority')); c.push(sp()); }
  if (urgency === 'medium') { c.push(t('🟡 Moderate urgency — extra empathy needed')); c.push(sp()); }
  if (lastMsg) {
    c.push(t('Customer message:', 'header'));
    c.push(t(lastMsg.slice(0, 180) + (lastMsg.length > 180 ? '...' : ''), 'muted'));
    c.push(sp());
    c.push(dv());
  }
  c.push(t('Quick actions', 'header'));
  c.push(sp());
  c.push({
    type: 'button-list',
    items: [
      { type: 'item', id: 'q_lead_refund',  title: '🔄 Lead refund request',    subtitle: 'Proof optional · 24h or 2-5 days',         action: { type: 'submit' } },
      { type: 'item', id: 'q_lead_quality', title: '⚠️ Lead quality concern',    subtitle: 'Acknowledge and investigate',              action: { type: 'submit' } },
      { type: 'item', id: 'q_duplicate',    title: '💳 Duplicate charge',         subtitle: 'Review and refund to card',                action: { type: 'submit' } },
      { type: 'item', id: 'q_renewal',      title: '📅 Renewal complaint',        subtitle: 'Not refund-to-card — offer alternatives',  action: { type: 'submit' } },
      { type: 'item', id: 'q_cancel',       title: '❌ Cancellation request',     subtitle: 'Settings or ticket portal',                action: { type: 'submit' } },
      { type: 'item', id: 'q_missing',      title: '📦 Missing package item',     subtitle: 'Acknowledge — no release date promise',    action: { type: 'submit' } },
      { type: 'item', id: 'q_resolved',     title: '✅ Issue resolved — closing', subtitle: 'Thank customer + CSAT mention',            action: { type: 'submit' } },
    ]
  });
  c.push(dv());
  c.push(t('Custom instruction', 'header'));
  c.push(inp('instruction', 'Instruction', "E.g. 'Customer sent proof, approve refund'"));
  c.push(inp('agent_name', 'Your name', 'e.g. Archie'));
  c.push(sp());
  c.push(b('generate', 'Generate draft ✨'));
  return canvas(c, stored);
}

function draftScreen(draft, stored) {
  return canvas([
    t('AI Reply Assistant', 'header'), dv(),
    t('Draft reply', 'header'), sp(),
    t(draft), sp(), dv(), sp(),
    b('post_note', '📋 Post as internal note', 'secondary'), sp(),
    b('back', '← Generate another', 'secondary'),
  ], { ...stored, draft });
}

function successScreen(stored) {
  return canvas([
    t('AI Reply Assistant', 'header'), dv(),
    t('✅ Posted as internal note!', 'header'), sp(),
    t('The draft has been saved as an internal note. Copy it into the reply box to send.', 'muted'),
    sp(), dv(),
    b('back', '← Generate another', 'secondary'),
  ], stored);
}

function errScreen(msg, stored) {
  return canvas([
    t('AI Reply Assistant', 'header'), dv(),
    t('❌ ' + msg), sp(),
    b('back', '← Try again', 'secondary'),
  ], stored || {});
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function urgency(text) {
  if (!text) return 'normal';
  const lo = text.toLowerCase();
  if (['dispute','chargeback','worst','scam','fraud','lawyer','sue','furious','horrible','terrible'].some(w => lo.includes(w))) return 'high';
  if (['frustrated','disappointed','unhappy','not working','broken','ridiculous'].filter(w => lo.includes(w)).length >= 2) return 'medium';
  return 'normal';
}

async function getLastMsg(convId) {
  if (!convId || !INTERCOM_ACCESS_TOKEN) return '';
  try {
    const r = await fetch(`https://api.intercom.io/conversations/${convId}?display_as=plaintext`, {
      headers: { Authorization: `Bearer ${INTERCOM_ACCESS_TOKEN}`, 'Intercom-Version': '2.11' }
    });
    if (!r.ok) return '';
    const d = await r.json();
    const parts = (d.conversation_parts?.conversation_parts || []).filter(p => p.author?.type === 'user' && p.body && p.part_type === 'comment');
    const raw = parts.length ? parts[parts.length - 1].body : (d.source?.body || '');
    return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  } catch { return ''; }
}

async function claude(instruction, agentName, context) {
  const name = agentName || 'Support Team';
  const prompt = [
    context ? `Customer message: ${context}` : '',
    `Instruction: ${instruction}`,
    `Sign off: "Warm regards, ${name}, iSpeedToLead Support Team"`,
    'Reply body only.'
  ].filter(Boolean).join('\n');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 600, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: prompt }] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `Claude ${r.status}`);
  return (d.content?.[0]?.text || '').trim();
}

async function postNote(convId, body) {
  if (!INTERCOM_ACCESS_TOKEN || !convId || !INTERCOM_BOT_ADMIN_ID) return false;
  try {
    const r = await fetch(`https://api.intercom.io/conversations/${convId}/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${INTERCOM_ACCESS_TOKEN}`, 'Intercom-Version': '2.11' },
      body: JSON.stringify({ message_type: 'note', type: 'admin', admin_id: String(INTERCOM_BOT_ADMIN_ID), body: body.replace(/\n/g, '<br>') })
    });
    return r.ok;
  } catch { return false; }
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.post('/initialize', async (req, res) => {
  console.log('INIT', new Date().toISOString());
  try {
    const convId = req.body?.conversation?.id || '';
    const lastMsg = await getLastMsg(convId);
    res.json(homeScreen(lastMsg, urgency(lastMsg), { conv_id: convId, last_msg: lastMsg }));
  } catch (e) {
    console.error('INIT ERR', e.message);
    res.json(errScreen('Could not load. Please refresh.', {}));
  }
});

app.post('/submit', async (req, res) => {
  const compId = req.body?.component_id || '';
  console.log('SUBMIT', compId, new Date().toISOString());
  try {
    const inputs  = req.body?.input_values || {};
    const stored  = req.body?.current_canvas?.stored_data || {};
    const convId  = stored.conv_id || req.body?.conversation?.id || '';
    const lastMsg = stored.last_msg || '';
    const agent   = inputs.agent_name || stored.agent_name || '';

    if (compId === 'back') return res.json(homeScreen(lastMsg, urgency(lastMsg), { conv_id: convId, last_msg: lastMsg }));

    if (compId === 'post_note') {
      if (stored.draft && convId) await postNote(convId, `📝 AI Draft (review before sending):\n\n${stored.draft}`);
      return res.json(successScreen({ conv_id: convId, last_msg: lastMsg }));
    }

    const prompt = QUICK_PROMPTS[compId] || (compId === 'generate' ? (inputs.instruction?.trim() || "Write a helpful warm reply.") : null);
    if (!prompt) return res.json(homeScreen(lastMsg, urgency(lastMsg), { conv_id: convId, last_msg: lastMsg }));

    const draft = await claude(prompt, agent, lastMsg);
    if (!draft) return res.json(errScreen('Could not generate a draft. Try again.', { conv_id: convId, last_msg: lastMsg }));

    return res.json(draftScreen(draft, { conv_id: convId, last_msg: lastMsg, agent_name: agent }));

  } catch (e) {
    console.error('SUBMIT ERR', e.message);
    const stored = req.body?.current_canvas?.stored_data || {};
    res.json(errScreen('Error: ' + e.message, stored));
  }
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'iSpeedToLead Intercom AI App' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));
