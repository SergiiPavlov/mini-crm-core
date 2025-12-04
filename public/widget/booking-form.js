(function () {
  function createStyleOnce() {
    if (document.getElementById('mini-crm-booking-widget-style')) return;
    var style = document.createElement('style');
    style.id = 'mini-crm-booking-widget-style';
    style.textContent =
      ".mini-crm-booking-form{max-width:420px;padding:16px;border:1px solid rgba(148,163,184,0.6);border-radius:8px;background:#fafafa;box-shadow:0 2px 4px rgba(15,23,42,0.05);font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}" +
      ".mini-crm-booking-form h3{margin-top:0;margin-bottom:12px;font-size:18px;}" +
      ".mini-crm-booking-form .mini-crm-field{margin-bottom:10px;display:flex;flex-direction:column;gap:4px;}" +
      ".mini-crm-booking-form label{font-size:13px;color:#444;}" +
      ".mini-crm-booking-form input,.mini-crm-booking-form textarea{padding:6px 8px;border-radius:4px;border:1px solid #cbd5e1;font-size:14px;font-family:inherit;}" +
      ".mini-crm-booking-form textarea{min-height:70px;resize:vertical;}" +
      ".mini-crm-booking-form .mini-crm-row{display:flex;gap:8px;flex-wrap:wrap;}" +
      ".mini-crm-booking-form .mini-crm-row .mini-crm-field{flex:1 1 0;min-width:140px;}" +
      ".mini-crm-booking-form button{margin-top:4px;padding:8px 14px;border-radius:4px;border:none;background:#0284c7;color:#fff;font-size:14px;cursor:pointer;}" +
      ".mini-crm-booking-form button:disabled{opacity:.6;cursor:default;}" +
      ".mini-crm-booking-form .mini-crm-note{font-size:12px;color:#64748b;margin-top:6px;}" +
      ".mini-crm-booking-form .mini-crm-message{margin-top:8px;font-size:13px;}" +
      ".mini-crm-booking-form .mini-crm-message.ok{color:#15803d;}" +
      ".mini-crm-booking-form .mini-crm-message.err{color:#b91c1c;}" +
      ".mini-crm-booking-form .mini-crm-hp{display:none;visibility:hidden;height:0;overflow:hidden;}";
    document.head.appendChild(style);
  }

  function getCurrentScript() {
    if (document.currentScript) return document.currentScript;
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1] || null;
  }

  function initWidget() {
    var scriptEl = getCurrentScript();
    if (!scriptEl) return;

    var projectSlug = scriptEl.getAttribute('data-project-slug');
    if (!projectSlug) {
      console.error('[mini-crm] data-project-slug is required for booking widget');
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
      '/booking';

    createStyleOnce();

    var container = document.createElement('div');
    var form = document.createElement('form');
    form.className = 'mini-crm-booking-form';
    form.innerHTML =
      '<h3>Запис / бронювання</h3>' +
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
      '<label>Послуга</label>' +
      '<input type="text" name="service" placeholder="Консультація / екскурсія / тощо" />' +
      '</div>' +
      '</div>' +
      '<div class="mini-crm-row">' +
      '<div class="mini-crm-field">' +
      '<label>Дата</label>' +
      '<input type="date" name="date" />' +
      '</div>' +
      '<div class="mini-crm-field">' +
      '<label>Час</label>' +
      '<input type="time" name="time" />' +
      '</div>' +
      '</div>' +
      '<div class="mini-crm-field">' +
      '<label>Коментар</label>' +
      '<textarea name="message" placeholder="Деталі запиту, побажання тощо"></textarea>' +
      '</div>' +
      '<div class="mini-crm-field mini-crm-hp">' +
      '<label>Не заповнюйте це поле</label>' +
      '<input type="text" name="company" autocomplete="off" tabindex="-1" />' +
      '</div>' +
      '<button type="submit">Надіслати запит</button>' +
      '<div class="mini-crm-note">Ми звʼяжемося з вами для підтвердження запису.</div>' +
      '<div class="mini-crm-message" aria-live="polite"></div>';

    container.appendChild(form);

    var parent = scriptEl.parentNode;
    if (parent) parent.insertBefore(container, scriptEl.nextSibling);
    else document.body.appendChild(container);

    var messageEl = form.querySelector('.mini-crm-message');
    var submitBtn = form.querySelector('button[type="submit"]');

    function setMessage(text, isError) {
      if (!messageEl) return;
      messageEl.textContent = text || '';
      messageEl.className = 'mini-crm-message ' + (text ? (isError ? 'err' : 'ok') : '');
    }

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
        service: String(formData.get('service') || '').trim() || undefined,
        date: String(formData.get('date') || '').trim() || undefined,
        time: String(formData.get('time') || '').trim() || undefined,
        message: String(formData.get('message') || '').trim() || undefined,
        source: scriptEl.getAttribute('data-source') || 'booking-widget',
        __hp: hp || undefined,
      };

      if (!payload.name && !payload.email && !payload.phone) {
        setMessage('Вкажіть хоча б імʼя, email або телефон.', true);
        submitBtn.disabled = false;
        return;
      }

      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          if (!res.ok) {
            return res
              .json()
              .catch(function () {
                return { error: 'Request failed, status ' + res.status };
              })
              .then(function (data) {
                throw new Error(data.error || 'Request failed with status ' + res.status);
              });
          }
          return res.json();
        })
        .then(function () {
          setMessage('Дякуємо! Ваш запит зафіксовано у CRM.', false);
          form.reset();
        })
        .catch(function (err) {
          console.error('[mini-crm] Booking submit error', err);
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