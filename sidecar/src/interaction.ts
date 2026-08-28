/**
 * Helper de interacción que YATT inyecta en la página bajo prueba.
 *
 * Modelo de captura "acción primero, objetivo después": se arma una acción en la
 * barra flotante y el siguiente clic sobre la página es el objetivo (la página
 * no reacciona: el clic se intercepta). Los valores se piden inline en la barra.
 *
 * Aspecto: lenguaje visual de shadcn/ui (tokens oscuros, radios, estados
 * hover/focus-visible) con iconos de lucide (SVG inline generados por
 * scripts/gen-icons.ts). La barra es draggable (asa superior) y recuerda su
 * posición en sessionStorage.
 *
 * Acciones RF-04: click, doble click, hover, escribir, limpiar, seleccionar
 * opción real de un <select>, checkbox, tecla, esperar visible, scroll al
 * elemento, asserts (visible/oculto/texto/valor/atributo) y screenshot.
 * También "modo re-grabado": con `window.__yattGrab = true` el siguiente clic
 * devuelve el selector vía `window.__yattGrabResult`.
 */

import { ICONS } from "./icons.ts";

const CSS = `
  .yatt-tk, .yatt-tk * { box-sizing: border-box; }
  .yatt-tk .yatt-card {
    border-radius: 12px;
    background: oklch(0.17 0.012 255 / 0.92);
    border: 1px solid oklch(1 0 0 / 0.1);
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(12px);
    overflow: hidden;
    min-width: 300px;
    max-width: 520px;
  }
  .yatt-tk .yatt-handle {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px;
    cursor: grab; user-select: none;
    border-bottom: 1px solid oklch(1 0 0 / 0.07);
    background: rgba(255, 255, 255, 0.03);
  }
  .yatt-tk .yatt-handle:active { cursor: grabbing; }
  .yatt-tk .yatt-logo { font-weight: 700; letter-spacing: 0.04em; color: #7aa2ff; font-size: 11px; }
  .yatt-tk .yatt-sel {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 10.5px; color: #9ece6a;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid oklch(1 0 0 / 0.08);
    border-radius: 6px; padding: 2px 7px;
    max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .yatt-tk .yatt-status { margin-left: auto; font-size: 11px; font-weight: 600; white-space: nowrap; }
  .yatt-tk .yatt-rows { padding: 6px 8px; display: flex; gap: 2px; flex-wrap: wrap; align-items: center; }
  .yatt-tk .yatt-rows + .yatt-rows { padding-top: 0; }
  .yatt-tk button {
    display: inline-flex; align-items: center; justify-content: center;
    border: 0; background: transparent; color: oklch(0.92 0 0);
    border-radius: 8px; cursor: pointer;
    font-family: inherit;
    transition: background-color 0.12s ease, color 0.12s ease;
  }
  .yatt-tk button:focus-visible { outline: 2px solid #7aa2ff; outline-offset: 1px; }
  .yatt-tk .yatt-a { width: 30px; height: 30px; }
  .yatt-tk .yatt-a:hover { background: rgba(255, 255, 255, 0.08); }
  .yatt-tk .yatt-on { background: #7aa2ff !important; color: #0b1020 !important; }
  .yatt-tk .yatt-cancel { height: 30px; padding: 0 10px; color: #f87171; gap: 5px; font-size: 11px; }
  .yatt-tk .yatt-cancel:hover { background: rgba(248, 113, 113, 0.14); }
  .yatt-tk .yatt-verify { height: 30px; padding: 0 9px; gap: 5px; font-size: 11px; color: oklch(0.85 0 0); }
  .yatt-tk .yatt-verify:hover { background: rgba(255, 255, 255, 0.08); }
  .yatt-tk .yatt-assertrow button {
    height: 26px; padding: 0 9px; font-size: 11px; color: oklch(0.85 0 0);
    border: 1px solid oklch(1 0 0 / 0.1);
  }
  .yatt-tk .yatt-assertrow button:hover { background: rgba(255, 255, 255, 0.08); }
  .yatt-tk .yatt-ctx { padding: 6px 8px 8px; display: none; align-items: center; gap: 6px; border-top: 1px solid oklch(1 0 0 / 0.07); }
  .yatt-tk .yatt-ctx input, .yatt-tk .yatt-ctx select {
    flex: 1; min-width: 120px;
    background: oklch(0.13 0.01 255);
    color: oklch(0.95 0 0);
    border: 1px solid oklch(1 0 0 / 0.14);
    border-radius: 8px; padding: 6px 10px;
    font: 12px inherit; outline: none;
  }
  .yatt-tk .yatt-ctx input:focus, .yatt-tk .yatt-ctx select:focus { border-color: #7aa2ff; }
  .yatt-tk .yatt-ctx .yatt-var { flex: 0 0 auto; max-width: 170px; color: #7aa2ff; }
  .yatt-tk .yatt-ctxok {
    background: #7aa2ff; color: #0b1020; font-weight: 600;
    border-radius: 8px; padding: 6px 12px; font-size: 12px; gap: 5px;
  }
  .yatt-tk .yatt-ctxok:hover { background: #9bb8ff; }
  .yatt-tk .yatt-ctxno { padding: 6px 10px; color: oklch(0.7 0 0); }
  .yatt-tk .yatt-ctxno:hover { background: rgba(255, 255, 255, 0.08); }
`;

