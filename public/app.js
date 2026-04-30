/* ── app.js ─────────────────────────────────────────────────── */

// ═══ STATE ════════════════════════════════════════════════════
const state = {
  messages: [],
  pendingFile: null,
  theme: localStorage.getItem('medbuddy-theme') || 'light',
  lastCondition: null,
  isLoading: false,
};

// ═══ ELEMENTS ═════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const splash = $('splash-screen');
const app = $('app');
const chatArea = $('chat-area');
const messagesContainer = $('messages-container');
const typingIndicator = $('typing-indicator');
const welcomeBanner = $('welcome-banner');
const messageInput = $('message-input');
const sendBtn = $('send-btn');
const attachBtn = $('attach-btn');
const fileInput = $('file-input');
const filePreviewBar = $('file-preview-bar');
const filePreviewContent = $('file-preview-content');
const removeFileBtn = $('remove-file-btn');
const themeToggle = $('theme-toggle');
const themeIcon = $('theme-icon');
const hospitalsBtn = $('hospitals-btn');
const hospitalsOverlay = $('hospitals-overlay');
const hospitalsPanel = $('hospitals-panel');
const hospitalsClose = $('hospitals-close');
const hospitalsList = $('hospitals-list');
const hospitalsSubtitle = $('hospitals-subtitle');
const clearChatBtn = $('clear-chat-btn');
const toastContainer = $('toast-container');

// ═══ INIT ══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(state.theme);
  setTimeout(() => {
    splash.classList.add('out');
    setTimeout(() => { splash.classList.add('hidden'); app.classList.remove('hidden'); }, 500);
  }, 2000);
});

// ═══ THEME ════════════════════════════════════════════════════
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('medbuddy-theme', theme);
  themeIcon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}
themeToggle.addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));

// ═══ AUTO-RESIZE TEXTAREA ═════════════════════════════════════
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
});
messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
});

// ═══ FILE UPLOAD ══════════════════════════════════════════════
attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  state.pendingFile = file;
  showFilePreview(file);
  fileInput.value = '';
});
removeFileBtn.addEventListener('click', () => {
  state.pendingFile = null;
  filePreviewBar.classList.add('hidden');
});

function showFilePreview(file) {
  const isImage = file.type.startsWith('image/');
  const sizeMB = (file.size / 1048576).toFixed(1);
  let html = '';
  if (isImage) {
    const url = URL.createObjectURL(file);
    html = `<img src="${url}" class="preview-thumb" alt="Preview"/>`;
  } else {
    html = `<div class="preview-icon"><i class="fa-solid fa-file-medical"></i></div>`;
  }
  html += `<div class="preview-info"><div class="preview-name">${escHtml(file.name)}</div><div class="preview-size">${sizeMB} MB</div></div>`;
  filePreviewContent.innerHTML = html;
  filePreviewBar.classList.remove('hidden');
}

// ═══ QUICK CHIPS ══════════════════════════════════════════════
document.querySelectorAll('.quick-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    messageInput.value = btn.dataset.msg;
    handleSend();
  });
});

// ═══ SEND ═════════════════════════════════════════════════════
sendBtn.addEventListener('click', handleSend);
clearChatBtn.addEventListener('click', () => {
  state.messages = [];
  messagesContainer.innerHTML = '';
  welcomeBanner.classList.remove('hidden');
  showToast('Chat cleared', 'success');
});

async function handleSend() {
  if (state.isLoading) return;
  const text = messageInput.value.trim();
  const file = state.pendingFile;
  if (!text && !file) return;

  messageInput.value = '';
  messageInput.style.height = 'auto';
  welcomeBanner.classList.add('hidden');

  if (file) {
    // File message
    appendMessage('user', text || 'Please analyze this file.', null, file);
    state.pendingFile = null;
    filePreviewBar.classList.add('hidden');
    await analyzeFile(file, text);
  } else {
    appendMessage('user', text);
    state.messages.push({ role: 'user', content: text });
    await chatWithAI();
  }
}

