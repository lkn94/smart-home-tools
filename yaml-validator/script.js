(function () {
  // Element-Referenzen
  const input = document.getElementById('yamlInput');
  const validateBtn = document.getElementById('validateBtn');
  const clearBtn = document.getElementById('clearBtn');
  const sampleBtn = document.getElementById('sampleBtn');
  const copyBtn = document.getElementById('copyBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const themeToggle = document.getElementById('themeToggle');

  const statusArea = document.getElementById('statusArea');
  const messages = document.getElementById('messages');
  const jsonPreviewWrapper = document.getElementById('jsonPreviewWrapper');
  const jsonPreview = document.getElementById('jsonPreview');

  const THEME_KEY = 'yamlValidatorTheme';

  // Theme Handling
  function applyTheme(mode) {
    if (mode === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }
  function loadTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) applyTheme(saved);
    else if (window.matchMedia('(prefers-color-scheme: dark)').matches) applyTheme('dark');
  }
  loadTheme();
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
    });
  }

  // Hilfsfunktionen
  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function sanitize(str) {
    return String(str).replace(/[&<>"']/g, s => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[s]));
  }

  function clearOutput() {
    statusArea && (statusArea.innerHTML = '');
    messages && (messages.innerHTML = '');
    jsonPreviewWrapper && jsonPreviewWrapper.classList.add('hidden');
    jsonPreview && (jsonPreview.textContent = '');
  }

  function addCard(type, title, body) {
    if (!messages) return;
    const c = el('div', `card fade-in ${type}`);
    const wrap = el('div', 'flex-1');
    wrap.appendChild(el('div', 'font-semibold text-sm', sanitize(title)));
    if (body) {
      const b = el('div', 'text-xs leading-relaxed');
      if (typeof body === 'string') b.innerHTML = body;
      else b.appendChild(body);
      wrap.appendChild(b);
    }
    c.appendChild(wrap);
    messages.appendChild(c);
    return c;
  }

  // Erkennung / Extraktion
  function isAutomationObject(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    const keys = Object.keys(obj);
    return ['alias', 'id', 'trigger', 'action'].some(k => keys.includes(k));
  }

  function extractAutomations(root) {
    const autos = [];
    if (Array.isArray(root)) {
      root.forEach(item => { if (isAutomationObject(item)) autos.push(item); });
    } else if (isAutomationObject(root)) {
      autos.push(root);
    } else if (root && typeof root === 'object') {
      if (Array.isArray(root.automation)) {
        root.automation.forEach(a => { if (isAutomationObject(a)) autos.push(a); });
      }
    }
    return autos;
  }

  // Trigger & Action Validierung
  function validateTriggerItem(t, idx, collector) {
    if (!t || typeof t !== 'object') {
      collector.warn.push(`Trigger #${idx + 1} ist kein Objekt.`);
      return;
    }
    if (!('platform' in t) && !('event_type' in t) && !('entity_id' in t) && !('device_id' in t) && !('time' in t)) {
      collector.info.push(`Trigger #${idx + 1} besitzt keinen offensichtlichen Schlüssel (platform/event_type/entity_id/device_id/time).`);
    }
    if ('platform' in t && typeof t.platform !== 'string') {
      collector.warn.push(`Trigger #${idx + 1}: 'platform' sollte ein String sein.`);
    }
  }

  function validateActionItem(a, idx, collector) {
    if (!a || typeof a !== 'object') {
      collector.warn.push(`Action #${idx + 1} ist kein Objekt.`);
      return;
    }
    const meaningful = ['service', 'device_id', 'scene', 'choose', 'delay', 'wait_template', 'wait_for_trigger', 'repeat'];
    if (!meaningful.some(k => k in a)) {
      collector.warn.push(`Action #${idx + 1} besitzt keinen der erwarteten Schlüssel (service/device_id/scene/choose/delay/...).`);
    }
    if ('service' in a && typeof a.service !== 'string') {
      collector.warn.push(`Action #${idx + 1}: 'service' sollte ein String sein.`);
    }
    if ('data' in a && (typeof a.data !== 'object' || Array.isArray(a.data))) {
      collector.info.push(`Action #${idx + 1}: 'data' sollte ein Objekt sein.`);
    }
  }

  function validateAutomation(auto, index) {
    const label = auto.alias || auto.id || `Automation ${index + 1}`;
    const collector = { error: [], warn: [], info: [], success: [] };

    if (!('trigger' in auto)) collector.warn.push(`Fehlender 'trigger' in ${label}.`);
    if (!('action' in auto)) collector.warn.push(`Fehlender 'action' in ${label}.`);
    if (!('condition' in auto)) collector.info.push(`Keine 'condition' in ${label} (läuft bei jedem Trigger).`);

    if ('trigger' in auto) {
      const tr = auto.trigger;
      if (Array.isArray(tr)) {
        if (tr.length === 0) collector.warn.push('Trigger-Liste ist leer.');
        tr.forEach((t, i) => validateTriggerItem(t, i, collector));
      } else if (typeof tr === 'object') {
        validateTriggerItem(tr, 0, collector);
      } else {
        collector.warn.push('trigger ist kein Objekt / Array.');
      }
    }

    if ('action' in auto) {
      const ac = auto.action;
      if (Array.isArray(ac)) {
        if (ac.length === 0) collector.warn.push('Action-Liste ist leer.');
        ac.forEach((a, i) => validateActionItem(a, i, collector));
      } else if (typeof ac === 'object') {
        validateActionItem(ac, 0, collector);
      } else {
        collector.warn.push('action ist kein Objekt / Array.');
      }
    }

    if (collector.error.length === 0 && collector.warn.length === 0) {
      collector.success.push(`Basisstruktur OK (${sanitize(label)})`);
    }
    return { label, ...collector };
  }

  function renderAutomationReport(report, idx) {
    const baseTitle = `Automation ${idx + 1}: ${report.label}`;
    report.error.forEach(m => addCard('error', baseTitle, sanitize(m)));
    report.warn.forEach(m => addCard('warn', baseTitle, sanitize(m)));
    report.info.forEach(m => addCard('info', baseTitle, sanitize(m)));
    report.success.forEach(m => addCard('success', baseTitle, sanitize(m)));
  }

  // Parsing (js-yaml vorausgesetzt)
  function parseAll(text) {
    try {
      return jsyaml.loadAll(text);
    } catch (e) {
      throw e;
    }
  }

  function prettyError(e) {
    if (!e || !e.mark) return sanitize(e.message || String(e));
    const { line, column } = e.mark;
    return `${sanitize(e.message)} (Zeile ${line + 1}, Spalte ${column + 1})`;
  }

  // Validierung starten
  function performValidation() {
    clearOutput();
    const text = (input && input.value || '').trim();
    if (!text) {
      addCard('warn', 'Keine Eingabe', 'Füge oben YAML ein und klicke auf <span class="code-frag">Prüfen</span>.');
      return;
    }

    let docs = [];
    try {
      docs = parseAll(text);
    } catch (err) {
      addCard('error', 'Parsing-Fehler', prettyError(err));
      return;
    }

    addCard('success', 'Parsing erfolgreich', `Es wurden <span class="code-frag">${docs.length}</span> Dokument(e) geladen.`);

    const root = docs.length === 1 ? docs[0] : (docs.length ? docs : null);
    const automations = root ? extractAutomations(root) : [];

    if (automations.length === 0) {
      addCard('info', 'Keine Automation erkannt', 'Es wurden keine offensichtlichen Automation-Objekte gefunden. Prüfe Struktur oder Schlüssel.');
    } else {
      automations.forEach((a, i) => {
        const report = validateAutomation(a, i);
        renderAutomationReport(report, i);
      });
    }

    if (jsonPreview) {
      jsonPreview.textContent = JSON.stringify(root, null, 2);
      jsonPreviewWrapper && jsonPreviewWrapper.classList.remove('hidden');
    }
  }

  // Event Listener
  validateBtn && validateBtn.addEventListener('click', performValidation);
  clearBtn && clearBtn.addEventListener('click', () => {
    if (input) input.value = '';
    clearOutput();
    input && input.focus();
  });
  sampleBtn && sampleBtn.addEventListener('click', () => {
    if (input) {
      input.value = `# Zwei Beispiel-Automationen
- alias: Licht an bei Bewegung
  trigger:
    - platform: state
      entity_id: binary_sensor.bewegung
      to: 'on'
  condition:
    - condition: time
      after: '06:00:00'
      before: '23:00:00'
  action:
    - service: light.turn_on
      target:
        entity_id: light.flur

- alias: Fenster Warnung
  trigger:
    - platform: state
      entity_id: binary_sensor.fenster
      to: 'on'
  action:
    - service: notify.mobile_app_handy
      data:
        message: Fenster wurde geöffnet!`;
      clearOutput();
    }
  });

  copyBtn && copyBtn.addEventListener('click', () => {
    if (!input || !input.value) return;
    navigator.clipboard.writeText(input.value)
      .then(() => {
        copyBtn.textContent = 'Kopiert!';
        setTimeout(() => copyBtn.textContent = 'Kopieren', 1600);
      })
      .catch(() => {
        copyBtn.textContent = 'Fehler';
        setTimeout(() => copyBtn.textContent = 'Kopieren', 1600);
      });
  });

  downloadBtn && downloadBtn.addEventListener('click', () => {
    if (!jsonPreview || !jsonPreview.textContent.trim()) return;
    const blob = new Blob([jsonPreview.textContent], { type: 'application/json' });
    const a = document.createElement('a');
    a.download = 'automation.json';
    a.href = URL.createObjectURL(blob);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  });

  input && input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) performValidation();
  });

  input && input.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  input && input.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file && /ya?ml$/i.test(file.name)) {
      file.text().then(t => {
        input.value = t;
        clearOutput();
      });
    }
  });

  // Auto-Resize
  function autoResize() {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight + 2, 1200) + 'px';
  }
  input && input.addEventListener('input', autoResize);
  setTimeout(autoResize, 60);

})();
