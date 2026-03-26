const express = require('express');
const app = express();
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const INTERCOM_ACCESS_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;

// ── iSpeedToLead system prompt ────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a senior customer support agent at iSpeedToLead. You write warm, clear, empathetic replies that sound human — never robotic or generic.

iSpeedToLead is the #1 marketplace for motivated real estate leads. Customers buy property leads directly, use memberships like Coupon Club for discounted pricing, and purchase packages that may include account balance, Premium access, DealSpeed, free lead packs, or educational/resource bundles.

VOICE & TONE:
- Warm, empathetic, calm, lightly professional
- Always acknowledge the customer's concern before explaining anything
- Offer next steps rather than just saying no
- Always use "we" not "I" — you represent the team
- Sign off: "Warm regards, [Agent Name], iSpeedToLead Support Team"

LEAD PRICING (since Nov 1 2025):
- Sale leads: $39/lead (grandfathered: $29)
- Active leads: $69/lead (grandfathered: $59)
- Exclusive leads: $209/lead (grandfathered: $199)
- Even with 100% exclusivity, seller may have submitted forms elsewhere — not automatic refund

POLICIES:
- Lead refunds: proof optional; with proof 24h, without 2-5 business days; team may call lead and warm transfer
- Balance refunds: must go through https://app.ispeedtolead.com/issue/create — cannot process in chat
- Duplicate charge: can refund to card. Renewal charge: NOT refund-to-card — offer balance/extension/bonus credits
- Missing package items: acknowledge, never promise release date, offer bonus credits, ask customer to confirm
- Cancellation: via account settings or https://app.ispeedtolead.com/issue/create