// ═══ CHAT API ══════════════════════════════════════════════════
async function chatWithAI() {
  setLoading(true);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.messages }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');
    state.messages.push({ role: 'assistant', content: data.content });
    renderAIMessage(data.content);
  } catch (err) {
    appendMessage('ai', '⚠️ ' + err.message, true);
    showToast(err.message, 'error');
  } finally {
    setLoading(false);
  }
}

// ═══ ANALYZE FILE ══════════════════════════════════════════════
async function analyzeFile(file, context) {
  setLoading(true);
  try {
    const formData = new FormData();
    formData.append('file', file);
    if (context) formData.append('context', context);

    const res = await fetch('/api/analyze', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Server error');

    state.messages.push({ role: 'user', content: `[Uploaded file: ${file.name}]${context ? ' ' + context : ''}` });
    state.messages.push({ role: 'assistant', content: data.content });
    renderAIMessage(data.content);
  } catch (err) {
    appendMessage('ai', '⚠️ ' + err.message, true);
    showToast(err.message, 'error');
  } finally {
    setLoading(false);
  }
}

// ═══ RENDER AI MESSAGE ═════════════════════════════════════════
function renderAIMessage(raw) {
  let text = raw;
  let medicines = null;
  let condition = null;
  let followup = null;

  // Extract FOLLOWUP_JSON
  const followupMatch = text.match(/FOLLOWUP_JSON:\s*(\{[\s\S]*?\})/);
  if (followupMatch) {
    try { followup = JSON.parse(followupMatch[1]); } catch {}
    text = text.replace(/FOLLOWUP_JSON:\s*\{[\s\S]*?\}/, '').trim();
  }

  // Extract MEDICINES_JSON
  const medMatch = text.match(/MEDICINES_JSON:\s*(\[[\s\S]*?\])/);
  if (medMatch) {
    try { medicines = JSON.parse(medMatch[1]); } catch {}
    text = text.replace(/MEDICINES_JSON:\s*\[[\s\S]*?\]/, '').trim();
  }

  // Extract CONDITION_JSON
  const condMatch = text.match(/CONDITION_JSON:\s*(\{[\s\S]*?\})/);
  if (condMatch) {
    try { condition = JSON.parse(condMatch[1]); state.lastCondition = condition.condition; } catch {}
    text = text.replace(/CONDITION_JSON:\s*\{[\s\S]*?\}/, '').trim();
  }

  const row = appendMessage('ai', text);

  if (followup) renderFollowUp(row, followup);
  if (condition) renderConditionBanner(row, condition);
  if (medicines && medicines.length > 0) renderMedicineCards(row, medicines);

  scrollToBottom();
}

// ═══ RENDER FOLLOW UP ══════════════════════════════════════════
function renderFollowUp(row, followup) {
  const bubble = row.querySelector('.msg-bubble');
  const card = document.createElement('div');
  card.className = 'followup-card';
  card.innerHTML = `
    <div class="followup-question">
      <i class="fa-solid fa-clipboard-question"></i>
      <span>${escHtml(followup.question)}</span>
    </div>
    <div class="followup-options">
      ${followup.options.map(opt => `<button class="followup-option">${escHtml(opt)}</button>`).join('')}
    </div>
  `;
  
  // Add click listeners to options
  const buttons = card.querySelectorAll('.followup-option');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Disable all buttons
      buttons.forEach(b => b.classList.add('disabled'));
      btn.classList.remove('disabled');
      btn.classList.add('selected');
      
      // Send the selected option as a message
      messageInput.value = btn.textContent;
      handleSend();
    });
  });

  bubble.appendChild(card);
}

