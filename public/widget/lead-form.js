(function () {
  // Mini CRM Lead Form Widget
  // Usage:
  // <script src="https://YOUR_CRM_BASE_URL/widget/lead-form.js" data-project-slug="demo"></script>

  function createStyleOnce() {
    if (document.getElementById('mini-crm-lead-widget-style')) return;
    var style = document.createElement('style');
    style.id = 'mini-crm-lead-widget-style';
    style.textContent =
      '.mini-crm-lead-form{max-width:400px;padding:16px;border:1px solid #ddd;border-radius:8px;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#fafafa;box-shadow:0 2px 4px rgba(0,0,0,0.04);}' +
      '.mini-crm-lead-form h3{margin-top:0;margin-bottom:12px;font-size:18px;}' +
      '.mini-crm-lead-form .mini-crm-field{margin-bottom:10px;display:flex;flex-direction:column;gap:4px;}' +
      '.mini-crm-lead-form label{font-size:13px;color:#444;}' +
      '.mini-crm-lead-form input,.mini-crm-lead-form textarea{padding:8px 10px;border-radius:4px;border:1px solid #ccc;font-size:14px;font-family:inherit;}' +
      '.mini-crm-lead-form textarea{min-height:70px;resize:vertical;}' +
      '.mini-crm-lead-form button{margin-top:4px;padding:8px 14px;border-radius:4px;border:none;background:#2563eb;color:#fff;font-size:14px;cursor:pointer;}' +
      '.mini-crm-lead-form button:disabled{opacity:.6;cursor:default;}' +
      '.mini-crm-lead-form .mini-crm-note{font-size:12px;color:#666;margin-top:6px;}' +
      '.mini-crm-lead-form .mini-crm-message{margin-top:8px;font-size:13px;}' +
      '.mini-crm-lead-form .mini-crm-message.ok{color:#15803d;}' +
      '.mini-crm-lead-form .mini-crm-message.err{color:#b91c1c;}';
    document.head.appendChild(style);
  }

  function getCurrentScript() {
    // Prefer document.currentScript, with fallback
    if (document.currentScript) return document.currentScript;
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1] || null;
  }

  function initWidget() {
    var scriptEl = getCurrentScript();
    if (!scriptEl) {
      console.error('[mini-crm] Cannot find current <script> element.');
      return;
    }

    var projectSlug = scriptEl.getAttribute('data-project-slug');
    var projectKey = scriptEl.getAttribute('data-project-key');
    if (!projectSlug) {
      console.error('[mini-crm] data-project-slug attribute is required on the <script> tag.');
      return;
    }

    var apiBaseOverride = scriptEl.getAttribute('data-api-base');
    var base;
    try {
      var url = new URL(scriptEl.src, window.location.href);
      base = url.origin;
    } catch (e) {
      base = window.location.origin;
    }
    var apiBase = apiBaseOverride || base;
    var endpoint = apiBase.replace(/\/+$/, '') + '/public/forms/' + encodeURIComponent(projectSlug) + '/lead';

    var configEndpoint =
      apiBase.replace(/\/+$/, '') +
      '/public/forms/' +
      encodeURIComponent(projectSlug) +
      '/lead/config';


    createStyleOnce();

    var container = document.createElement('div');
    container.style.display = 'none';
    var form = document.createElement('form');
    form.className = 'mini-crm-lead-form';
    form.innerHTML =
      '<h3 class="mini-crm-title">Залишити запит</h3>' +
      '<div class="mini-crm-field">' +
      '<label>Імʼя</label>' +
      '<input type="text" name="name" placeholder="Ваше імʼя" />' +
      '</div>' +
      '<div class="mini-crm-field">' +
      '<label>Email</label>' +
      '<input type="email" name="email" placeholder="you@example.com" />' +
      '</div>' +
      '<div class="mini-crm-field">' +
      '<label>Телефон</label>' +
      '<input type="tel" name="phone" placeholder="+380..." />' +
      '</div>' +
      '<div class="mini-crm-field">' +
      '<label>Коментар</label>' +
      '<div class="mini-crm-field mini-crm-hp" style="display:none;visibility:hidden;height:0;overflow:hidden;">' +
      '<label>Не заповнюйте це поле</label>' +
      '<input type="text" name="company" autocomplete="off" tabindex="-1" />' +
      '</div>' +
      '<textarea name="message" placeholder="Коротко опишіть ваш запит"></textarea>' +
      '</div>' +
      '<button type="submit">Надіслати</button>' +
      '<div class="mini-crm-note">Ми звʼяжемося з вами якнайшвидше.</div>' +
      '<div class="mini-crm-message" aria-live="polite"></div>';

    container.appendChild(form);

    var parent = scriptEl.parentNode;
    if (parent) {
      parent.insertBefore(container, scriptEl.nextSibling);
    } else {
      document.body.appendChild(container);
    }


    var messageEl = form.querySelector('.mini-crm-message');
    var submitBtn = form.querySelector('button[type="submit"]');

    var debug = false;
    try {
      debug = scriptEl.getAttribute('data-debug') === '1' || apiBase.indexOf('localhost') !== -1 || apiBase.indexOf('127.0.0.1') !== -1;
    } catch (e) {
      debug = false;
    }

    function setMessage(text, isError) {
      if (!messageEl) return;
      messageEl.textContent = text || '';
      messageEl.className = 'mini-crm-message ' + (text ? (isError ? 'err' : 'ok') : '');
    }

    function showInitError(text) {
      // Make widget visible but disabled, so integrator sees the reason.
      container.style.display = '';
      if (submitBtn) submitBtn.disabled = true;
      setMessage(text, true);
    }

    // Load config (title + active). If inactive or missing, do not render widget.
    (function () {
      if (!projectKey) {
        showInitError('Віджет не налаштовано: додайте data-project-key (publicKey) до <script>.');
        return;
      }
      try {
        fetch(configEndpoint, { method: 'GET', headers: { 'X-Project-Key': projectKey } })
          .then(function (r) {
            if (!r.ok) throw new Error('config ' + r.status);
            return r.json();
          })
          .then(function (cfg) {
            if (!cfg || cfg.isActive !== true) {
              if (container && container.parentNode) container.parentNode.removeChild(container);
              return;
            }
            var titleEl = form.querySelector('.mini-crm-title');
            if (titleEl && cfg.title) titleEl.textContent = String(cfg.title);
            container.style.display = '';
          })
          .catch(function (err) {
            // In production, fail closed (hide). In dev/debug, show reason.
            if (debug) {
              showInitError('Не вдалося завантажити конфіг віджета. Перевірте projectSlug/publicKey/CORS. (' + (err && err.message ? err.message : 'error') + ')');
              return;
            }
            if (container && container.parentNode) container.parentNode.removeChild(container);
          });
      } catch (e) {
        if (debug) {
          showInitError('Помилка ініціалізації віджета.');
          return;
        }
        if (container && container.parentNode) container.parentNode.removeChild(container);
      }
    })();

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      setMessage('', false);

      if (!submitBtn) return;
      submitBtn.disabled = true;

      var formData = new FormData(form);
      var hp = String(formData.get('company') || '').trim();
      var payload = {
        name: String(formData.get('name') || '').trim() || undefined,
        email: String(formData.get('email') || '').trim() || undefined,
        phone: String(formData.get('phone') || '').trim() || undefined,
        message: String(formData.get('message') || '').trim() || undefined,
        source: scriptEl.getAttribute('data-source') || 'widget',
        __hp: hp || undefined
      };

      if (!payload.name && !payload.email && !payload.phone) {
        setMessage('Вкажіть хоча б імʼя, email або телефон.', true);
        submitBtn.disabled = false;
        return;
      }

      var requestId = (window.crypto && typeof window.crypto.randomUUID === 'function')
        ? window.crypto.randomUUID()
        : (String(Date.now()) + '-' + Math.random().toString(16).slice(2));

      var headers = {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId
      };

      if (projectKey) {
        headers['X-Project-Key'] = projectKey;
      }

      fetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          if (!res.ok) {
            return res.json().catch(function () {
              return { error: 'Request failed with status ' + res.status };
            }).then(function (data) {
              throw new Error(data.error || 'Request failed with status ' + res.status);
            });
          }
          return res.json();
        })
        .then(function () {
          setMessage('Дякуємо! Ваш запит надіслано.', false);
          form.reset();
        })
        .catch(function (err) {
          console.error('[mini-crm] Lead submit error', err);
          setMessage('Сталася помилка. Спробуйте пізніше.', true);
        })
        .finally(function () {
          submitBtn.disabled = false;
        });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWidget);
  } else {
    initWidget();
  }
})();