HARD RULES:
- Never promise a fix/release date
- Never promise refund-to-card for renewal charges  
- Never say "final decision" unless human confirmed
- Write reply body only — no subject line
- Always "we" not "I"`;

// ── Canvas builder helpers ────────────────────────────────────────────────────
function text(txt, style = 'paragraph') {
  return { type: 'text', text: txt, style };
}

function input(id, placeholder, label) {
  return {
    type: 'input',
    id,
    label,
    placeholder,
    save_state: 'unsaved'
  };
}

function button(id, label, style = 'primary', disabled = false) {
  const btn = { type: 'button', id, label, style, action: { type: 'submit' } };
  if (disabled) btn.disabled = true;
  return btn;
}

function divider() {
  return { type: 'divider' };
}

function spacer() {
  return { type: 'spacer', size: 's' };
}

function dropdownOption(type, id, label) {
  return { type, id, label };
}

// ── Build the main UI canvas ──────────────────────────────────────────────────
function buildMainCanvas(conversation, lastMessage, urgency) {
  const components = [];

  // Header
  components.push(text('🤖 AI Reply Assistant', 'header'));
  components.push(divider());

  // Urgency banner
  if (urgency === 'high') {
    components.push(text('🔴 High urgency — handle with priority'));
    components.push(spacer());
  } else if (urgency === 'medium') {
    components.push(text('🟡 Moderate urgency — be extra empathetic'));
    components.push(spacer());
  }

  // Last customer message preview
  if (lastMessage) {
    const preview = lastMessage.length > 200 ? lastMessage.slice(0, 200) + '...' : lastMessage;
    components.push(text('Last customer message:', 'header'));
    components.push(text(preview, 'muted'));
    components.push(spacer());
  }

  components.push(divider());

  // Quick action buttons
  components.push(text('Quick actions', 'header'));
  components.push(spacer());
  components.push({
    type: 'button-list',
    items: [
      { type: 'item', id: 'quick_lead_refund', title: '🔄 Lead refund request', subtitle: 'Proof optional · 24h with proof · 2-5 days without', action: { type: 'submit' } },
      { type: 'item', id: 'quick_lead_quality', title: '⚠️ Lead quality concern', subtitle: 'Acknowledge and offer to investigate', action: { type: 'submit' } },
      { type: 'item', id: 'quick_duplicate_charge', title: '💳 Duplicate charge', subtitle: 'Can review and refund to card', action: { type: 'submit' } },
      { type: 'item', id: 'quick_renewal', title: '📅 Renewal complaint', subtitle: 'Not refund-to-card — offer alternatives', action: { type: 'submit' } },
      { type: 'item', id: 'quick_cancel', title: '❌ Cancellation request', subtitle: 'Account settings or ticket portal', action: { type: 'submit' } },
      { type: 'item', id: 'quick_missing_item', title: '📦 Missing package item', subtitle: 'Acknowledge, no release date promise', action: { type: 'submit' } },
      { type: 'item', id: 'quick_resolved', title: '✅ Issue resolved — closing', subtitle: 'Thank customer, mention CSAT survey', action: { type: 'submit' } },
    ]
  });

  components.push(divider());

  // Custom instruction
  components.push(text('Or write your own instruction', 'header'));
  components.push(input('instruction', "E.g. 'Customer sent proof, approve the refund' or 'Offer $50 bonus credits'", 'Instruction'));
  components.push(input('agent_name', 'e.g. Archie', 'Your name'));
  components.push(spacer());
  components.push(button('generate', 'Generate draft ✨'));

  return { canvas: { content: { components }, stored_data: { conversation_id: conversation?.id || '', last_message: lastMessage || '' } } };
}

// ── Build draft result canvas ─────────────────────────────────────────────────
function buildDraftCanvas(draft, conversationId, agentName) {
  return {
    canvas: {
      content: {
        components: [
          text('🤖 AI Reply Assistant', 'header'),
          divider(),
          text('Draft reply', 'header'),
          spacer(),
          text(draft),
          spacer(),
          divider(),
          spacer(),
          button('insert_note', '📋 Post as internal note', 'secondary'),
          button('back', '← Generate another', 'secondary'),
        ]
      },
      stored_data: { draft, conversation_id: conversationId, agent_name: agentName }
    }
  };
}

// ── Detect urgency from text ──────────────────────────────────────────────────
function detectUrgency(text) {
  if (!text) return 'normal';
  const t = text.toLowerCase();
  const high = ['dispute', 'chargeback', 'worst', 'scam', 'fraud', 'lawyer', 'sue', 'furious', 'angry', 'cancel everything', 'horrible', 'terrible'];
  const med = ['frustrated', 'disappointed', 'unhappy', 'not working', 'broken', 'ridiculous', 'wrong number', 'bad lead'];
  if (high.some(w => t.includes(w))) return 'high';
  if (med.filter(w => t.includes(w)).length >= 2) return 'medium';
  return 'normal';
}

// ── Get last customer message from conversation ───────────────────────────────
async function getLastCustomerMessage(conversationId) {
  if (!conversationId || !INTERCOM_ACCESS_TOKEN) return '';
  try {
    const res = await fetch(`https://api.intercom.io/conversations/${conversationId}?display_as=plaintext`, {
      headers: { Authorization: `Bearer ${INTERCOM_ACCESS_TOKEN}`, 'Intercom-Version': '2.11' }
    });
    const data = await res.json();
    const parts = data.conversation_parts?.conversation_parts || [];
    const customerParts = parts.filter(p => p.author?.type === 'user' && p.body && p.part_type === 'comment');
    if (customerParts.length > 0) {
      const last = customerParts[customerParts.length - 1];
      return (last.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    // Fall back to source body
    return (data.source?.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  } catch (e) {
    return '';
  }
}

// ── Call Claude ───────────────────────────────────────────────────────────────
async function callClaude(instruction, agentName, conversationContext) {
  const name = agentName || '[Agent Name]';
  const prompt = [
    conversationContext ? `== CONVERSATION CONTEXT ==\n${conversationContext}` : '',
    `== INSTRUCTION ==`,
    instruction,
    `Tone: warm and friendly. Reply body only.`,
    `Sign off: "Warm regards, ${name}, iSpeedToLead Support Team"`
  ].filter(Boolean).join('\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  const data = await res.json();
  return (data.content?.[0]?.text || '').trim();
}

// ── Post internal note to Intercom ────────────────────────────────────────────
async function postInternalNote(conversationId, body) {
  if (!INTERCOM_ACCESS_TOKEN || !conversationId) return false;
  const adminId = process.env.INTERCOM_BOT_ADMIN_ID;
  if (!adminId) return false;
  try {
    const res = await fetch(`https://api.intercom.io/conversations/${conversationId}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${INTERCOM_ACCESS_TOKEN}`,
        'Intercom-Version': '2.11'
      },
      body: JSON.stringify({ message_type: 'note', type: 'admin', admin_id: adminId, body: body.replace(/\n/g, '<br>') })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// ── Quick action prompts ──────────────────────────────────────────────────────
const QUICK_PROMPTS = {
  quick_lead_refund: 'Customer requesting refund for bad lead. Explain proof is optional but speeds review. With proof: 24 hours. Without: 2-5 business days. Team may call lead and attempt warm transfer.',
  quick_lead_quality: 'Customer unhappy with lead quality. Acknowledge empathetically. Explain review process and offer to investigate.',
  quick_duplicate_charge: 'Customer disputing duplicate charge. Duplicate charges can be reviewed and refunded to card. Apologize and explain next steps.',
  quick_renewal: 'Customer complaining about renewal charge. Renewal charges not covered under refund-to-card policy. Offer account balance, service extension, or bonus credits as alternatives.',
  quick_cancel: 'Customer wants to cancel. Explain two ways: account settings subscription section, or submit ticket at https://app.ispeedtolead.com/issue/create. Keep it warm and helpful.',
  quick_missing_item: 'Customer cannot find a deliverable from their package. Acknowledge, explain still being finalized, do NOT promise release date, offer bonus credits or balance.',
  quick_resolved: 'Confirm the issue has been resolved. Thank customer for patience, let them know team is available if anything comes up, mention they will receive a CSAT survey.',
};

// ── ROUTES ────────────────────────────────────────────────────────────────────

// Initialize — triggered when agent opens the app
app.post('/initialize', async (req, res) => {
  try {
    const conversation = req.body.conversation;
    const conversationId = conversation?.id;
    const lastMessage = await getLastCustomerMessage(conversationId);
    const urgency = detectUrgency(lastMessage);
    res.json(buildMainCanvas(conversation, lastMessage, urgency));
  } catch (e) {
    console.error('Initialize error:', e);
    res.json({ canvas: { content: { components: [text('Error loading app. Please refresh.', 'error')] } } });
  }
});

// Submit — triggered when agent clicks any button
app.post('/submit', async (req, res) => {
  try {
    const { component_id, input_values, current_canvas } = req.body;
    const stored = current_canvas?.stored_data || {};
    const conversationId = stored.conversation_id || req.body.conversation?.id || '';
    const lastMessage = stored.last_message || '';

    // ── Back button ───────────────────────────────────────────────────────────
    if (component_id === 'back') {
      const conversation = req.body.conversation || { id: conversationId };
      const urgency = detectUrgency(lastMessage);
      return res.json(buildMainCanvas(conversation, lastMessage, urgency));
    }

    // ── Insert as internal note ───────────────────────────────────────────────
    if (component_id === 'insert_note') {
      const draft = stored.draft || '';
      const agentName = stored.agent_name || '';
      if (draft && conversationId) {
        await postInternalNote(conversationId, `📝 AI Draft Reply (review before sending):\n\n${draft}`);
      }
      return res.json({
        canvas: {
          content: {
            components: [
              text('🤖 AI Reply Assistant', 'header'),
              divider(),
              text('✅ Posted as internal note!', 'header'),
              spacer(),
              text('The draft has been saved as an internal note on this conversation. Review and send it from the reply box.'),
              spacer(),
              divider(),
              button('back', '← Generate another', 'secondary'),
            ]
          },
          stored_data: { conversation_id: conversationId, last_message: lastMessage, agent_name: agentName }
        }
      });
    }

    // ── Quick action button ───────────────────────────────────────────────────
    const agentName = input_values?.agent_name || stored.agent_name || '';
    let instruction = '';

    if (QUICK_PROMPTS[component_id]) {
      instruction = QUICK_PROMPTS[component_id];
    } else if (component_id === 'generate') {
      instruction = input_values?.instruction || "Write a helpful warm reply to the customer's latest message.";
    } else {
      // Unknown component — go back to main
      const conversation = req.body.conversation || { id: conversationId };
      return res.json(buildMainCanvas(conversation, lastMessage, 'normal'));
    }

    // ── Generate draft ────────────────────────────────────────────────────────
    const context = lastMessage ? `Last customer message: ${lastMessage}` : '';
    const draft = await callClaude(instruction, agentName, context);

    if (!draft) {
      return res.json({
        canvas: {
          content: {
            components: [
              text('🤖 AI Reply Assistant', 'header'),
              divider(),
              text('❌ Could not generate a draft. Please try again.'),
              spacer(),
              button('back', '← Try again', 'secondary')
            ]
          },
          stored_data: { conversation_id: conversationId, last_message: lastMessage }
        }
      });
    }

    return res.json(buildDraftCanvas(draft, conversationId, agentName));

  } catch (e) {
    console.error('Submit error:', e);
    res.json({
      canvas: {
        content: {
          components: [
            text('🤖 AI Reply Assistant', 'header'),
            divider(),
            text('❌ Error: ' + e.message),
            spacer(),
            button('back', '← Try again', 'secondary')
          ]
        }
      }
    });
  }
});

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', service: 'iSpeedToLead Intercom AI App' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