// ═══ RENDER CONDITION BANNER ════════════════════════════════════
function renderConditionBanner(row, cond) {
  const bubble = row.querySelector('.msg-bubble');
  const sev = cond.severity || 'mild';
  const div = document.createElement('div');
  div.className = 'condition-banner';
  div.innerHTML = `
    <i class="fa-solid fa-circle-info"></i>
    <div>
      <span class="cond-label">${escHtml(cond.condition)}</span>
      <span class="sev-badge sev-${sev}">${sev}</span>
    </div>
    <a class="find-hosp-link" href="#" onclick="openHospitals('${escHtml(cond.condition)}');return false;">
      <i class="fa-solid fa-hospital"></i> Find Hospitals
    </a>`;
  bubble.appendChild(div);
}

// ═══ RENDER MEDICINE CARDS ══════════════════════════════════════
function renderMedicineCards(row, medicines) {
  const bubble = row.querySelector('.msg-bubble');
  const section = document.createElement('div');
  section.className = 'medicines-section';
  section.innerHTML = `<div class="medicines-label"><i class="fa-solid fa-pills"></i> Medicine Recommendations</div>
    <div class="medicine-cards">${medicines.map(buildMedCard).join('')}</div>`;
  bubble.appendChild(section);
}

function buildMedCard(med) {
  const buyUrl = `https://www.1mg.com/search/all?name=${encodeURIComponent(med.name)}`;
  return `<div class="medicine-card">
    <div class="med-header">
      <div class="med-name">${escHtml(med.name)}</div>
      <span class="med-type-badge">${escHtml(med.type || 'tablet')}</span>
    </div>
    ${med.generic ? `<div class="med-generic">${escHtml(med.generic)}</div>` : ''}
    <div class="med-use">${escHtml(med.use)}</div>
    ${med.dosage ? `<div class="med-dosage"><i class="fa-solid fa-clock"></i> ${escHtml(med.dosage)}</div>` : ''}
    <a class="buy-btn" href="${buyUrl}" target="_blank" rel="noopener">
      <i class="fa-solid fa-cart-shopping"></i> Buy on 1mg
    </a>
  </div>`;
}

// ═══ APPEND MESSAGE ════════════════════════════════════════════
function appendMessage(role, text, isError = false, file = null) {
  const isAI = role === 'ai';
  const row = document.createElement('div');
  row.className = `message-row ${isAI ? 'ai' : 'user'}`;

  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const avatarIcon = isAI ? '<i class="fa-solid fa-cross"></i>' : '<i class="fa-solid fa-user"></i>';

  let fileHtml = '';
  if (file) {
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      fileHtml = `<img src="${url}" class="msg-image" alt="Uploaded"/>`;
    } else {
      fileHtml = `<div class="file-chip"><i class="fa-solid fa-file-medical"></i>${escHtml(file.name)}</div>`;
    }
  }

  row.innerHTML = `
    <div class="msg-avatar ${isAI ? 'ai' : 'user'}">${avatarIcon}</div>
    <div class="msg-bubble">
      ${fileHtml}
      <div class="msg-text${isError ? ' msg-error' : ''}">${formatText(text)}</div>
      <div class="msg-time">${time}</div>
    </div>`;

  messagesContainer.appendChild(row);
  scrollToBottom();
  return row;
}

