(function () {
  'use strict';

  // Mini CRM Embed Widget (button + modal + form)
  // Usage:
  // <script src="https://<crm>/widget.js"
  //   data-project-slug="volunteers-odesa-dev"
  //   data-project-key="PUBLIC_KEY"
  //   data-form="feedback|lead|donation|booking"
  //   data-button-text="Open form"
  //   data-api-base="https://mini-crm-core.onrender.com"></script>

  function getCurrentScript() {
    // document.currentScript is not available in older browsers
    if (document.currentScript) return document.currentScript;
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1] || null;
  }

  function ensureStyleOnce() {
    if (document.getElementById('mini-crm-widget-style')) return;
    var style = document.createElement('style');
    style.id = 'mini-crm-widget-style';
    style.textContent =
      ".mini-crm-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 14px;border-radius:12px;border:1px solid rgba(0,0,0,.15);background:#111;color:#fff;cursor:pointer;font:600 14px/1.1 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}"+
      ".mini-crm-btn:hover{filter:brightness(1.07)}"+
      ".mini-crm-btn:disabled{opacity:.6;cursor:not-allowed}"+
      ".mini-crm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:2147483647;padding:16px}"+
      ".mini-crm-modal{width:min(520px,100%);background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.35);overflow:hidden}"+
      ".mini-crm-modal__head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(0,0,0,.08)}"+
      ".mini-crm-modal__title{margin:0;font:700 16px/1.2 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111}"+
      ".mini-crm-x{border:0;background:transparent;cursor:pointer;font-size:20px;line-height:1;padding:6px;border-radius:10px}"+
      ".mini-crm-x:hover{background:rgba(0,0,0,.06)}"+
      ".mini-crm-modal__body{padding:16px}"+
      ".mini-crm-form{font:14px/1.35 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111}"+
      ".mini-crm-form .mini-crm-field{margin-bottom:10px;display:flex;flex-direction:column;gap:6px}"+
      ".mini-crm-form label{font-size:12px;color:rgba(0,0,0,.7)}"+
      ".mini-crm-form input,.mini-crm-form textarea, .mini-crm-form select{border:1px solid rgba(0,0,0,.2);border-radius:12px;padding:10px 12px;font:inherit}"+
      ".mini-crm-form textarea{min-height:96px;resize:vertical}"+
      ".mini-crm-row{display:flex;gap:10px}"+
      ".mini-crm-row > *{flex:1}"+
      ".mini-crm-submit{margin-top:8px;width:100%;padding:10px 14px;border-radius:12px;border:0;background:#111;color:#fff;cursor:pointer;font:700 14px/1.2 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}"+
      ".mini-crm-submit:hover{filter:brightness(1.07)}"+
      ".mini-crm-message{margin-top:10px;font-size:13px}"+
      ".mini-crm-message.ok{color:#0a7a2b}"+
      ".mini-crm-message.err{color:#b00020}"+
      ".mini-crm-hidden{display:none !important}";
    document.head.appendChild(style);
  }

  function normFormType(s) {
    s = (s || '').toLowerCase().trim();
    if (s === 'lead' || s === 'feedback' || s === 'donation' || s === 'booking') return s;
    return 'feedback';
  }

  function resolveApiBase(scriptEl) {
    var apiBaseOverride = scriptEl.getAttribute('data-api-base');
    if (apiBaseOverride) return apiBaseOverride.replace(/\/+$/, '');
    try {
      var url = new URL(scriptEl.src, window.location.href);
      return url.origin;
    } catch (e) {
      return '';
    }
  }

  function jsonFetch(url, opts) {
    opts = opts || {};
    return fetch(url, opts).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          try {
            var j = JSON.parse(t);
            throw new Error(j.error || ('Request failed with status ' + res.status));
          } catch (e) {
            throw new Error(t || ('Request failed with status ' + res.status));
          }
        });
      }
      return res.json();
    });
  }

  function createOverlay() {
    var overlay = document.createElement('div');
    overlay.className = 'mini-crm-overlay';
    overlay.innerHTML =
      '<div class="mini-crm-modal" role="dialog" aria-modal="true">' +
      '  <div class="mini-crm-modal__head">' +
      '    <h3 class="mini-crm-modal__title"> </h3>' +
      '    <button type="button" class="mini-crm-x" aria-label="Close">×</button>' +
      '  </div>' +
      '  <div class="mini-crm-modal__body"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  function mountForm(bodyEl, formType) {
    bodyEl.innerHTML = '';
    var form = document.createElement('form');
    form.className = 'mini-crm-form';
    // Shared message element
    var msg = document.createElement('div');
    msg.className = 'mini-crm-message';
    msg.textContent = '';

    function field(label, name, type, required, placeholder) {
      var wrap = document.createElement('div');
      wrap.className = 'mini-crm-field';
      var l = document.createElement('label');
      l.textContent = label + (required ? ' *' : '');
      wrap.appendChild(l);
      var el;
      if (type === 'textarea') {
        el = document.createElement('textarea');
      } else if (type === 'select') {
        el = document.createElement('select');
      } else {
        el = document.createElement('input');
        el.type = type || 'text';
      }
      el.name = name;
      if (placeholder) el.placeholder = placeholder;
      if (required) el.required = true;
      wrap.appendChild(el);
      return { wrap: wrap, input: el };
    }

    function row(a, b) {
      var r = document.createElement('div');
      r.className = 'mini-crm-row';
      r.appendChild(a.wrap);
      r.appendChild(b.wrap);
      return r;
    }

    // Build fields by type (kept consistent with existing dedicated scripts)
    var fName = field("Імʼя", 'name', 'text', true, '');
    var fPhone = field('Телефон', 'phone', 'tel', false, '+380…');
    var fEmail = field('Email', 'email', 'email', false, '');
    var fMessage = field('Повідомлення', 'message', 'textarea', true, 'Напишіть коротко…');

    var donateAmount = field('Сума (грн)', 'amount', 'number', true, '100');
    donateAmount.input.min = '1';
    donateAmount.input.step = '1';

    var bookingDate = field('Дата', 'date', 'date', true, '');
    var bookingTime = field('Час', 'time', 'time', true, '');
    var bookingCount = field('Кількість людей', 'peopleCount', 'number', false, '1');
    bookingCount.input.min = '1';
    bookingCount.input.step = '1';

    var leadTopic = field('Тема', 'topic', 'text', false, 'Запит');
    var feedbackRating = field('Оцінка', 'rating', 'select', false, '');
    if (feedbackRating.input && feedbackRating.input.tagName === 'SELECT') {
      var opts = [
        { v: '', t: '—' },
        { v: '5', t: '5 (відмінно)' },
        { v: '4', t: '4' },
        { v: '3', t: '3' },
        { v: '2', t: '2' },
        { v: '1', t: '1' }
      ];
      opts.forEach(function (o) {
        var op = document.createElement('option');
        op.value = o.v;
        op.textContent = o.t;
        feedbackRating.input.appendChild(op);
      });
    }

    // Honeypot anti-bot
    var hp = field('Website', 'website', 'text', false, '');
    hp.wrap.className += ' mini-crm-hidden';
    hp.input.autocomplete = 'off';
    hp.input.tabIndex = -1;

    form.appendChild(hp.wrap);

    if (formType === 'donation') {
      form.appendChild(donateAmount.wrap);
      form.appendChild(row(fName, fPhone));
      form.appendChild(fEmail.wrap);
      form.appendChild(fMessage.wrap);
    } else if (formType === 'booking') {
      form.appendChild(row(fName, fPhone));
      form.appendChild(fEmail.wrap);
      form.appendChild(row(bookingDate, bookingTime));
      form.appendChild(bookingCount.wrap);
      form.appendChild(fMessage.wrap);
    } else if (formType === 'lead') {
      form.appendChild(row(fName, fPhone));
      form.appendChild(fEmail.wrap);
      form.appendChild(leadTopic.wrap);
      form.appendChild(fMessage.wrap);
    } else { // feedback
      form.appendChild(row(fName, fPhone));
      form.appendChild(fEmail.wrap);
      form.appendChild(feedbackRating.wrap);
      form.appendChild(fMessage.wrap);
    }

    var submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'mini-crm-submit';
    submit.textContent = 'Надіслати';
    form.appendChild(submit);
    form.appendChild(msg);

    bodyEl.appendChild(form);

    function setMessage(text, isErr) {
      msg.textContent = text || '';
      msg.className = 'mini-crm-message ' + (text ? (isErr ? 'err' : 'ok') : '');
    }

    return {
      form: form,
      submitBtn: submit,
      setMessage: setMessage
    };
  }

  function initWidget() {
    var scriptEl = getCurrentScript();
    if (!scriptEl) return;

    var projectSlug = scriptEl.getAttribute('data-project-slug');
    var projectKey = scriptEl.getAttribute('data-project-key');
    var formType = normFormType(scriptEl.getAttribute('data-form'));
    var buttonText = scriptEl.getAttribute('data-button-text') || 'Відкрити форму';
    var titleText = scriptEl.getAttribute('data-title') || (
      formType === 'donation' ? 'Пожертва' :
      formType === 'booking' ? 'Бронювання' :
      formType === 'lead' ? 'Запит' :
      'Відгук'
    );

    if (!projectSlug) {
      console.error('[mini-crm] data-project-slug is required for widget');
      return;
    }
    if (!projectKey) {
      console.error('[mini-crm] data-project-key is required for widget');
      return;
    }

    ensureStyleOnce();

    var apiBase = resolveApiBase(scriptEl);
    if (!apiBase) {
      console.error('[mini-crm] Could not resolve API base. Provide data-api-base.');
      return;
    }

    // Verify config active before showing button
    var configUrl = apiBase + '/public/forms/' + encodeURIComponent(projectSlug) + '/' + encodeURIComponent(formType) + '/config';

    // Create button right after script
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mini-crm-btn';
    btn.textContent = buttonText;
    btn.disabled = true;

    var parent = scriptEl.parentNode;
    if (parent) parent.insertBefore(btn, scriptEl.nextSibling);
    else document.body.appendChild(btn);

    // Shared overlay per widget instance
    var overlay = createOverlay();
    var modal = overlay.querySelector('.mini-crm-modal');
    var titleEl = overlay.querySelector('.mini-crm-modal__title');
    var bodyEl = overlay.querySelector('.mini-crm-modal__body');
    var closeBtn = overlay.querySelector('.mini-crm-x');

    titleEl.textContent = titleText;

    function open() {
      overlay.style.display = 'flex';
      // focus close for accessibility
      try { closeBtn.focus(); } catch (e) {}
      document.documentElement.style.overflow = 'hidden';
    }

    function close() {
      overlay.style.display = 'none';
      document.documentElement.style.overflow = '';
      try { btn.focus(); } catch (e) {}
    }

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (overlay.style.display === 'flex' && (e.key === 'Escape' || e.key === 'Esc')) close();
    });

    // Prepare form (UI only) now; wire submit after config loaded
    var ui = mountForm(bodyEl, formType);

    btn.addEventListener('click', function () {
      ui.setMessage('', false);
      open();
    });

    // Load config and enable button
    jsonFetch(configUrl, { method: 'GET', headers: { 'X-Project-Key': projectKey } })
      .then(function (cfg) {
        // Convention: if cfg.active===false -> disable
        if (cfg && cfg.active === false) {
          btn.className += ' mini-crm-hidden';
          return;
        }
        btn.disabled = false;
      })
      .catch(function (err) {
        console.error('[mini-crm] Widget config error', err);
        // Hide button on config failure (prevents broken UX)
        btn.className += ' mini-crm-hidden';
      });

    // Submit handler
    ui.form.addEventListener('submit', function (e) {
      e.preventDefault();
      ui.setMessage('', false);

      var fd = new FormData(ui.form);
      // Honeypot: drop silently
      if ((fd.get('website') || '').toString().trim()) return;

      var payload = {};
      fd.forEach(function (v, k) {
        if (k === 'website') return;
        var s = (v == null ? '' : String(v)).trim();
        if (!s) return;
        payload[k] = s;
      });

      // Type-specific normalize
      if (formType === 'donation' && payload.amount) {
        var n = parseInt(payload.amount, 10);
        if (!isFinite(n) || n <= 0) {
          ui.setMessage('Вкажіть коректну суму.', true);
          return;
        }
        payload.amount = n;
      }

      ui.submitBtn.disabled = true;

      var submitUrl = apiBase + '/public/forms/' + encodeURIComponent(projectSlug) + '/' + encodeURIComponent(formType);
      fetch(submitUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Project-Key': projectKey
        },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          if (!res.ok) {
            return res.text().then(function (t) {
              try {
                var j = JSON.parse(t);
                throw new Error(j.error || ('Request failed with status ' + res.status));
              } catch (e) {
                throw new Error(t || ('Request failed with status ' + res.status));
              }
            });
          }
          return res.json();
        })
        .then(function () {
          ui.setMessage('Дякуємо! Заявка зафіксована у CRM.', false);
          ui.form.reset();
        })
        .catch(function (err) {
          console.error('[mini-crm] Widget submit error', err);
          ui.setMessage('Сталася помилка. Спробуйте пізніше.', true);
        })
        .finally(function () {
          ui.submitBtn.disabled = false;
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWidget);
  } else {
    initWidget();
  }
})();