'use strict';
// Small DOM harness: classList.add/remove intentionally enqueue attribute
// records even for unchanged values, as required by DOMTokenList update steps.
function createHarness(runtime) {
  const observers = [];
  let callbacks = 0;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.parentNode = null;
      this.attrs = {}; this.dataset = {}; this.hidden = false; this.textContent = '';
      this.listeners = new Map();
      this.classList = {
        contains: (name) => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(n => !names.includes(n)).join(' '); },
        toggle: (name, force) => {
          const has = this.classList.contains(name);
          const next = force === undefined ? !has : Boolean(force);
          if (next !== has) this.classList[next ? 'add' : 'remove'](name);
          return next;
        },
      };
    }
    get className() { return this.attrs.class || ''; }
    set className(value) { this.setAttribute('class', value); }
    setAttribute(name, value) { const oldValue = this.attrs[name] ?? null; this.attrs[name] = String(value); notify(this, {type:'attributes', attributeName:name, oldValue}); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; notify(this,{type:'childList',addedNodes:[child]}); return child; }
    insertBefore(child, ref) { child.remove(); const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, child); child.parentNode = this; notify(this,{type:'childList',addedNodes:[child]}); }
    remove() { const parent = this.parentNode; if (!parent) return; parent.children.splice(parent.children.indexOf(this),1); this.parentNode=null; notify(parent,{type:'childList',addedNodes:[]}); }
    get firstChild() { return this.children[0] || null; }
    get firstElementChild() { return this.firstChild; }
    get childElementCount() { return this.children.length; }
    matches(selector) {
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      const m = selector.match(/^\[data-([a-z-]+)="([^"]+)"\]$/);
      if (m) return this.dataset[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] === m[2];
      return false;
    }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    set innerHTML(html) {
      for (const action of html.matchAll(/data-dizy-call-action="([^"]+)"/g)) { const button = new Element('button'); button.dataset.dizyCallAction=action[1]; this.append(button); }
    }
    play() { return Promise.resolve(); }
  }
  function notify(target, record) {
    for (const o of observers) {
      if (!o.target) continue;
      let inside = target === o.target;
      for (let p = target.parentNode; !inside && o.options.subtree && p; p=p.parentNode) inside = p === o.target;
      if (!inside || !o.options[record.type]) continue;
      if (record.type === 'attributes' && o.options.attributeFilter && !o.options.attributeFilter.includes(record.attributeName)) continue;
      o.records.push({target, ...record});
    }
  }
  class MutationObserver {
    constructor(callback) { this.callback=callback; this.records=[]; observers.push(this); }
    observe(target, options) { this.target=target; this.options=options; }
    disconnect() { this.target=null; this.records=[]; }
  }
  const body=new Element('body'), head=new Element('head');
  const main=new Element(), content=new Element(), messages=new Element(), panel=new Element(), grid=new Element();
  panel.className='voice-call-panel'; grid.className='call-video-grid'; panel.append(grid); content.append(messages); main.append(content,panel); body.append(main);
  const ids={'chat-main':main,'chat-content':content,messages};
  const listeners=new Map();
  const host={document:{body,head,createElement:tag=>new Element(tag),getElementById:id=>ids[id],querySelector:s=>body.querySelector(s)||head.querySelector(s)},MutationObserver,location:{protocol:'https:'},navigator:{mediaDevices:{}},addEventListener:(name,fn)=>listeners.set(name,fn),setTimeout,clearTimeout,requestAnimationFrame:fn=>fn()};
  const api=runtime.bootstrap(host);
  function flush(limit=30) {
    let rounds=0;
    while (observers.some(o=>o.records.length)) {
      if (++rounds>limit) throw new Error(`MutationObservers did not settle after ${limit} rounds (${callbacks} callbacks)`);
      for (const o of observers) { if (!o.records.length) continue; const records=o.records.splice(0); callbacks++; o.callback(records,o); }
    }
    return rounds;
  }
  return {api,host,grid,panel,Element,flush,listeners,get callbacks(){return callbacks;}};
}
module.exports={createHarness};
