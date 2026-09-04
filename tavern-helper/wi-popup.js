// Lorebook Active — Custom Popup UI (standalone script for Tavern Helper / JS-Slash-Runner)
// Requires the "Lorebook Active" extension installed — it provides the /wi-triggered
// slash command that returns the active World Info entry list as JSON.
//
// Install: Tavern Helper → 脚本库 (Script Library) → 全局脚本 (Global Script) →
//          new script → paste this whole file → save & enable.
//
// Features:
// - Floating gradient trigger button (draggable, position remembered)
// - Centered glassmorphism popup with World Info books, activation reasons,
//   matched-key chips (chat match vs recursion), sticky counters
// - Mobile friendly: safe-area aware, scrollable, never clipped at top

(() => {
    'use strict';

    // Tavern Helper scripts run in a same-origin iframe; the real UI lives in the parent.
    const PARENT = window.parent.document;

    if (typeof triggerSlash !== 'function') {
        console.warn('[LorebookPopup] triggerSlash not found — this script must run inside Tavern Helper (JS-Slash-Runner).');
        return;
    }

    // idempotent: remove nodes from a previous script instance
    PARENT.querySelectorAll('#lbi--root, #lbi--backdrop').forEach(n => n.remove());
    PARENT.getElementById('lbi--style')?.remove();

    // ---------- data ----------

    let entries = [];

    const STRATEGY_LABEL = {
        constant: 'Constant (always active)',
        normal: 'Normal (key match)',
        vectorized: 'Vectorized (similarity)',
    };
    const getStrategy = (entry) => {
        if (entry.constant === true) return 'constant';
        if (entry.vectorized === true) return 'vectorized';
        return 'normal';
    };

    const describeReason = (entry) => {
        const r = entry.stwiiReason;
        if (!r) return '';
        const parts = [];
        if (r.type == 'constant') parts.push('🔵 Constant — always active');
        if (r.type == 'sticky') parts.push(`📌 Sticky — still active for ${entry.sticky} more rounds`);
        if (r.type == 'vectorized') parts.push('🔗 Vectorized — activated by vector similarity');
        for (const k of r.matchedKeys ?? []) {
            parts.push(k.source == 'chat'
                ? `🔑 "${k.key}" — found in scanned messages`
                : `🔑 "${k.key}" — via recursion from "${k.source.replace(/^↩\s*/, '')}"`);
        }
        if (r.secondary?.length) {
            const logicNames = { 0: 'AND ANY', 1: 'NOT ALL', 2: 'NOT ANY', 3: 'AND ALL' };
            parts.push(`Filter (${logicNames[r.logic] ?? 'AND ANY'}): ${r.secondary.map(s => `${s.matched ? '✔' : '✘'} "${s.key}"`).join('  ')}`);
        }
        if (r.type == 'unknown') parts.push('❓ No key match found (forced activation, /trigger, or external extension?)');
        return parts.join('\n');
    };

    const fetchEntries = async () => {
        try {
            const json = await triggerSlash('/wi-triggered');
            if (!json) return;
            const list = JSON.parse(json);
            if (Array.isArray(list)) {
                entries = list;
                render();
            }
        } catch (ex) {
            console.warn('[LorebookPopup] failed to fetch active WI list', ex);
        }
    };

    // ---------- dom helpers ----------

    const el = (tag, cls, text) => {
        const node = PARENT.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    };

    // ---------- styles ----------

    const style = el('style');
    style.id = 'lbi--style';
    style.textContent = `
#lbi--root { position: fixed; z-index: 31000; }
.lbi--trigger {
  width: 46px; height: 46px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; user-select: none; -webkit-user-select: none; touch-action: none;
  font-size: 20px; color: #fff;
  background: linear-gradient(135deg, #7c6cf0, #4cc9f0);
  box-shadow: 0 4px 18px rgba(0,0,0,.45), inset 0 0 0 1px rgba(255,255,255,.25);
  transition: transform .15s ease;
  position: relative;
}
.lbi--trigger:active { transform: scale(.92); }
.lbi--badge {
  position: absolute; top: -4px; right: -4px;
  min-width: 19px; height: 19px; border-radius: 10px;
  background: #ff5470; color: #fff;
  font: 700 11px/19px var(--mainFontFamily, sans-serif);
  text-align: center; padding: 0 5px; box-sizing: border-box;
  border: 1px solid rgba(255,255,255,.6);
  display: none;
}
.lbi--trigger[data-lbi--count]:not([data-lbi--count="0"]) .lbi--badge { display: block; }
#lbi--backdrop {
  display: none; position: fixed; inset: 0; z-index: 30999;
  background: rgba(0,0,0,.45); backdrop-filter: blur(3px);
  overflow: auto !important;
}
#lbi--backdrop.lbi--isOpen { display: flex !important; }
.lbi--modal {
  display: none; flex-direction: column;
  width: min(420px, 92vw); max-height: min(78vh, 78dvh);
  margin: auto !important;
  border-radius: 16px; overflow: hidden;
  background: var(--SmartThemeBlurTintColor, rgba(20,22,34,.92));
  border: 1px solid var(--SmartThemeBorderColor, rgba(255,255,255,.18));
  box-shadow: 0 24px 60px rgba(0,0,0,.55);
  font-family: var(--mainFontFamily, sans-serif);
  color: var(--SmartThemeBodyColor, #eee);
  font-size: 14px;
}
#lbi--backdrop.lbi--isOpen .lbi--modal {
  display: flex;
  animation: lbi--pop .22s cubic-bezier(.2,.9,.3,1.2);
}
@keyframes lbi--pop {
  from { opacity: 0; transform: scale(.94) translateY(8px); }
  to   { opacity: 1; transform: none; }
}
.lbi--header {
  display: flex; align-items: center; gap: .6em;
  padding: 12px 16px;
  background: linear-gradient(120deg, rgba(124,108,240,.38), rgba(76,201,240,.28));
  border-bottom: 1px solid rgba(255,255,255,.12);
  flex: 0 0 auto;
}
.lbi--headerTitle { font-weight: 700; font-size: 15px; flex: 1 1 auto; }
.lbi--headerCount {
  font-size: 11px; font-weight: 700; color: #dfe3ff;
  background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.2);
  padding: 2px 9px; border-radius: 99px;
}
.lbi--close { cursor: pointer; opacity: .6; font-size: 18px; padding: 2px 6px; }
.lbi--close:hover { opacity: 1; }
.lbi--body {
  overflow-y: auto; padding: 8px 12px 14px;
  display: flex; flex-direction: column;
  flex: 1 1 auto;
  -webkit-overflow-scrolling: touch;
}
.lbi--world {
  display: flex; align-items: center; justify-content: space-between; gap: 1em;
  margin: 10px 2px 4px;
  font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase;
  color: #9aa4ff;
}
.lbi--world::after {
  content: ''; flex: 1 1 auto; height: 1px;
  background: linear-gradient(90deg, rgba(154,164,255,.4), transparent);
}
.lbi--worldCount { font-size: 10px; opacity: .7; order: 3; }
.lbi--entry {
  display: flex; align-items: flex-start; gap: 9px;
  padding: 6px 8px; border-radius: 10px;
  transition: background .15s;
}
.lbi--entry:hover { background: rgba(255,255,255,.06); }
.lbi--dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex: 0 0 auto; }
.lbi--dot.lbi--constant  { background: #4d9fff; box-shadow: 0 0 7px #4d9fff; }
.lbi--dot.lbi--normal    { background: #4ade80; box-shadow: 0 0 7px #4ade80; }
.lbi--dot.lbi--vectorized{ background: #c084fc; box-shadow: 0 0 7px #c084fc; }
.lbi--main { flex: 1 1 auto; min-width: 0; }
.lbi--title { font-weight: 600; overflow-wrap: anywhere; }
.lbi--chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
.lbi--chip { font-size: 10px; padding: 1px 7px; border-radius: 99px; border: 1px solid; }
.lbi--chipChat { color: #7ee2a8; border-color: rgba(126,226,168,.4); background: rgba(126,226,168,.08); }
.lbi--chipRec  { color: #f0c674; border-color: rgba(240,198,116,.4); background: rgba(240,198,116,.08); }
.lbi--sticky { flex: 0 0 auto; font-size: 11px; opacity: .85; margin-top: 3px; }
.lbi--empty { text-align: center; opacity: .5; padding: 28px 0; }
.lbi--footer {
  padding: 8px 16px;
  font-size: 11px; opacity: .5;
  border-top: 1px solid rgba(255,255,255,.08);
  text-align: right; flex: 0 0 auto;
}
`;
    PARENT.head.append(style);

    // ---------- trigger button (draggable) ----------

    const root = el('div');
    root.id = 'lbi--root';
    const trigger = el('div', 'lbi--trigger', '📖');
    trigger.title = 'Active World Info\n---\ndrag to move';
    const badge = el('span', 'lbi--badge');
    trigger.append(badge);
    root.append(trigger);
    PARENT.body.append(root);

    const POS_KEY = 'lbi--triggerPos';
    const applyPos = () => {
        try {
            const pos = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
            if (!pos) return;
            const rect = trigger.getBoundingClientRect();
            const left = Math.min(Math.max(0, pos.left), window.parent.innerWidth - rect.width);
            const top = Math.min(Math.max(0, pos.top), window.parent.innerHeight - rect.height);
            root.style.left = `${left}px`;
            root.style.top = `${top}px`;
            root.style.right = 'auto';
            root.style.bottom = 'auto';
        } catch { /* ignore */ }
    };
    // default spot: right edge, above mobile keyboard area
    root.style.right = 'max(12px, env(safe-area-inset-right))';
    root.style.bottom = 'calc(96px + env(safe-area-inset-bottom))';
    applyPos();

    let wasDragged = false;
    trigger.addEventListener('pointerdown', (evt) => {
        if (evt.button !== 0) return;
        const startX = evt.clientX;
        const startY = evt.clientY;
        const rect = trigger.getBoundingClientRect();
        const offsetX = startX - rect.left;
        const offsetY = startY - rect.top;
        wasDragged = false;
        const onMove = (e) => {
            if (!wasDragged && Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
            wasDragged = true;
            const left = Math.min(Math.max(0, e.clientX - offsetX), window.parent.innerWidth - rect.width);
            const top = Math.min(Math.max(0, e.clientY - offsetY), window.parent.innerHeight - rect.height);
            root.style.left = `${left}px`;
            root.style.top = `${top}px`;
            root.style.right = 'auto';
            root.style.bottom = 'auto';
        };
        const onUp = () => {
            window.parent.removeEventListener('pointermove', onMove);
            window.parent.removeEventListener('pointerup', onUp);
            window.parent.removeEventListener('pointercancel', onUp);
            if (wasDragged) {
                const r = trigger.getBoundingClientRect();
                localStorage.setItem(POS_KEY, JSON.stringify({ left: r.left, top: r.top }));
                setTimeout(() => wasDragged = false, 0);
            }
        };
        window.parent.addEventListener('pointermove', onMove);
        window.parent.addEventListener('pointerup', onUp);
        window.parent.addEventListener('pointercancel', onUp);
    });
    window.parent.addEventListener('resize', applyPos);

    // ---------- popup ----------

    const backdrop = el('div');
    backdrop.id = 'lbi--backdrop';
    const modal = el('div', 'lbi--modal');

    const header = el('div', 'lbi--header');
    header.append(
        el('div', 'lbi--headerTitle', 'Active World Info'),
        el('span', 'lbi--headerCount', '0'),
    );
    const close = el('div', 'lbi--close', '✕');
    close.title = 'Close';
    header.append(close);
    modal.append(header);

    const body = el('div', 'lbi--body', '');
    modal.append(body);

    const footer = el('div', 'lbi--footer', '');
    modal.append(footer);

    backdrop.append(modal);
    PARENT.body.append(backdrop);

    const closePopup = () => backdrop.classList.remove('lbi--isOpen');
    const openPopup = () => {
        body.textContent = entries.length ? '' : 'Loading...';
        backdrop.classList.add('lbi--isOpen');
        render();
        if (!entries.length) fetchEntries();
    };
    trigger.addEventListener('click', () => {
        if (wasDragged) return;
        backdrop.classList.contains('lbi--isOpen') ? closePopup() : openPopup();
    });
    close.addEventListener('click', closePopup);
    backdrop.addEventListener('click', (evt) => {
        if (evt.target === backdrop) closePopup();
    });
    window.parent.addEventListener('keydown', (evt) => {
        if (evt.key === 'Escape') closePopup();
    });

    // ---------- rendering ----------

    const entryRow = (entry) => {
        const row = el('div', 'lbi--entry');
        row.append(el('span', `lbi--dot lbi--${getStrategy(entry)}`));

        const main = el('div', 'lbi--main');
        main.append(el('div', 'lbi--title', entry.comment?.length ? entry.comment : (entry.key ?? []).join(', ') || '(no title)'));

        const r = entry.stwiiReason;
        if (r?.matchedKeys?.length) {
            const chips = el('div', 'lbi--chips');
            for (const k of r.matchedKeys) {
                chips.append(el('span',
                    `lbi--chip ${k.source == 'chat' ? 'lbi--chipChat' : 'lbi--chipRec'}`,
                    k.source == 'chat' ? k.key : `↩ ${k.key}`,
                ));
            }
            main.append(chips);
        }
        row.append(main);

        if (entry.sticky > 0) {
            const st = el('span', 'lbi--sticky', `📌 ${entry.sticky}`);
            st.title = `Sticky for ${entry.sticky} more rounds`;
            row.append(st);
        }

        // tooltip: book, strategy, reason, content preview
        const reason = describeReason(entry);
        row.title = [
            `[${entry.world}] ${entry.comment?.length ? entry.comment : (entry.key ?? []).join(', ')}`,
            `◆ ${STRATEGY_LABEL[getStrategy(entry)]}`,
            reason ? `---\n${reason}` : '',
            `---\n${(entry.content ?? '').slice(0, 500)}`,
        ].filter(Boolean).join('\n');
        return row;
    };

    const render = () => {
        if (!body) return;
        body.textContent = '';
        header.querySelector('.lbi--headerCount').textContent = `${entries.length}`;
        trigger.setAttribute('data-lbi--count', `${entries.length}`);
        badge.textContent = entries.length > 99 ? '99+' : `${entries.length}`;

        if (!entries.length) {
            body.append(el('div', 'lbi--empty', 'No active entries'));
            footer.textContent = '';
            return;
        }

        const grouped = Object.groupBy(entries, it => it.world ?? '—');
        for (const [world, list] of Object.entries(grouped)) {
            const h = el('div', 'lbi--world');
            h.append(
                el('span', 'lbi--worldCount', `${list.length}`),
                el('span', '', world),
            );
            body.append(h);
            for (const entry of list) body.append(entryRow(entry));
        }
        footer.textContent = `${entries.length} entries · ${Object.keys(grouped).length} books`;
    };

    // ---------- events ----------

    if (typeof eventOn === 'function' && typeof tavern_events !== 'undefined') {
        // WORLD_INFO_ACTIVATED may fire before the extension finished updating its list,
        // so pull the data slightly after the event (and again when generation ends).
        eventOn(tavern_events.WORLD_INFO_ACTIVATED, () => setTimeout(fetchEntries, 300));
        eventOn(tavern_events.GENERATION_ENDED, () => setTimeout(fetchEntries, 100));
    }

    // initial pull
    setTimeout(fetchEntries, 500);
})();
