(function () {
  'use strict';
  // Legacy thin-wrapper for backward compatibility.
  // It loads the unified /widget.js and forwards data-* attributes.

  function getCurrentScript() {
    if (document.currentScript) return document.currentScript;
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1] || null;
  }

  var legacyScript = getCurrentScript();
  if (!legacyScript) return;

  // If widget.js is already loaded, we still need to initialize a widget instance for this embed.
  // We do that by injecting another <script src="/widget/widget.js">; the browser will serve it from cache.

  var widgetUrl = new URL('./widget.js', legacyScript.src).toString();
  var s = document.createElement('script');
  s.src = widgetUrl;
  s.async = true;

  // Forward attributes (project, key, api base, button text, etc.)
  var ds = legacyScript.dataset || {};
  if (ds.projectSlug) s.dataset.projectSlug = ds.projectSlug;
  if (ds.projectKey) s.dataset.projectKey = ds.projectKey;
  if (ds.apiBase) s.dataset.apiBase = ds.apiBase;
  if (ds.demo) s.dataset.demo = ds.demo;
  if (ds.source) s.dataset.source = ds.source;

  // Back-compat: allow old embeds that used data-project / data-key
  if (!s.dataset.projectSlug && ds.project) s.dataset.projectSlug = ds.project;
  if (!s.dataset.projectKey && ds.key) s.dataset.projectKey = ds.key;

  // Force form key for this legacy entry point
  s.dataset.form = 'booking';

  // Optional UI overrides
  if (ds.buttonText) s.dataset.buttonText = ds.buttonText;
  else s.dataset.buttonText = 'Відкрити бронювання';

  // Insert right after the legacy script so the button appears in the same place
  var parent = legacyScript.parentNode;
  if (parent) parent.insertBefore(s, legacyScript.nextSibling);
  else document.body.appendChild(s);
})();