// ═══ FORMAT TEXT ═══════════════════════════════════════════════
function formatText(text) {
  return escHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^#{1,3} (.+)$/gm, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══ LOADING STATE ═════════════════════════════════════════════
function setLoading(on) {
  state.isLoading = on;
  typingIndicator.classList.toggle('hidden', !on);
  sendBtn.disabled = on;
  if (on) scrollToBottom();
}

function scrollToBottom() {
  requestAnimationFrame(() => { chatArea.scrollTop = chatArea.scrollHeight; });
}

// ═══ HOSPITALS ════════════════════════════════════════════════
hospitalsBtn.addEventListener('click', () => openHospitals(state.lastCondition));
hospitalsClose.addEventListener('click', closeHospitalsPanel);
hospitalsOverlay.addEventListener('click', e => { if (e.target === hospitalsOverlay) closeHospitalsPanel(); });

function openHospitals(condition) {
  state.lastCondition = condition || state.lastCondition;
  hospitalsOverlay.classList.remove('hidden');
  hospitalsList.innerHTML = `<div class="panel-loading"><div class="panel-spinner"></div><p>Detecting your location...</p></div>`;
  hospitalsSubtitle.textContent = 'Finding hospitals near you...';

  navigator.geolocation.getCurrentPosition(
    pos => fetchHospitals(pos.coords.latitude, pos.coords.longitude, state.lastCondition),
    () => {
      showToast('Location access denied. Please enable location.', 'error');
      hospitalsList.innerHTML = `<div class="no-hospitals"><i class="fa-solid fa-location-slash"></i><p>Location access is required to find nearby hospitals.</p></div>`;
    },
    { timeout: 10000 }
  );
}

async function fetchHospitals(lat, lon, condition) {
  try {
    const params = new URLSearchParams({ lat, lon });
    if (condition) params.set('condition', condition);
    const res = await fetch(`/api/hospitals?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch hospitals');
    renderHospitals(data.hospitals, lat, lon);
    hospitalsSubtitle.textContent = `${data.hospitals.length} found nearby (up to 20 km)`;
  } catch (err) {
    showToast(err.message, 'error');
    hospitalsList.innerHTML = `<div class="no-hospitals"><i class="fa-solid fa-circle-exclamation"></i><p>${escHtml(err.message)}</p></div>`;
  }
}

function renderHospitals(hospitals, userLat, userLon) {
  if (!hospitals.length) {
    hospitalsList.innerHTML = `<div class="no-hospitals"><i class="fa-solid fa-hospital-slash"></i><p>No hospitals found within 20 km of your location.</p></div>`;
    return;
  }
  hospitalsList.innerHTML = hospitals.map(h => {
    const isEmergency = h.emergency;
    const icon = isEmergency ? 'emergency' : '';
    const faIcon = h.type === 'clinic' ? 'fa-house-medical' : 'fa-hospital';
    return `<div class="hospital-card">
      <div class="hospital-header">
        <div class="hospital-icon ${icon}"><i class="fa-solid ${faIcon}"></i></div>
        <div>
          <div class="hospital-name">${escHtml(h.name)}</div>
          <div class="hospital-distance"><i class="fa-solid fa-location-dot"></i> ${h.distanceKm} km away</div>
        </div>
      </div>
      <div class="hospital-badges">
        <span class="badge badge-type">${escHtml(h.type)}</span>
        ${isEmergency ? '<span class="badge badge-emergency"><i class="fa-solid fa-star-of-life"></i> Emergency</span>' : ''}
        ${h.specialty ? `<span class="badge badge-type">${escHtml(h.specialty)}</span>` : ''}
      </div>
      ${h.address !== 'Address not available' ? `<div class="hospital-address"><i class="fa-solid fa-map-pin"></i>${escHtml(h.address)}</div>` : ''}
      ${h.phone ? `<div class="hospital-phone"><i class="fa-solid fa-phone"></i><a href="tel:${escHtml(h.phone)}">${escHtml(h.phone)}</a></div>` : ''}
      <a class="directions-btn" href="${h.mapsUrl}" target="_blank" rel="noopener">
        <i class="fa-solid fa-diamond-turn-right"></i> Get Directions
      </a>
    </div>`;
  }).join('');
}

function closeHospitalsPanel() {
  hospitalsOverlay.classList.add('hidden');
}

// ═══ TOAST ════════════════════════════════════════════════════
function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  const icon = type === 'error' ? 'fa-circle-exclamation' : type === 'success' ? 'fa-circle-check' : 'fa-circle-info';
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fa-solid ${icon}"></i>${escHtml(msg)}`;
  toastContainer.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 3500);
}
