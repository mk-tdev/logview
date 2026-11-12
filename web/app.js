'use strict';
const $ = id => document.getElementById(id);
const state = { events: [], sessions: [], project: null, process: null, level: 'all', query: '', selected: null, paused: false, clearedAt: 0, pending: 0, limit: 2000, cursor: 0 };
const lowerCache = new WeakMap();
const time = timestamp => new Date(timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, fractionalSecondDigits: 3 });
let visible = [], renderQueued = false, toastTimer;
const root = document.documentElement;
const themeMedia = matchMedia('(prefers-color-scheme: dark)');
const narrowViewport = matchMedia('(max-width: 760px)');
function readPreference(key) { try { return localStorage.getItem(key); } catch { return null; } }
function savePreference(key, value) { try { localStorage.setItem(key, value); } catch {} }
function setTheme(preference, persist = true) {
  const theme = ['light', 'dark'].includes(preference) ? preference : 'system';
  root.dataset.themePreference = theme;
  root.dataset.theme = theme === 'system' ? (themeMedia.matches ? 'dark' : 'light') : theme;
  for (const control of document.querySelectorAll('[data-theme-select]')) control.value = theme;
  if (persist) savePreference('logview.theme', theme);
}
function setSidebar(collapsed, persist = true) {
  root.dataset.sidebarCollapsed = String(collapsed);
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  $('sidebar-toggle').setAttribute('aria-label', label);
  $('sidebar-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('sidebar-toggle').title = label;
  const navigationOverlay = narrowViewport.matches && !collapsed;
  $('sidebar-backdrop').hidden = !navigationOverlay;
  document.querySelector('main').inert = navigationOverlay;
  if (collapsed && $('sidebar').contains(document.activeElement)) $('sidebar-toggle').focus();
  if (navigationOverlay) $('sidebar-close').focus();
  if (persist && !narrowViewport.matches) savePreference('logview.sidebarCollapsed', String(collapsed));
}
setTheme(root.dataset.themePreference, false);
setSidebar(root.dataset.sidebarCollapsed === 'true', false);
for (const control of document.querySelectorAll('[data-theme-select]')) control.addEventListener('change', event => setTheme(event.target.value));
themeMedia.addEventListener('change', () => { if (root.dataset.themePreference === 'system') setTheme('system', false); });
narrowViewport.addEventListener('change', () => setSidebar(narrowViewport.matches || readPreference('logview.sidebarCollapsed') === 'true', false));
$('sidebar-toggle').addEventListener('click', () => setSidebar(root.dataset.sidebarCollapsed !== 'true'));
for (const id of ['sidebar-close', 'sidebar-backdrop']) $(id).addEventListener('click', () => setSidebar(true));
const inspectorModal = $('inspector-modal');
$('inspector-fullscreen').addEventListener('click', () => {
  const panel = $('inspector-panel');
  const scroll = panel.scrollTop;
  $('inspector-modal-body').append(panel);
  inspectorModal.append($('toast'));
  inspectorModal.showModal();
  document.body.classList.add('inspector-expanded');
  panel.scrollTop = scroll;
  $('inspector-close').focus();
});
$('inspector-close').addEventListener('click', () => inspectorModal.close());
inspectorModal.addEventListener('close', () => {
  const panel = $('inspector-panel');
  const scroll = panel.scrollTop;
  $('panes').append(panel);
  document.body.append($('toast'));
  document.body.classList.remove('inspector-expanded');
  panel.scrollTop = scroll;
  $('inspector-fullscreen').focus({ preventScroll: true });
});
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function notify(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2200); }
function category(entry) {
  if (entry.level === 'error' || entry.args.some(arg => arg.type === 'error')) return 'error';
  if (entry.level === 'warn') return 'warn';
  if (entry.level === 'debug') return 'debug';
  if (entry.transport || ['stdout', 'stderr'].includes(entry.level)) return 'raw';
  return 'info';
}
function summary(entry) {
  const text = arg => {
    if (arg.type === 'string') return arg.value;
    if (arg.type === 'error') {
      const message = arg.children?.find(c => c.key === 'message')?.node.value;
      return message ? `Error: ${message}` : arg.preview;
    }
    if (arg.type === 'object' && entry.transport) {
      const message = arg.children?.find(child => child.key === 'msg' || child.key === 'message')?.node;
      if (message?.type === 'string') return message.value;
    }
    return arg.preview;
  };
  if (entry.args[0]?.type === 'string' && entry.args.length > 1) {
    let index = 1;
    const formatted = entry.args[0].value.replace(/%[%sdifoOcj]/g, placeholder => {
      if (placeholder === '%%') return '%';
      if (index >= entry.args.length) return placeholder;
      const arg = entry.args[index++];
      if (placeholder === '%c') return '';
      if (['%d', '%i', '%f'].includes(placeholder) && ['string', 'number', 'boolean', 'null'].includes(arg.type)) {
        const number = placeholder === '%i' ? parseInt(arg.value, 10) : placeholder === '%f' ? parseFloat(arg.value) : Number(arg.value);
        return String(number);
      }
      return text(arg);
    });
    return [formatted, ...entry.args.slice(index).map(text)].join(' ');
  }
  return entry.args.map(text).join(' ');
}
function searchable(entry) {
  if (!lowerCache.has(entry)) lowerCache.set(entry, `${entry.project} ${entry.pid} ${entry.level} ${JSON.stringify(entry.args)} ${entry.source?.file || ''}`.toLowerCase());
  return lowerCache.get(entry);
}
function baseEntries() { return state.events.filter(entry => entry.cursor > state.clearedAt && entry.kind === 'log' && (!state.project || entry.project === state.project) && (!state.process || entry.session === state.process)); }
function scheduleRender() {
  if (state.paused) { state.pending++; $('pause').textContent = `▶ Resume${state.pending ? ` (${state.pending})` : ''}`; return; }
  if (!renderQueued) { renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); }
}
function renderSidebar() {
  const entries = state.events.filter(e => e.kind === 'log' && e.cursor > state.clearedAt);
  const projects = [...new Set(state.sessions.map(s => s.project))];
  $('project-total').textContent = entries.length;
  $('project-count').textContent = projects.length;
  $('all-projects').classList.toggle('active', !state.project && !state.process);
  const projectList = projects.map(project => {
    const button = node('button', `project-button${project === state.project ? ' active' : ''}`);
    button.append(node('span', 'project-icon'), node('span', 'project-name', project), node('span', 'project-number', entries.filter(e => e.project === project).length));
    button.addEventListener('click', () => { state.project = project; state.process = null; render(); if (narrowViewport.matches) setSidebar(true); });
    return button;
  });
  $('projects').replaceChildren(...projectList);
  const processes = state.sessions.filter(s => !state.project || s.project === state.project).slice(-12).reverse().map(session => {
    const button = node('button', `process-button${state.process === session.id ? ' active' : ''}`);
    const label = node('div', '', `${session.project} · ${session.pid}${session.thread ? ` / worker ${session.thread}` : ''}`);
    label.append(node('small', '', `${session.status === 'exited' ? 'Exited' : 'Connected'} · ${session.command || 'Node.js'}`));
    button.title = session.command || 'Node.js';
    button.append(node('span', `status-dot${session.status === 'running' ? ' live' : ''}`), label);
    button.addEventListener('click', () => { state.process = session.id; render(); if (narrowViewport.matches) setSidebar(true); });
    return button;
  });
  $('processes').replaceChildren(...processes);
  $('breadcrumb').textContent = state.process ? `Process ${state.sessions.find(s => s.id === state.process)?.pid || ''}` : state.project || 'All projects';
}
function render() {
  renderSidebar();
  const base = baseEntries();
  visible = base.filter(entry => (state.level === 'all' || category(entry) === state.level) && (!state.query || searchable(entry).includes(state.query)));
  $('total-count').textContent = `${base.length} ${base.length === 1 ? 'entry' : 'entries'}`;
  $('all-count').textContent = base.length;
  $('error-count').textContent = base.filter(e => category(e) === 'error').length;
  $('warn-count').textContent = base.filter(e => category(e) === 'warn').length;
  $('visible-count').textContent = `${visible.length} visible`;
  $('retention').textContent = `${state.limit.toLocaleString()} entries`;
  $('footer-status').textContent = state.paused ? 'Display paused · capture continues' : `${state.sessions.length} ${state.sessions.length === 1 ? 'process' : 'processes'} · ${visible.length} visible logs`;
  for (const button of document.querySelectorAll('[data-level]')) button.classList.toggle('selected', button.dataset.level === state.level);
  const previousScroll = $('entries').scrollTop;
  const selectedVisible = visible.find(e => e.id === state.selected);
  if (!selectedVisible) state.selected = visible[0]?.id || null;
  const fragment = document.createDocumentFragment();
  for (const entry of visible) {
    const row = node('div', `entry ${category(entry)}${entry.id === state.selected ? ' selected' : ''}`);
    row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(entry.id === state.selected)); row.dataset.id = entry.id;
    row.id = `entry-${entry.cursor}`;
    row.append(node('span', 'timestamp', time(entry.timestamp)), node('span', `level ${category(entry)}`, entry.level));
    const content = node('div'); const message = node('div', 'entry-message', `${'› '.repeat(Math.min(entry.group || 0, 4))}${summary(entry)}`);
    message.title = summary(entry);
    row.title = `${summary(entry)}\n${entry.project} · Process ${entry.pid}${entry.source ? ` · ${entry.source.file}:${entry.source.line}` : ''}`;
    content.append(message); row.append(content);
    row.addEventListener('click', () => select(entry.id));
    fragment.append(row);
  }
  $('entries').replaceChildren(fragment);
  $('empty').hidden = visible.length > 0;
  if (!visible.length && (state.query || state.level !== 'all')) {
    $('empty').querySelector('h2').textContent = 'No matching logs.';
    $('empty').querySelector('p').textContent = 'Try another search or choose a different level.';
    $('empty').querySelector('code').hidden = true;
  } else {
    $('empty').querySelector('h2').textContent = 'Give your logs a little space.';
    $('empty').querySelector('p').textContent = 'Run a Node.js project through Logview. Objects, errors, and output will appear here.';
    $('empty').querySelector('code').hidden = false;
  }
  $('entries').scrollTop = $('follow').checked ? $('entries').scrollHeight : previousScroll;
  renderDetails();
}
function select(id) {
  state.selected = id;
  for (const row of $('entries').children) {
    row.classList.toggle('selected', row.dataset.id === id);
    row.setAttribute('aria-selected', String(row.dataset.id === id));
  }
  renderDetails();
}
function renderValue(value, key, depth = 0) {
  const label = key === undefined ? null : node('span', 'property', `${key}:`);
  const content = node('span', `value ${value.type}`, value.preview);
  if (value.children?.length || value.omitted) {
    const details = node('details');
    if (depth === 0) details.open = true;
    const heading = node('summary'); if (label) heading.append(label); heading.append(content); details.append(heading);
    let built = false;
    const build = () => {
      if (built) return; built = true;
      const children = node('div', 'children');
      for (const child of value.children || []) children.append(renderValue(child.node, child.key, depth + 1));
      if (value.omitted) children.append(node('div', 'leaf omitted', `${value.omitted} more properties not captured`));
      details.append(children);
    };
    details.addEventListener('toggle', () => { if (details.open) build(); });
    if (details.open) build();
    // Used by Expand to build descendants only when requested.
    details.buildChildren = build;
    return details;
  }
  const leaf = node('div', 'leaf'); if (label) leaf.append(label); leaf.append(content); return leaf;
}
let detailId = null;
function renderDetails() {
  const entry = state.events.find(e => e.id === state.selected);
  $('detail').hidden = !entry; $('details-empty').hidden = Boolean(entry);
  if (!entry) { detailId = null; return; }
  if (detailId === entry.id) return;
  detailId = entry.id;
  $('detail-level').className = `level ${category(entry)}`; $('detail-level').textContent = entry.level;
  $('detail-time').textContent = time(entry.timestamp);
  $('detail-title').textContent = summary(entry);
  $('detail-context').textContent = `${entry.project} · Process ${entry.pid}${entry.thread ? ` · Worker ${entry.thread}` : ''}${entry.transport ? ` · ${entry.transport}` : ''}`;
  const source = $('source-link'); source.hidden = !entry.source;
  if (entry.source) {
    source.textContent = `${entry.source.file.split('/').pop()}:${entry.source.line}:${entry.source.column} ↗`;
    source.title = entry.source.file;
    source.href = `vscode://file/${entry.source.file.split('/').filter(Boolean).map(encodeURIComponent).join('/')}:${entry.source.line}:${entry.source.column}`;
  }
  $('values').replaceChildren(...entry.args.map((arg, index) => {
    const section = node('section', 'argument'); section.append(node('div', 'argument-label', `Argument ${index + 1} · ${arg.type}`));
    const tree = node('div', 'tree'); tree.append(renderValue(arg)); section.append(tree); return section;
  }));
  if (entry.trace) {
    const section = node('section', 'argument'); section.append(node('div', 'argument-label', 'Call stack'), node('pre', 'tree', entry.trace)); $('values').append(section);
  }
  $('capture-warning').textContent = entry.droppedBefore ? `${entry.droppedBefore} earlier entries dropped because the capture queue was full.` : '';
}
$('all-projects').addEventListener('click', () => { state.project = null; state.process = null; render(); if (narrowViewport.matches) setSidebar(true); });
$('search').addEventListener('input', event => { state.query = event.target.value.toLowerCase().trim(); render(); });
for (const button of document.querySelectorAll('[data-level]')) button.addEventListener('click', () => { state.level = button.dataset.level; render(); });
$('pause').addEventListener('click', () => {
  state.paused = !state.paused; $('pause').classList.toggle('pressed', state.paused);
  $('pause').textContent = state.paused ? '▶ Resume' : 'Ⅱ Pause'; state.pending = 0;
  if (!state.paused) render();
  else $('footer-status').textContent = 'Display paused · capture continues';
});
$('clear').addEventListener('click', () => { state.clearedAt = state.cursor; state.selected = null; render(); notify('View cleared. Other viewers keep their history.'); });
$('expand').addEventListener('click', () => {
  const expand = container => { for (const details of container.querySelectorAll('details')) { details.buildChildren?.(); details.open = true; } };
  // Newly created nested details are discovered in subsequent passes; capture depth is bounded.
  for (let depth = 0; depth < 32; depth++) expand($('values'));
});
$('collapse').addEventListener('click', () => { for (const details of $('values').querySelectorAll('details')) details.open = false; });
$('copy').addEventListener('click', async () => {
  const entry = state.events.find(e => e.id === state.selected); if (!entry) return;
  try { await navigator.clipboard.writeText(JSON.stringify(entry.args, null, 2)); notify('Snapshot JSON copied'); } catch { notify('Clipboard unavailable. Use Export to save the logs.'); }
});
$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(visible, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = node('a'); link.href = url; link.download = `logview-${new Date().toISOString().replaceAll(':', '-')}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener('keydown', event => {
  if (inspectorModal.open) return;
  if (event.key === 'Escape' && narrowViewport.matches && root.dataset.sidebarCollapsed === 'false') { setSidebar(true); $('sidebar-toggle').focus(); return; }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === '/') { event.preventDefault(); $('search').focus(); }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!visible.length) return; event.preventDefault();
    const index = visible.findIndex(e => e.id === state.selected);
    const next = Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
    select(visible[next].id); document.getElementById(`entry-${visible[next].cursor}`)?.scrollIntoView({ block: 'nearest' });
  }
});
const stream = new EventSource('/api/stream');
stream.addEventListener('open', () => { $('connection').textContent = 'Collector connected'; $('connection-dot').classList.add('live'); });
stream.addEventListener('error', () => { $('connection').textContent = 'Reconnecting…'; $('connection-dot').classList.remove('live'); });
stream.addEventListener('state', message => {
  const data = JSON.parse(message.data);
  // A collector restart resets its cursor and history.
  if (data.cursor < state.cursor) { state.clearedAt = 0; state.selected = null; }
  state.events = data.events; state.sessions = data.sessions; state.limit = data.limit; state.cursor = data.cursor; scheduleRender();
});
stream.addEventListener('entry', message => {
  const { event, session, oldestCursor } = JSON.parse(message.data);
  if (event.cursor <= state.cursor) return;
  state.cursor = event.cursor; state.events.push(event);
  while (state.events.length && state.events[0].cursor < oldestCursor) state.events.shift();
  if (state.events.length > state.limit) state.events.splice(0, state.events.length - state.limit);
  state.sessions = state.sessions.filter(s => s.id !== session.id); state.sessions.push(session);
  if (state.sessions.length > 100) state.sessions.shift();
  scheduleRender();
});
render();
