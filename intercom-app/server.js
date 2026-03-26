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
  q1: 'Customer requesting refund for bad lead. Proof optional but speeds review. With proof: 24 hours. Without: 2-5 business days. Team may call lead and attempt warm transfer.',
  q2: 'Customer unhappy with lead quality. Acknowledge empathetically. Explain review process and offer to investigate.',
  q3: 'Customer disputing duplicate charge. Duplicate charges can be reviewed and refunded to card. Apologize and explain next steps.',
  q4: 'Customer complaining about renewal charge. Renewal charges not refund-to-card. Offer account balance, service extension, or bonus credits.',
  q5: 'Customer wants to cancel. Two ways: account settings subscription section, or submit ticket at https://app.ispeedtolead.com/issue/create.',
  q6: 'Customer cannot find a deliverable from their package. Acknowledge, explain still being finalized, do NOT promise release date, offer bonus credits.',
  q7: 'Confirm issue resolved. Thank customer for patience. Mention they will receive a CSAT survey. Close warmly.',
};

// ── Canvas helpers ────────────────────────────────────────────────────────────
function canvas(components, stored) {
  return { canvas: { content: { components }, stored_data: stored || {} } };
}
const t = (text, style) => { const c = { type: 'text', text: String(text) }; if (style) c.style = style; return c; };
const btn = (id, label, style) => ({ type: 'button', id, label, style: style || 'primary', action: { type: 'submit' } });
const inp = (id, label, ph) => ({ type: 'input', id, label, placeholder: ph || '', save_state: 'unsaved' });
const sp = () => ({ type: 'spacer', size: 's' });
const dv = () => ({ type: 'divider' });
const dd = (id, label, opts) => ({ type: 'dropdown', id, label, options: opts, save_state: 'unsaved' });

function homeScreen(lastMsg, stored) {
  const c = [];
  c.push(t('AI Reply Assistant', 'header'));
  c.push(dv());
  if (lastMsg) {
    c.push(t('Last customer message:', 'header'));
    c.push(t(lastMsg.slice(0, 200) + (lastMsg.length > 200 ? '...' : ''), 'muted'));
    c.push(sp());
    c.push(dv());
  }
  c.push(t('Quick action', 'header'));
  c.push(dd('quick', 'Select a quick action', [
    { type: 'option', id: 'none',  text: '— choose one —' },
    { type: 'option', id: 'q1',   text: '🔄 Lead refund request' },
    { type: 'option', id: 'q2',   text: '⚠️ Lead quality concern' },
    { type: 'option', id: 'q3',   text: '💳 Duplicate charge' },
    { type: 'option', id: 'q4',   text: '📅 Renewal complaint' },
    { type: 'option', id: 'q5',   text: '❌ Cancellation request' },
    { type: 'option', id: 'q6',   text: '📦 Missing package item' },
    { type: 'option', id: 'q7',   text: '✅ Issue resolved — closing' },
  ]));
  c.push(sp());
  c.push(t('Or write a custom instruction', 'header'));
  c.push(inp('instruction', 'Custom instruction', "E.g. 'Customer sent proof, approve refund'"));
  c.push(sp());
  c.push(inp('agent_name', 'Your name', 'e.g. Archie'));
  c.push(sp());
  c.push(btn('generate', 'Generate draft ✨', 'primary'));
  return canvas(c, stored);
}

function draftScreen(draft, stored) {
  return canvas([
    t('AI Reply Assistant', 'header'), dv(),
    t('Draft reply', 'header'), sp(),
    t(draft), sp(), dv(), sp(),
    btn('post_note', '📋 Post as internal note', 'secondary'), sp(),
    btn('back', '← Generate another', 'secondary'),
  ], { ...stored, draft });
}

function successScreen(stored) {
  return canvas([
    t('AI Reply Assistant', 'header'), dv(),
    t('✅ Posted as internal note!', 'header'), sp(),
    t('The draft is saved as an internal note. Copy it into the reply box to send.', 'muted'),
    sp(), dv(),
    btn('back', '← Generate another', 'secondary'),
  ], stored);
}

function errScreen(msg, stored) {
  return canvas([
    t('AI Reply Assistant', 'header'), dv(),
    t('❌ ' + String(msg)), sp(),
    btn('back', '← Try again', 'secondary'),
  ], stored || {});
}

// ── Utilities ─────────────────────────────────────────────────────────────────
async function getLastMsg(convId) {
  if (!convId || !INTERCOM_ACCESS_TOKEN) return '';
  try {
    const r = await fetch(`https://api.intercom.io/conversations/${convId}?display_as=plaintext`, {
      headers: { Authorization: `Bearer ${INTERCOM_ACCESS_TOKEN}`, 'Intercom-Version': '2.11' }
    });
    if (!r.ok) return '';
    const d = await r.json();
    const parts = (d.conversation_parts?.conversation_parts || [])
      .filter(p => p.author?.type === 'user' && p.body && p.part_type === 'comment');
    const raw = parts.length ? parts[parts.length - 1].body : (d.source?.body || '');
    return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  } catch (e) {
    console.error('getLastMsg error:', e.message);
    return '';
  }
}

async function callClaude(instruction, agentName, context) {
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
  console.log('INIT body:', JSON.stringify(req.body).slice(0, 300));
  try {
    const convId = req.body?.conversation?.id || '';
    const lastMsg = await getLastMsg(convId);
    res.json(homeScreen(lastMsg, { conv_id: convId, last_msg: lastMsg }));
  } catch (e) {
    console.error('INIT ERR:', e.message);
    res.json(errScreen('Could not load. Please refresh.', {}));
  }
});

app.post('/submit', async (req, res) => {
  const compId = req.body?.component_id || '';
  console.log('SUBMIT compId:', compId, 'inputs:', JSON.stringify(req.body?.input_values || {}).slice(0, 200));
  try {
    const inputs  = req.body?.input_values || {};
    const stored  = req.body?.current_canvas?.stored_data || {};
    const convId  = stored.conv_id || req.body?.conversation?.id || '';
    const lastMsg = stored.last_msg || '';
    const agent   = inputs.agent_name || stored.agent_name || '';

    if (compId === 'back') {
      return res.json(homeScreen(lastMsg, { conv_id: convId, last_msg: lastMsg }));
    }

    if (compId === 'post_note') {
      if (stored.draft && convId) {
        await postNote(convId, `📝 AI Draft (review before sending):\n\n${stored.draft}`);
      }
      return res.json(successScreen({ conv_id: convId, last_msg: lastMsg }));
    }

    if (compId === 'generate') {
      // Use quick action prompt if selected, otherwise use custom instruction
      const quickKey = inputs.quick && inputs.quick !== 'none' ? inputs.quick : null;
      const instruction = quickKey
        ? QUICK_PROMPTS[quickKey]
        : (inputs.instruction?.trim() || "Write a helpful warm reply to the customer's latest message.");

      const draft = await callClaude(instruction, agent, lastMsg);
      if (!draft) return res.json(errScreen('Could not generate draft. Try again.', { conv_id: convId, last_msg: lastMsg }));
      return res.json(draftScreen(draft, { conv_id: convId, last_msg: lastMsg, agent_name: agent }));
    }

    return res.json(homeScreen(lastMsg, { conv_id: convId, last_msg: lastMsg }));

  } catch (e) {
    console.error('SUBMIT ERR:', e.message);
    res.json(errScreen('Error: ' + e.message, req.body?.current_canvas?.stored_data || {}));
  }
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'iSpeedToLead Intercom AI App' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
