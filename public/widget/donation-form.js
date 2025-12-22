(function () {
  function createStyleOnce() {
    if (document.getElementById('mini-crm-donation-widget-style')) return;
    var style = document.createElement('style');
    style.id = 'mini-crm-donation-widget-style';
    style.textContent =
      ".mini-crm-donation-form{max-width:420px;padding:16px;border:1px solid rgba(148,163,184,0.6);border-radius:8px;background:#fafafa;box-shadow:0 2px 4px rgba(15,23,42,0.05);font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}" +
      ".mini-crm-donation-form h3{margin-top:0;margin-bottom:12px;font-size:18px;}" +
      ".mini-crm-donation-form .mini-crm-field{margin-bottom:10px;display:flex;flex-direction:column;gap:4px;}" +
      ".mini-crm-donation-form label{font-size:13px;color:#444;}" +
      ".mini-crm-donation-form input,.mini-crm-donation-form textarea{padding:6px 8px;border-radius:4px;border:1px solid #cbd5e1;font-size:14px;font-family:inherit;}" +
      ".mini-crm-donation-form textarea{min-height:70px;resize:vertical;}" +
      ".mini-crm-donation-form .mini-crm-row{display:flex;gap:8px;flex-wrap:wrap;}" +
      ".mini-crm-donation-form .mini-crm-row .mini-crm-field{flex:1 1 0;min-width:140px;}" +
      ".mini-crm-donation-form button{margin-top:4px;padding:8px 14px;border-radius:4px;border:none;background:#16a34a;color:#fff;font-size:14px;cursor:pointer;}" +
      ".mini-crm-donation-form button:disabled{opacity:.6;cursor:default;}" +
      ".mini-crm-donation-form .mini-crm-note{font-size:12px;color:#64748b;margin-top:6px;}" +
      ".mini-crm-donation-form .mini-crm-message{margin-top:8px;font-size:13px;}" +
      ".mini-crm-donation-form .mini-crm-message.ok{color:#15803d;}" +
      ".mini-crm-donation-form .mini-crm-message.err{color:#b91c1c;}" +
      ".mini-crm-donation-form .mini-crm-hp{display:none;visibility:hidden;height:0;overflow:hidden;}";
    document.head.appendChild(style);
  }

  function getCurrentScript() {
    if (document.currentScript) return document.currentScript;
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1] || null;
  }

  function initWidget() {
    var scriptEl = getCurrentScript();
    if (!scriptEl) {
      console.error('[mini-crm] Cannot find current <script> element for donation widget.');
      return;
    }

    var projectSlug = scriptEl.getAttribute('data-project-slug');
    var projectKey = scriptEl.getAttribute('data-project-key');
    if (!projectSlug) {
      console.error('[mini-crm] data-project-slug attribute is required on the <script> tag for donation widget.');
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
    var endpoint =
      apiBase.replace(/\/+$/, '') +
      '/public/forms/' +
      encodeURIComponent(projectSlug) +
      '/donation';

    var configEndpoint =
      apiBase.replace(/\/+$/, '') +
      '/public/forms/' +
      encodeURIComponent(projectSlug) +
      '/donation/config';


    createStyleOnce();

    var container = document.createElement('div');
    container.style.display = 'none';
    var form = document.createElement('form');
    form.className = 'mini-crm-donation-form';
    form.innerHTML =
      '<h3 class="mini-crm-title">Пожертвувати</h3>' +
      '<div class="mini-crm-row">' +
      '<div class="mini-crm-field">' +
      '<label>Імʼя</label>' +
      '<input type="text" name="name" placeholder="Ваше імʼя" />' +
      '</div>' +
      '<div class="mini-crm-field">' +
      '<label>Email</label>' +
      '<input type="email" name="email" placeholder="you@example.com" />' +
      '</div>' +
      '</div>' +
      '<div class="mini-crm-row">' +
      '<div class="mini-crm-field">' +
      '<label>Телефон</label>' +
      '<input type="tel" name="phone" placeholder="+380..." />' +
      '</div>' +
      '<div class="mini-crm-field">' +
      '<label>Сума, грн</label>' +
      '<input type="number" name="amount" min="1" step="1" placeholder="500" required />' +
      '</div>' +
      '</div>' +
      '<div class="mini-crm-field">' +
      '<label>Коментар (необовʼязково)</label>' +
      '<textarea name="message" placeholder="Напишіть, для чого/кого це пожертвування (за бажанням)"></textarea>' +
      '</div>' +
      '<div class="mini-crm-field mini-crm-hp">' +
      '<label>Не заповнюйте це поле</label>' +
      '<input type="text" name="company" autocomplete="off" tabindex="-1" />' +
      '</div>' +
      '<button type="submit">Надіслати</button>' +
      '<div class="mini-crm-note">Форма призначена лише для збору контактних даних та суми. Платіж ви робите окремо (банківська програма, LiqPay тощо).</div>' +
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
      var amountRaw = String(formData.get('amount') || '').trim();

      var payload = {
        name: String(formData.get('name') || '').trim() || undefined,
        email: String(formData.get('email') || '').trim() || undefined,
        phone: String(formData.get('phone') || '').trim() || undefined,
        amount: amountRaw ? Number(amountRaw) : undefined,
        message: String(formData.get('message') || '').trim() || undefined,
        source: scriptEl.getAttribute('data-source') || 'donation-widget',
        __hp: hp || undefined
      };

      if (!payload.name && !payload.email && !payload.phone) {
        setMessage('Вкажіть хоча б імʼя, email або телефон.', true);
        submitBtn.disabled = false;
        return;
      }

      if (!payload.amount || isNaN(payload.amount) || payload.amount <= 0) {
        setMessage('Вкажіть коректну суму пожертвування.', true);
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
              return { error: 'Request failed, status ' + res.status };
            }).then(function (data) {
              throw new Error(data.error || 'Request failed with status ' + res.status);
            });
          }
          return res.json();
        })
        .then(function () {
          setMessage('Дякуємо! Ваше пожертвування зафіксовано у CRM.', false);
          form.reset();
        })
        .catch(function (err) {
          console.error('[mini-crm] Donation submit error', err);
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
