'use strict';

// The wire format is a tree of typed nodes, not JSON.stringify(value).
// Property descriptors let us show accessors without executing user code.
function snapshot(value, options = {}) {
  const bounded = (n, fallback, max) => Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
  const maxDepth = bounded(options.maxDepth, 16, 32);
  const maxEntries = bounded(options.maxEntries, 100, 500);
  const maxString = bounded(options.maxStringLength, 20000, 100000);
  const seen = new WeakMap();
  let remaining = 3000;
  let stringBudget = 200000;
  function clip(text) {
    const limit = Math.min(maxString, stringBudget);
    stringBudget -= Math.min(text.length, limit);
    return text.length > limit ? text.slice(0, limit) + '… [truncated]' : text;
  }
  function walk(v, path, depth) {
    if (--remaining < 0) return { type: 'limit', preview: '[Snapshot size limit]' };
    if (v === null) return { type: 'null', preview: 'null', value: null };
    const type = typeof v;
    if (type === 'string') { const text = clip(v); return { type, preview: JSON.stringify(text), value: text }; }
    if (type === 'number') return { type, preview: String(v), ...(Number.isFinite(v) && !Object.is(v, -0) ? { value: v } : {}) };
    if (type === 'boolean') return { type, preview: String(v), value: v };
    if (type === 'undefined') return { type, preview: 'undefined' };
    if (type === 'bigint') return { type, preview: String(v) + 'n' };
    if (type === 'symbol') return { type, preview: clip(String(v)) };
    if (type === 'function') return { type, preview: '[Function]' };
    if (seen.has(v)) return { type: 'reference', preview: '[Reference → ' + seen.get(v) + ']' };
    seen.set(v, path);
    if (depth >= maxDepth) return { type: 'limit', preview: '[Max depth reached]' };
    try {
      if (v instanceof Date) return { type: 'date', preview: Number.isNaN(Date.prototype.getTime.call(v)) ? 'Invalid Date' : Date.prototype.toISOString.call(v) };
      if (v instanceof RegExp) {
        const source = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source').get.call(v);
        const flags = [['hasIndices', 'd'], ['global', 'g'], ['ignoreCase', 'i'], ['multiline', 'm'], ['dotAll', 's'], ['unicode', 'u'], ['unicodeSets', 'v'], ['sticky', 'y']]
          .filter(([key]) => Object.getOwnPropertyDescriptor(RegExp.prototype, key)?.get.call(v)).map(([, flag]) => flag).join('');
        return { type: 'regexp', preview: clip('/' + source + '/' + flags) };
      }
      const array = Array.isArray(v);
      const map = v instanceof Map;
      const set = v instanceof Set;
      const error = v instanceof Error;
      let name = array ? 'Array' : map ? 'Map' : set ? 'Set' : error ? 'Error' : 'Object';
      const proto = Object.getPrototypeOf(v);
      const ctor = proto && Object.getOwnPropertyDescriptor(proto, 'constructor');
      if (!array && !map && !set && !error && typeof ctor?.value === 'function') {
        name = Object.getOwnPropertyDescriptor(ctor.value, 'name')?.value || name;
      }
      const children = [];
      let total = 0;
      const add = (key, item, childPath) => children.push({ key: String(key), path: childPath, node: walk(item, childPath, depth + 1) });
      if (map || set) {
        const iterator = map ? Map.prototype.entries.call(v) : Set.prototype.values.call(v);
        const sizeGetter = Object.getOwnPropertyDescriptor(map ? Map.prototype : Set.prototype, 'size').get;
        total = sizeGetter.call(v);
        for (const entry of iterator) {
          if (children.length >= maxEntries || remaining <= 0) break;
          const i = children.length;
          add(String(i), map ? { key: entry[0], value: entry[1] } : entry, path + '[' + i + ']');
        }
      } else {
        // Include non-enumerable own properties (notably Error.message/stack).
        const keys = Reflect.ownKeys(v).filter(key => !(array && key === 'length'));
        total = keys.length;
        for (const key of keys) {
          if (children.length >= maxEntries || remaining <= 0) break;
          const desc = Object.getOwnPropertyDescriptor(v, key);
          if (!desc) continue;
          const keyText = String(key);
          const childPath = path + (typeof key === 'symbol' ? '[' + keyText + ']' : '[' + JSON.stringify(keyText) + ']');
          if ('value' in desc) add(keyText, desc.value, childPath);
          else children.push({ key: keyText, path: childPath, node: { type: 'accessor', preview: desc.get ? '[Getter — not evaluated]' : '[Setter]' } });
        }
      }
      return { type: map ? 'map' : set ? 'set' : array ? 'array' : error ? 'error' : 'object',
        preview: name + (array ? '(' + v.length + ')' : map || set ? '(' + total + ')' : ' {' + total + '}'),
        children, omitted: total - children.length };
    } catch {
      return { type: 'unavailable', preview: '[Unable to inspect object]' };
    }
  }
  return walk(value, '$', 0);
}
module.exports = { snapshot };
