(function () {
  'use strict';

  window.__MINI_CRM_WIDGET_LOADED__ = true;

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
            // Preserve structured server errors when possible
            var err = new Error(j.error || ('Request failed with status ' + res.status));
            err.status = res.status;
            if (j && typeof j === 'object') {
              err.payload = j;
            }
            throw err;
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

  function mountFormFromConfig(bodyEl, cfg) {
    bodyEl.innerHTML = '';
    var form = document.createElement('form');
    form.className = 'mini-crm-form';
    // Shared message element
    var msg = document.createElement('div');
    msg.className = 'mini-crm-message';
    msg.textContent = '';

    var fieldEls = {}; // name -> { input, err }

    function addErrorEl(wrap) {
      var e = document.createElement('div');
      e.className = 'mini-crm-message err mini-crm-hidden';
      e.setAttribute('data-field-error', '1');
      e.style.marginTop = '2px';
      e.style.fontSize = '12px';
      wrap.appendChild(e);
      return e;
    }

    function field(def) {
      var label = def.label || def.name;
      var name = def.name;
      var type = def.type || 'text';
      var required = !!def.required;
      var placeholder = def.placeholder || '';

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
        if (type === 'amount' || type === 'number') {
          el.type = 'number';
        } else if (type === 'checkbox') {
          el.type = 'checkbox';
        } else {
          el.type = type || 'text';
        }
      }
      el.name = name;
      if (placeholder && el.type !== 'checkbox') el.placeholder = placeholder;
      if (required) el.required = true;
      if (def.min != null && el.type === 'number') el.min = String(def.min);
      if (def.max != null && el.type === 'number') el.max = String(def.max);
      if (def.pattern && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        try { el.pattern = String(def.pattern); } catch (e) {}
      }
      if (type === 'amount') {
        // Allow decimals by default
        el.step = def.step != null ? String(def.step) : '0.01';
      }
      if (type === 'number' && !el.step) {
        el.step = def.step != null ? String(def.step) : '1';
      }

      wrap.appendChild(el);

      // Select options
      if (el.tagName === 'SELECT') {
        var options = def.options || [];
        if (!options.length) {
          var opEmpty = document.createElement('option');
          opEmpty.value = '';
          opEmpty.textContent = '—';
          el.appendChild(opEmpty);
        }
        options.forEach(function (o) {
          var op = document.createElement('option');
          op.value = o.value != null ? String(o.value) : '';
          op.textContent = o.label != null ? String(o.label) : String(o.value || '');
          el.appendChild(op);
        });
      }

      var errEl = addErrorEl(wrap);
      fieldEls[name] = { input: el, err: errEl, def: def };
      return { wrap: wrap, input: el, err: errEl };
    }

    function row(a, b) {
      var r = document.createElement('div');
      r.className = 'mini-crm-row';
      r.appendChild(a.wrap);
      r.appendChild(b.wrap);
      return r;
    }

    // Honeypot anti-bot
    var hp = field({ label: 'Website', name: 'website', type: 'text', required: false });
    hp.wrap.className += ' mini-crm-hidden';
    hp.input.autocomplete = 'off';
    hp.input.tabIndex = -1;
    form.appendChild(hp.wrap);

    // Dynamic fields from config
    var defs = (cfg && cfg.fields) ? cfg.fields : [];
    defs.forEach(function (d) {
      if (!d || !d.name) return;
      // Never render internal honeypot name
      if (d.name === 'website') return;
      form.appendChild(field(d).wrap);
    });

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

    function clearFieldErrors() {
      Object.keys(fieldEls).forEach(function (k) {
        var fe = fieldEls[k];
        if (!fe || !fe.err) return;
        fe.err.textContent = '';
        fe.err.className = 'mini-crm-message err mini-crm-hidden';
      });
    }

    function setFieldError(name, message) {
      var fe = fieldEls[name];
      if (!fe || !fe.err) return;
      fe.err.textContent = message || 'Invalid value';
      fe.err.className = 'mini-crm-message err';
    }

    function getValueForDef(def, el) {
      if (!el) return null;
      if (def.type === 'checkbox') {
        return !!el.checked;
      }
      var s = (el.value == null ? '' : String(el.value)).trim();
      if (!s) return '';
      if (def.type === 'amount' || def.type === 'number') {
        var n = parseFloat(s);
        if (!isFinite(n)) return s;
        return n;
      }
      return s;
    }

    function validateClient() {
      clearFieldErrors();
      var ok = true;

      // HTML5 built-in constraints first
      Object.keys(fieldEls).forEach(function (k) {
        if (k === 'website') return;
        var fe = fieldEls[k];
        var el = fe.input;
        if (!el || el.type === 'checkbox') return;
        if (typeof el.checkValidity === 'function' && !el.checkValidity()) {
          ok = false;
          // Use validationMessage when available
          setFieldError(k, el.validationMessage || 'Invalid value');
        }
      });

      // Custom: requireOneOf
      var ro = cfg && cfg.rules && cfg.rules.requireOneOf;
      if (ro && ro.length) {
        var any = false;
        ro.forEach(function (name) {
          var fe = fieldEls[name];
          if (!fe) return;
          var v = getValueForDef(fe.def || { type: 'text' }, fe.input);
          if (typeof v === 'string') {
            if (v.trim()) any = true;
          } else if (v != null && v !== false) {
            any = true;
          }
        });
        if (!any) {
          ok = false;
          // Attach message to the first field in group
          setFieldError(ro[0], 'Заповніть хоча б одне з полів: ' + ro.join(', '));
        }
      }

      return ok;
    }

    return {
      form: form,
      submitBtn: submit,
      setMessage: setMessage
      ,clearFieldErrors: clearFieldErrors
      ,setFieldError: setFieldError
      ,getValueForDef: getValueForDef
      ,validateClient: validateClient
    };
  }

  function initWidget() {
    var scriptEl = getCurrentScript();
    if (!scriptEl) return;

    var projectSlug = scriptEl.getAttribute('data-project-slug');
    var projectKey = scriptEl.getAttribute('data-project-key');
    var formType = normFormType(scriptEl.getAttribute('data-form'));
    var buttonText = scriptEl.getAttribute('data-button-text') || 'Відкрити форму';
    var titleText = scriptEl.getAttribute('data-title') || '';
    var sourceText = scriptEl.getAttribute('data-source') || '';

    var demoAttr = scriptEl.getAttribute('data-demo');
    var isDemo = (demoAttr === '1' || demoAttr === 'true' || demoAttr === 'yes');

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

    titleEl.textContent = titleText || 'Форма';

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

    // UI will be mounted after config is loaded
    var ui = null;
    var loadedCfg = null;

    btn.addEventListener('click', function () {
      if (!ui) return;
      ui.setMessage('', false);
      ui.clearFieldErrors();
      open();
    });

    // Load config and enable button
    // IMPORTANT: do not send Authorization cross-origin.
    // For /admin/preview.html (same-origin) we can attach the admin JWT to bypass strict allowlists.
    var cfgHeaders = { 'X-Project-Key': projectKey };
    try {
      var sameOrigin = false;
      try { sameOrigin = (new URL(apiBase)).origin === window.location.origin; } catch (e) { sameOrigin = false; }
      if (sameOrigin) {
        // Admin UI stores token under 'mini-crm-admin-token'. Keep backward compatibility with 'token'.
        var t = null;
        try {
          if (window.localStorage) {
            t = window.localStorage.getItem('mini-crm-admin-token') || window.localStorage.getItem('token') || null;
          }
          if (!t && window.sessionStorage) {
            t = window.sessionStorage.getItem('mini-crm-admin-token') || window.sessionStorage.getItem('token') || null;
          }
        } catch (e) {
          t = null;
        }
        if (t) cfgHeaders['Authorization'] = 'Bearer ' + t;
      }
    } catch (e) {}

    jsonFetch(configUrl, { method: 'GET', headers: cfgHeaders })
      .then(function (cfg) {
        loadedCfg = cfg || null;
        // Convention: if isActive===false -> hide
        if (cfg && cfg.isActive === false) {
          btn.className += ' mini-crm-hidden';
          return;
        }

        // Title from config unless explicitly set
        if (!titleText && cfg && cfg.title) {
          titleEl.textContent = cfg.title;
        }

        ui = mountFormFromConfig(bodyEl, cfg);
        btn.disabled = false;
      })
      .catch(function (err) {
        console.error('[mini-crm] Widget config error', err);
        // Hide button on config failure (prevents broken UX)
        btn.className += ' mini-crm-hidden';
      });

    // Submit handler
    // Submit handler (delegated after form mount)
    bodyEl.addEventListener('submit', function (e) {
      if (!ui || e.target !== ui.form) return;
      e.preventDefault();
      ui.setMessage('', false);
      ui.clearFieldErrors();

      if (!ui.validateClient()) {
        ui.setMessage('Перевірте поля форми.', true);
        return;
      }

      var fd = new FormData(ui.form);
      // Honeypot: drop silently
      if ((fd.get('website') || '').toString().trim()) return;

      var payload = {};
      // Build payload from config defs to keep consistent types
      var defs = (loadedCfg && loadedCfg.fields) ? loadedCfg.fields : [];
      defs.forEach(function (d) {
        if (!d || !d.name || d.name === 'website') return;
        var fe = ui.getValueForDef ? ui.getValueForDef(d, ui.form.elements[d.name]) : null;
        if (d.type === 'checkbox') {
          // Always send boolean for checkbox
          payload[d.name] = !!fe;
          return;
        }
        if (fe == null) return;
        if (typeof fe === 'string') {
          var s = fe.trim();
          if (!s) return;
          payload[d.name] = s;
          return;
        }
        // number/amount
        payload[d.name] = fe;
      });

      // Also include any non-schema fields that might be present (forward compatible)
      fd.forEach(function (v, k) {
        if (k === 'website') return;
        if (payload.hasOwnProperty(k)) return;
        var s = (v == null ? '' : String(v)).trim();
        if (!s) return;
        payload[k] = s;
      });


      // Auto source (hidden field): explicit data-source wins; otherwise <form>-widget
      if (!payload.source) {
        var src = (sourceText || '').toString().trim();
        if (!src) src = String(formType || 'widget') + '-widget';
        payload.source = src;
      }

      // Demo mode: do not send or persist data.
      if (isDemo) {
        try {
          console.info('[mini-crm][demo] Submit blocked (no DB write). Payload:', payload);
        } catch (e) {}
        ui.setMessage('Демо-режим: дані не відправляються і не зберігаються.', false);
        return;
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
                var err = new Error(j.error || ('Request failed with status ' + res.status));
                err.status = res.status;
                err.payload = j;
                throw err;
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
          // Map server field errors
          if (err && err.payload && err.payload.details && err.payload.details.length) {
            err.payload.details.forEach(function (d) {
              if (d && d.field) ui.setFieldError(d.field, d.message || 'Invalid');
            });
            ui.setMessage(err.payload.error || 'Перевірте поля форми.', true);
          } else {
            ui.setMessage('Сталася помилка. Спробуйте пізніше.', true);
          }
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