export const HELPER_JS = `(function () {
  // Solo el frame principal: la barra no debe aparecer dentro de iframes.
  if (window.top !== window.self) { return; }
  if (window.__yattInjected) { return; }
  window.__yattInjected = true;

  function __yattMain() {
  var I = ${JSON.stringify(ICONS)};
  var g = {};
  g.mouse = I['mouse-pointer-click'];
  g.hover = I['mouse-pointer-2'];
  g.type = I['type'];
  g.eraser = I['eraser'];
  g.select = I['chevrons-up-down'];
  g.check = I['square-check'];
  g.key = I['keyboard'];
  g.eye = I['eye'];
  g.scroll = I['scroll-text'];
  g.badge = I['badge-check'];
  g.hidden = I['eye-off'];
  g.text = I['text'];
  g.value = I['circle-check'];
  g.attr = I['list-checks'];
  g.camera = I['camera'];
  g.upload = I['upload'];
  g.x = I['x'];
  g.grip = I['grip-vertical'];
  g.shield = I['shield-check'];

  var current = null;
  var busy = false;
  var armed = null;
  var pending = null;
  // Nombres de variables definidas en el editor; las inyecta el sidecar antes
  // del helper (window.__yattVars) y se pueden actualizar en vivo.
  var VARS = (window.__yattVars || []).slice();

  var STYLE = document.createElement('style');
  STYLE.textContent = ${JSON.stringify(CSS)};
  (document.head || document.documentElement).appendChild(STYLE);

  var root = document.createElement('div');
  root.className = 'yatt-tk';
  root.style.cssText = 'all:initial;position:fixed;top:12px;right:12px;z-index:2147483646;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;';

  root.innerHTML =
    '<div class="yatt-card">' +
      '<div class="yatt-handle" title="Arrastra para mover">' + g.grip +
        '<span class="yatt-logo">YATT</span>' +
        '<span class="yatt-sel">—</span>' +
        '<span class="yatt-status"></span>' +
      '</div>' +
      '<div class="yatt-rows">' +
        '<button class="yatt-a" data-a="click" title="Click: arma y pulsa el elemento">' + g.mouse + '</button>' +
        '<button class="yatt-a" data-a="dblclick" title="Doble click">' + g.mouse + '</button>' +
        '<button class="yatt-a" data-a="hover" title="Hover">' + g.hover + '</button>' +
        '<button class="yatt-a" data-a="type" title="Escribir en el campo">' + g.type + '</button>' +
        '<button class="yatt-a" data-a="clear" title="Vaciar el campo">' + g.eraser + '</button>' +
        '<button class="yatt-a" data-a="select_option" title="Elegir opción de un select">' + g.select + '</button>' +
        '<button class="yatt-a" data-a="check" title="Marcar checkbox / radio">' + g.check + '</button>' +
        '<button class="yatt-a" data-a="press_key" title="Pulsar una tecla (Enter, Tab…)" data-a2="key">' + g.key + '</button>' +
        '<button class="yatt-a" data-a="upload" title="Subir archivo al campo (ruta o {{variable}} de tipo archivo)">' + g.upload + '</button>' +
        '<button class="yatt-a" data-a="scroll_to_element" title="Scroll hasta el elemento">' + g.scroll + '</button>' +
      '</div>' +
      '<div class="yatt-rows">' +
        '<button class="yatt-a" data-a="wait_visible" title="Esperar a que el elemento sea visible">' + g.eye + '</button>' +
        '<button class="yatt-verify" title="Verificaciones (asserts)">' + g.shield + ' Verificar</button>' +
        '<button class="yatt-a" data-a="screenshot" title="Capturar screenshot de la página">' + g.camera + '</button>' +
        '<button class="yatt-cancel" style="display:none;">' + g.x + ' Cancelar</button>' +
      '</div>' +
      '<div class="yatt-assertrow" style="display:none;">' +
        '<button class="yatt-a" data-a="assert_visible">' + g.badge + ' Visible</button>' +
        '<button class="yatt-a" data-a="assert_hidden">' + g.hidden + ' Oculto</button>' +
        '<button class="yatt-a" data-a="assert_text">' + g.text + ' Texto…</button>' +
        '<button class="yatt-a" data-a="assert_value">' + g.value + ' Valor…</button>' +
        '<button class="yatt-a" data-a="assert_attribute">' + g.attr + ' Atributo…</button>' +
      '</div>' +
      '<div class="yatt-ctx"></div>' +
    '</div>';

  document.documentElement.appendChild(root);

  var CARD = root.querySelector('.yatt-card');
  var HANDLE = root.querySelector('.yatt-handle');
  var SELBOX = root.querySelector('.yatt-sel');
  var STATUS = root.querySelector('.yatt-status');
  var CTX = root.querySelector('.yatt-ctx');
  var CANCEL = root.querySelector('.yatt-cancel');
  var ASSERTROW = root.querySelector('.yatt-assertrow');
  var VERIFY = root.querySelector('.yatt-verify');
  var ARMBTNS = Array.prototype.slice.call(root.querySelectorAll('.yatt-a'));

  var HILITE = document.createElement('div');
  HILITE.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:none;border:2px dashed #7aa2ff;background:rgba(122,162,255,0.12);border-radius:4px;display:none;';
  document.documentElement.appendChild(HILITE);

  var CHIP = document.createElement('div');
  CHIP.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:rgba(8,10,16,0.95);color:#9ece6a;font:11px ui-monospace,Menlo,Consolas,monospace;padding:2px 7px;border-radius:6px;border:1px solid oklch(1 0 0 / 0.14);display:none;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  document.documentElement.appendChild(CHIP);

  // ---- Arrastre con asa (grip), posición persistente por sesión de la pestaña ----
  var drag = { active: false, startX: 0, startY: 0, origLeft: 0, origTop: 0 };
  try {
    var saved = JSON.parse(sessionStorage.getItem('yatt-pos') || '{}');
    if (typeof saved.x === 'number' && typeof saved.y === 'number') {
      root.style.left = saved.x + 'px';
      root.style.top = saved.y + 'px';
      root.style.right = 'auto';
    }
  } catch (e) {}

  HANDLE.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) { return; }
    drag.active = true;
    drag.startX = e.clientX;
    drag.startY = e.clientY;
    var r = root.getBoundingClientRect();
    drag.origLeft = r.left;
    drag.origTop = r.top;
    root.style.transition = 'none';
    HANDLE.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  HANDLE.addEventListener('pointermove', function (e) {
    if (!drag.active) { return; }
    var x = drag.origLeft + (e.clientX - drag.startX);
    var y = drag.origTop + (e.clientY - drag.startY);
    root.style.left = Math.max(0, x) + 'px';
    root.style.top = Math.max(0, y) + 'px';
    root.style.right = 'auto';
  });
  HANDLE.addEventListener('pointerup', function (e) {
    if (!drag.active) { return; }
    drag.active = false;
    root.style.transition = '';
    try {
      sessionStorage.setItem('yatt-pos', JSON.stringify({ x: drag.origLeft + (e.clientX - drag.startX), y: drag.origTop + (e.clientY - drag.startY) }));
    } catch (err) {}
  });

  // ---- Funciones base ----
  function uniq(sel) {
    try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; }
  }
  function escAttr(v) { return String(v).replace(/"/g, '\\"'); }
  function tagIndex(parent, node) {
    var kids = parent.children, n = 0;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].tagName === node.tagName) { n++; if (kids[i] === node) { return n; } }
    }
    return 1;
  }
  function short(node) {
    if (!node || node.nodeType !== 1) { return null; }
    var tag = node.tagName.toLowerCase();
    if (node.id) { return '#' + CSS.escape(node.id); }
    var cls = Array.prototype.slice.call(node.classList).filter(function (c) {
      return /^[A-Za-z][\\w-]*$/.test(c) && c.indexOf('yatt-') !== 0;
    }).slice(0, 2);
    var part = tag;
    if (cls.length) { part += cls.map(function (c) { return '.' + c; }).join(''); }
    var parent = node.parentElement;
    if (parent && parent.nodeType === 1) {
      var sameTag = Array.prototype.slice.call(parent.children).filter(function (ch) { return ch.tagName === node.tagName; });
      if (sameTag.length > 1 && sameTag.indexOf(node) !== -1) { part += ':nth-of-type(' + tagIndex(parent, node) + ')'; }
    }
    return part;
  }
  function computeSelector(el) {
    if (!el || el.nodeType !== 1) { return null; }
    if (el.closest('.yatt-tk')) { return null; }
    var tid = el.getAttribute && el.getAttribute('data-testid');
    if (tid && uniq('[data-testid="' + escAttr(tid) + '"]')) { return '[data-testid="' + escAttr(tid) + '"]'; }
    if (el.id && uniq('#' + CSS.escape(el.id))) { return '#' + CSS.escape(el.id); }
    var cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      var c2 = short(cur);
      if (c2 && uniq(c2)) { return c2; }
      cur = cur.parentElement;
    }
    var parts = [], node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement && parts.length < 6) {
      parts.unshift(short(node));
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function setStatus(text, kind) {
    STATUS.textContent = text || '';
    var color = '';
    if (kind === 'ok') { color = '#4ade80'; }
    else if (kind === 'err') { color = '#f87171'; }
    else if (kind === 'warn') { color = '#fbbf24'; }
    else { color = '#7aa2ff'; }
    STATUS.style.color = color;
  }

  function clearHighlight() {
    HILITE.style.display = 'none';
    CHIP.style.display = 'none';
  }

  function highlight(el) {
    var r = el.getBoundingClientRect();
    HILITE.style.display = 'block';
    HILITE.style.left = Math.max(0, r.left) + 'px';
    HILITE.style.top = Math.max(0, r.top) + 'px';
    HILITE.style.width = r.width + 'px';
    HILITE.style.height = r.height + 'px';
    var sel = computeSelector(el) || '(sin selector)';
    CHIP.textContent = sel;
    CHIP.style.display = 'block';
    CHIP.style.left = Math.max(0, r.left) + 'px';
    CHIP.style.top = Math.max(0, r.top - 22) + 'px';
    return sel;
  }

  document.addEventListener('mousemove', function (e) {
    var el = e.target;
    if (!el || el.nodeType !== 1) { return; }
    if (el === document.body || el === document.documentElement) { clearHighlight(); return; }
    if (el.closest && el.closest('.yatt-tk')) { clearHighlight(); return; }
    current = el;
    var sel = highlight(el);
    SELBOX.textContent = sel || '—';
  }, true);

  document.addEventListener('scroll', clearHighlight, true);

  function record(step) {
    if (busy) { return; }
    busy = true;
    setStatus('ejecutando…', '');
    window.__yattRecord(step).then(function (r) {
      busy = false;
      if (r && r.ok) { setStatus('✓ grabado', 'ok'); }
      else { setStatus('✗ ' + (r && r.error ? String(r.error) : 'error'), 'err'); }
    }).catch(function (err) {
      busy = false;
      setStatus('✗ ' + String(err), 'err');
    });
  }

  function valueNeeded(a) {
    return ['type', 'press_key', 'assert_text', 'assert_value', 'assert_attribute', 'select_option', 'upload'].indexOf(a) !== -1;
  }

  function renderCtx(action, selector) {
    var hints = {
      type: ['Texto a escribir…'],
      press_key: ['Tecla: Enter, Tab, Escape, Ctrl+A…'],
      assert_text: ['Texto esperado…'],
      assert_value: ['Valor esperado…'],
      assert_attribute: ['Nombre del atributo (p. ej. href)', 'Valor esperado…'],
      upload: ['Ruta del archivo o {{variable}} (p. ej. /tmp/logo.png)'],
      select_option: []
    };
    var HTML = '';
    if (action === 'select_option') {
      var el = document.querySelector(selector);
      var opts = (el && el.options) ? Array.prototype.slice.call(el.options) : [];
      if (!opts.length) { setStatus('el elemento no es un <select>', 'warn'); disarm(); return; }
      HTML = '<select class="yatt-opt">';
      opts.forEach(function (o) {
        var v = (o.getAttribute && o.getAttribute('value')) || o.text;
        HTML += '<option value="' + String(v).replace(/"/g, '&quot;') + '">' + o.text + '</option>';
      });
      HTML += '</select>';
    } else if (action === 'assert_attribute') {
      HTML = varsSelHTML() +
             '<input class="yatt-inp yatt-a1" placeholder="' + hints.assert_attribute[0] + '" />' +
             '<input class="yatt-inp yatt-a2" placeholder="' + hints.assert_attribute[1] + '" />';
    } else {
      HTML = varsSelHTML() + '<input class="yatt-inp" placeholder="' + hints[action][0] + '" />';
    }
    HTML += '<button class="yatt-ctxok">OK ✓</button><button class="yatt-ctxno">✕</button>';
    CTX.innerHTML = HTML;
    CTX.style.display = 'flex';
    var first = CTX.querySelector('.yatt-inp') || CTX.querySelector('.yatt-opt');
    if (first) { first.focus(); }
    // RF-25: propuesta de valor esperado a partir del estado real del elemento
    // (texto visible para assert_text, valor para assert_value).
    var el = null;
    try { el = document.querySelector(selector); } catch (e) {}
    if (el) {
      if (action === 'assert_text') {
        var txt = (el.textContent || '').trim().slice(0, 300);
        if (txt && first.classList.contains('yatt-inp') && !first.classList.contains('yatt-a1')) { first.value = txt; }
      } else if (action === 'assert_value' && 'value' in el) {
        var iv = String(el.value || '');
        if (iv) { first.value = iv; }
      }
    }
    var varSel = CTX.querySelector('.yatt-var');
    if (varSel) {
      varSel.addEventListener('change', function (e) {
        var n = e.target.value;
        if (n) { insertVar(n); varSel.value = ''; }
      });
    }
  }

  // ---- Variables del editor: desplegable que inserta {{nombre}} en el campo ----

  function varsSelHTML() {
    if (!VARS.length) { return ''; }
    var h = '<select class="yatt-var" title="Insertar variable {{nombre}}">' +
      '<option value="">⟦ {{variable}} ⟧</option>';
    VARS.forEach(function (n) {
      h += '<option value="' + String(n).replace(/"/g, '&quot;') + '">' + n + '</option>';
    });
    return h + '</select>';
  }

  function insertVar(name) {
    var inp = lastInp || CTX.querySelector('.yatt-inp');
    if (!inp) { return; }
    var tok = '{{' + name + '}}';
    var start = inp.selectionStart, end = inp.selectionEnd;
    if (start == null) {
      inp.value += tok;
    } else {
      inp.value = inp.value.slice(0, start) + tok + inp.value.slice(end);
    }
    inp.focus();
    var pos = (start == null) ? inp.value.length : start + tok.length;
    try { inp.setSelectionRange(pos, pos); } catch (err) {}
  }

  function syncVarsSelect() {
    var sel = CTX.querySelector('.yatt-var');
    if (!sel) { return; }
    var h = '<option value="">⟦ {{variable}} ⟧</option>';
    VARS.forEach(function (n) {
      h += '<option value="' + String(n).replace(/"/g, '&quot;') + '">' + n + '</option>';
    });
    sel.innerHTML = h;
    sel.value = '';
  }

  // Actualización en vivo desde el editor (sin reabrir el navegador).
  window.__yattSetVars = function (list) {
    VARS = (list || []).slice();
    syncVarsSelect();
  };

  var lastInp = null;
  CTX.addEventListener('focusin', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('yatt-inp')) {
      lastInp = e.target;
    }
  });

  var LABELS = {
    click: 'Click', dblclick: 'Doble click', hover: 'Hover', type: 'Escribir',
    clear: 'Limpiar', select_option: 'Seleccionar opción', check: 'Checkbox',
    press_key: 'Tecla', upload: 'Subir archivo', wait_visible: 'Esperar visible', scroll_to_element: 'Scroll',
    assert_visible: 'Verificar visible', assert_hidden: 'Verificar oculto',
    assert_text: 'Verificar texto', assert_value: 'Verificar valor',
    assert_attribute: 'Verificar atributo'
  };

  function armVisual(a) {
    ARMBTNS.forEach(function (b) {
      b.classList.toggle('yatt-on', a !== null && b.getAttribute('data-a') === a);
    });
    CANCEL.style.display = a ? 'flex' : 'none';
  }

  function doAction(a) {
    if (typeof window.__yattRecord !== 'function') { setStatus('sin conexión al sidecar', 'err'); return; }
    if (a === 'screenshot') {
      if (armed || pending) { disarm(); }
      record({ action: 'screenshot', label: 'screenshot' });
      return;
    }
    setStatus('elige el elemento · ' + (LABELS[a] || a) + ' (Esc cancela)', 'warn');
    armed = a;
    armVisual(a);
  }

  function hideCtx() {
    CTX.style.display = 'none';
    CTX.innerHTML = '';
  }

  function disarm(msg) {
    armed = null;
    pending = null;
    hideCtx();
    ASSERTROW.style.display = 'none';
    armVisual(null);
    if (msg) { setStatus(msg, 'warn'); }
  }

  // ---- Captura: armado primero, luego clic en la página ----
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.closest && t.closest('.yatt-tk')) { return; }
    if (window.__yattGrab) {
      if (!t || t.nodeType !== 1 || t === document.body) { return; }
      e.preventDefault();
      e.stopImmediatePropagation();
      var gsel = computeSelector(t);
      window.__yattGrab = false;
      if (window.__yattGrabResult) { window.__yattGrabResult(gsel || ''); }
      return;
    }
    if (!armed) { return; }
    var el = e.target;
    if (!el || el.nodeType !== 1 || el === document.body || el === document.documentElement) {
      setStatus('señala un elemento de la página', 'warn');
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    var sel = computeSelector(el);
    if (!sel) { setStatus('sin selector válido', 'warn'); return; }
    if (valueNeeded(armed)) {
      pending = { action: armed, selector: sel };
      renderCtx(armed, sel);
      return;
    }
    record({ action: armed, selector: sel, label: (LABELS[armed] || armed) + ' → ' + sel });
    disarm();
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (window.__yattGrab) {
        window.__yattGrab = false;
        if (window.__yattGrabResult) { window.__yattGrabResult(''); }
        return;
      }
      if (armed || pending) {
        e.preventDefault();
        disarm('captura cancelada');
      }
    }
  }, true);

  root.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('.yatt-cancel')) {
      disarm('captura cancelada');
      return;
    }
    if (e.target && e.target.closest && e.target.closest('.yatt-verify')) {
      var on = ASSERTROW.style.display === 'flex';
      ASSERTROW.style.display = on ? 'none' : 'flex';
      return;
    }
    var b = e.target.closest ? e.target.closest('.yatt-a') : null;
    if (b) { doAction(b.getAttribute('data-a')); }
  });

  CTX.addEventListener('click', function (e) {
    if (!pending) { return; }
    if (e.target && e.target.closest && e.target.closest('.yatt-ctxno')) {
      disarm('captura cancelada');
      return;
    }
    if (e.target && e.target.closest && e.target.closest('.yatt-ctxok')) {
      var a = pending.action;
      var sel = pending.selector;
      var step;
      if (a === 'select_option') {
        var opt = CTX.querySelector('.yatt-opt');
        step = { action: a, selector: sel, value: opt ? opt.value : '', label: 'select ' + (opt ? opt.value : '') + ' → ' + sel };
      } else {
        var v1 = CTX.querySelector('.yatt-inp');
        if (a === 'assert_attribute') {
          var v2 = CTX.querySelector('.yatt-a2');
          var name = v1 ? v1.value : '';
          if (!name) { setStatus('indica el nombre del atributo', 'warn'); return; }
          step = { action: a, selector: sel, attribute: name, value: v2 ? v2.value : '', label: 'assert ' + name + '="' + (v2 ? v2.value : '') + '" → ' + sel };
        } else {
          var val = v1 ? v1.value : '';
          if (!val) { setStatus('indica el valor', 'warn'); return; }
          step = { action: a, selector: sel, value: val, label: a + ' "' + val + '" → ' + sel };
        }
      }
      disarm();
      record(step);
    }
  });

  // Hooks para el sidecar (re-grabado).
  window.__yattSetStatus = function (text, kind) { setStatus(text, kind); };

  setStatus('barra lista', '');
  }
  // El init script puede correr antes de que el parser cree <html>: la barra
  // se monta en cuanto exista el elemento raíz.
  if (document.documentElement) { __yattMain(); }
  else {
    var __yattPoll = function () {
      if (document.documentElement) { __yattMain(); }
      else { setTimeout(__yattPoll, 15); }
    };
    setTimeout(__yattPoll, 15);
  }
})();`;