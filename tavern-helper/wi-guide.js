// IF Lorebook — Live Guide for the World Info editor (standalone for Tavern Helper / JS-Slash-Runner)
//
// Install: Tavern Helper → 脚本库 (Script Library) → 全局脚本 (Global Script) →
//          new script → paste this whole file → save & enable.
//
// Features:
// - Underlines words in an entry's Content that are keywords of OTHER entries in
//   the same lorebook (potential recursion triggers). Hover / tap to see which
//   entry it links to, whether the link is blocked, and its trigger chance.
// - Adds small ⓘ hint icons next to every entry setting with usage guidance (Vietnamese).

(() => {
    'use strict';

    // Tavern Helper scripts run in a same-origin iframe; the real UI lives in the parent.
    const PARENT = window.parent.document;
    const ctx = window.parent.SillyTavern?.getContext?.();
    if (!ctx?.loadWorldInfo) {
        console.warn('[LorebookGuide] SillyTavern context not found — must run inside Tavern Helper.');
        return;
    }

    // idempotent: remove nodes from a previous script instance
    PARENT.getElementById('lbg--style')?.remove();
    PARENT.getElementById('stwii--tooltip')?.remove();

    const esc = (s)=>String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    ;

    // ---------- styles ----------
    const style = PARENT.createElement('style');
    style.id = 'lbg--style';
    style.textContent = `
.stwii--hintIcon {
    font-size: 8px !important;
    line-height: 1;
    opacity: 0.35;
    margin-left: 3px;
    cursor: help;
    transition: opacity 200ms;
    vertical-align: super;
    /* slightly larger invisible tap target on touch screens */
    padding: 2px;
    margin-top: -2px;
    margin-bottom: -2px;
}
.stwii--hintIcon:hover { opacity: 1; }
#stwii--tooltip {
    display: none;
    position: fixed;
    z-index: 31000;
    max-width: min(22em, 85vw);
    padding: 0.6em 0.75em;
    border-radius: 8px;
    background-color: var(--SmartThemeBlurTintColor, rgba(20, 22, 34, 0.95));
    border: 1px solid var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.25));
    color: var(--SmartThemeBodyColor, #eee);
    font-size: 0.85em;
    line-height: 1.4;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(4px);
    pointer-events: none;
}
#stwii--tooltip .stwii--tooltipTitle { font-weight: bold; margin-bottom: 0.35em; }
#stwii--tooltip .stwii--tooltipBody { white-space: pre-wrap; opacity: 0.9; }
.stwii--contentWrap { position: relative; width: 100%; }
.stwii--contentWrap textarea[name="content"] {
    position: relative;
    z-index: 1;
    background: transparent;
    width: 100%;
}
.stwii--contentOverlay {
    position: absolute;
    inset: 0;
    z-index: 2;
    overflow: hidden;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    word-break: break-word;
    color: transparent;
    pointer-events: none;
    box-sizing: border-box;
}
.stwii--contentOverlay .stwii--kw {
    pointer-events: auto;
    cursor: help;
    border-bottom: 2px solid rgba(90, 170, 255, 0.85);
    border-radius: 1px;
}
.stwii--contentOverlay .stwii--kw-blocked {
    border-bottom: 2px dotted rgba(255, 170, 60, 0.9);
}
`;
    PARENT.head.append(style);

    // ---------- shared tooltip ----------
    let tooltip;
    const getTooltip = ()=>{
        if (!tooltip) {
            tooltip = PARENT.createElement('div');
            tooltip.id = 'stwii--tooltip';
            PARENT.body.append(tooltip);
            // dismiss on tap/click anywhere else (old tooltip always goes away)
            PARENT.addEventListener('pointerdown', (evt)=>{
                const anchor = tooltip.stwiiAnchor;
                const onAnchor = anchor && (anchor === evt.target || anchor.contains?.(evt.target));
                if (tooltip.style.display == 'block' && !tooltip.contains(evt.target) && !onAnchor) {
                    hideTooltip();
                }
            }, true);
            window.parent.addEventListener('scroll', hideTooltip, true);
        }
        return tooltip;
    };
    const hideTooltip = ()=>{
        if (!tooltip) return;
        tooltip.style.display = 'none';
        tooltip.stwiiAnchor = null;
    };
    const showTooltip = (anchor, html)=>{
        const tt = getTooltip();
        tt.innerHTML = html;
        tt.stwiiAnchor = anchor;
        tt.style.display = 'block';
        tt.style.left = '0px';
        tt.style.top = '0px';
        const vw = window.parent.innerWidth;
        const vh = window.parent.innerHeight;
        const ar = anchor.getBoundingClientRect();
        const tr = tt.getBoundingClientRect();
        let left = ar.left + ar.width / 2 - tr.width / 2;
        left = Math.min(Math.max(8, left), vw - tr.width - 8);
        let top = ar.bottom + 8;
        if (top + tr.height > vh - 8) top = ar.top - tr.height - 8;
        top = Math.max(8, top);
        tt.style.left = `${left}px`;
        tt.style.top = `${top}px`;
    };

    // ---------- hint definitions ----------
    const HINTS = [
        { anchor: '.WIEntryTitleAndStatus', title: 'Trạng thái entry', text: '🔵 Constant: LUÔN được chèn vào prompt, không cần keyword.\n🟢 Normal: chỉ chèn khi keyword xuất hiện trong chat.\n🔗 Vectorized: chèn theo độ tương đồng ngữ nghĩa (cần bật extension Vector Storage).\n\n💡 Dùng Constant cho luật thế giới / thông tin cốt lõi; Normal cho nhân vật, địa điểm, sự kiện cụ thể.' },
        { anchor: 'div[name="PositionBlock"]', title: 'Position — vị trí chèn', text: '↑/↓Char: trước/sau mô tả nhân vật.\n↑/↓EM: quanh tin nhắn mẫu.\n↑/↓AN: quanh Author\'s Note.\n@D ⚙️/👤/🤖: chèn vào giữa lịch sử chat theo độ sâu, với vai system/user/assistant.\n\n💡 Càng gần cuối prompt (@D với Depth nhỏ) ảnh hưởng tới AI càng mạnh. Lore nền → ↑Char; chỉ dẫn hành vi tức thời → @D ⚙️.' },
        { anchor: '.world_entry_form_control:has(input[name="depth"])', title: 'Depth — độ sâu', text: 'Chỉ dùng với position @D: chèn cách tin nhắn mới nhất N tin.\n\n💡 Depth 0–2: ảnh hưởng rất mạnh (sát tin mới nhất). Depth lớn: chỉ làm nền, ít chi phối câu trả lời.' },
        { anchor: '.world_entry_form_control:has(input[name="order"])', title: 'Order — thứ tự', text: 'Khi nhiều entry cùng một vị trí, entry có Order LỚN hơn nằm gần cuối prompt hơn → ảnh hưởng mạnh hơn.\n\n💡 Đặt Order cao cho entry quan trọng để nó "đè" các entry khác khi trùng vị trí.' },
        { anchor: '.probabilityContainer', title: 'Trigger % — xác suất kích hoạt', text: 'Xác suất entry được chèn mỗi lần đủ điều kiện. 100% = luôn chèn.\n\n💡 Giảm xuống (vd 30%) cho các yếu tố ngẫu nhiên: tin đồn, thời tiết, sự kiện hiếm — giúp chat đỡ lặp lại.' },
        { anchor: '.keyprimary>small.textAlignCenter', title: 'Primary Keywords', text: 'Entry kích hoạt khi MỘT trong các từ khóa này xuất hiện trong các tin nhắn được quét (hoặc trong nội dung entry khác đã active — đệ quy).\n\n💡 Hỗ trợ regex dạng /pattern/flags. Chọn từ khóa đặc trưng, tránh từ quá phổ biến ("cô", "anh"…) kẻo entry kích hoạt liên tục.' },
        { anchor: '.world_entry_form_control:has(select[name="entryLogicType"])>small', title: 'Logic — kết hợp filter', text: 'Cách kết hợp Primary với Optional Filter:\n• AND ANY: cần ít nhất 1 filter khớp.\n• AND ALL: cần TẤT CẢ filter khớp.\n• NOT ANY: không filter nào được khớp.\n• NOT ALL: miễn là không khớp đủ hết.\n\n💡 AND ANY là lựa chọn phổ biến nhất.' },
        { anchor: '.keysecondary>small.textAlignCenter', title: 'Optional Filter — khóa phụ', text: 'Điều kiện bổ sung (kết hợp theo Logic). Bỏ trống = không dùng.\n\n💡 Dùng khi một từ khóa có nhiều nghĩa: vd key "rồng" + filter "hang, núi" để chỉ kích hoạt entry "Rồng núi lửa" đúng ngữ cảnh.' },
        { anchor: '.world_entry_form_control:has(input[name="scanDepth"])>small', title: 'Scan Depth', text: 'Số tin nhắn gần nhất được quét tìm keyword — ghi đè cài đặt chung cho riêng entry này.\n\n💡 Đặt 1–2 cho phản ứng tức thời (chỉ khi vừa nhắc tới); đặt lớn cho bối cảnh cần "nhớ lâu".' },
        { anchor: '.world_entry_form_control:has(select[name="caseSensitive"])>small', title: 'Case-Sensitive', text: 'Có phân biệt HOA/thường khi so keyword không.\n\n💡 Bật khi keyword là tên riêng dễ trùng từ thường, vd "Hà" (tên) khác "hà" (con hà).' },
        { anchor: '.world_entry_form_control:has(select[name="matchWholeWords"])>small', title: 'Whole Words', text: 'Chỉ khớp nguyên từ, không khớp chuỗi con.\n\n💡 Bật để "an" không khớp trong "bàn ăn". Với tiếng Việt/CJK hoặc keyword là một phần từ ghép thì nên tắt.' },
        { anchor: '.world_entry_form_control:has(select[name="useGroupScoring"])>small', title: 'Group Scoring', text: 'Khi bật, entry trong cùng Inclusion Group được chọn theo SỐ keyword khớp (nhiều hơn thắng) thay vì ngẫu nhiên theo Group Weight.' },
        { anchor: '.world_entry_form_control:has(input[name="automationId"])>small', title: 'Automation ID', text: 'Khi entry kích hoạt sẽ chạy Quick Reply có cùng Automation ID.\n\n💡 Dùng để tự động hóa: entry "trời mưa" active → tự chạy lệnh đổi background chẳng hạn.' },
        { anchor: '.world_entry_form_control:has(input[name="delayUntilRecursionLevel"])>small', title: 'Recursion Level', text: 'Phân tầng cho "Delay until recursion": level 1 quét trước, hết match mới tới level 2…\n\n💡 Dùng xây chuỗi lore nhiều lớp: tổng quan (1) → chi tiết (2) → bí mật (3).' },
        { anchor: 'label:has(input[name="excludeRecursion"])>span', title: 'Non-recursable', text: 'Entry này KHÔNG THỂ bị kích hoạt bởi nội dung entry khác (đệ quy) — chỉ kích hoạt khi keyword xuất hiện trực tiếp trong chat.\n\n💡 Dùng khi: entry chỉ nên xuất hiện lúc người chơi thực sự nhắc tới, tránh bị "dây chuyền" kéo vào làm tốn context.' },
        { anchor: 'label:has(input[name="preventRecursion"])>span', title: 'Prevent further recursion', text: 'Nội dung entry này sẽ KHÔNG kích hoạt entry khác qua đệ quy.\n\n💡 Dùng khi: entry chứa nhiều tên/từ khóa chung (vd bảng tóm tắt, danh sách nhân vật) mà bạn không muốn kéo theo hàng loạt entry khác.' },
        { anchor: 'label:has(input[name="delay_until_recursion"])>span', title: 'Delay until recursion', text: 'Entry CHỈ có thể kích hoạt ở vòng quét đệ quy — tức phải có entry khác active nhắc tới keyword của nó, chat nhắc trực tiếp cũng không kích hoạt.\n\n💡 Dùng cho "chi tiết mở rộng": chỉ xuất hiện khi entry chính đã active.' },
        { anchor: 'label:has(input[name="ignoreBudget"])>span', title: 'Ignore budget', text: 'Luôn chèn entry dù đã vượt ngân sách token của World Info.\n\n💡 Chỉ dành cho thông tin sống còn. Lạm dụng sẽ phình prompt và đẩy các entry khác ra ngoài.' },
        { anchor: 'small[for="group"]', title: 'Inclusion Group', text: 'Các entry cùng group: mỗi lần chỉ MỘT entry được chọn chèn (theo Group Weight hoặc Group Scoring).\n\n💡 Dùng cho các biến thể loại trừ nhau: vd 3 entry "tâm trạng vui/buồn/giận" cùng group "tâm trạng". Có thể ghi nhiều group, cách nhau dấu phẩy.' },
        { anchor: '.flexFlowColumn:has(input[name="groupWeight"])>div>small', title: 'Group Weight', text: 'Trọng số khi bốc thăm trong Inclusion Group — số càng lớn càng dễ được chọn (mặc định 100).' },
        { anchor: 'small[for="sticky"]', title: 'Sticky — bám dính', text: 'Sau khi kích hoạt, entry tiếp tục active thêm N tin nhắn dù không còn keyword nào khớp.\n\n💡 Dùng cho sự kiện/địa điểm cần duy trì bối cảnh liên tục vài lượt (vd đang trong trận đánh, đang ở lễ hội).' },
        { anchor: 'small[for="cooldown"]', title: 'Cooldown — hồi chiêu', text: 'Sau khi kích hoạt, entry bị khóa N tin nhắn không thể kích hoạt lại.\n\n💡 Kết hợp Sticky + Cooldown để sự kiện diễn ra một hồi rồi tạm nghỉ, tránh spam.' },
        { anchor: 'small[for="delay"]', title: 'Delay — trì hoãn', text: 'Entry chỉ đủ điều kiện kích hoạt khi chat đã có ít nhất N tin nhắn.\n\n💡 Dùng cho plot twist / thông tin giai đoạn sau: đầu chat chưa lộ, về sau mới xuất hiện.' },
        { anchor: 'label.checkbox:has(input[name="selective"])>span', title: 'Selective', text: 'Bật để dùng Optional Filter (khóa phụ). Tắt thì chỉ xét Primary Keywords.' },
        { anchor: 'label.checkbox:has(input[name="useProbability"])>span', title: 'Use Probability', text: 'Bật để áp dụng Trigger % (xác suất). Tắt = luôn 100%.' },
        { anchor: 'label.checkbox:has(input[name="addMemo"])>span', title: 'Add Memo', text: 'Hiện ô tiêu đề/ghi chú cho entry. Memo chỉ để bạn quản lý, KHÔNG được gửi cho AI.' },
        { anchor: 'strong[data-i18n="Additional Matching Sources"]', title: 'Additional Matching Sources', text: 'Ngoài tin nhắn chat, keyword còn được quét trong các nguồn tick chọn: mô tả nhân vật, persona, scenario…\n\n💡 Dùng khi muốn entry tự active theo thông tin nhân vật (vd nhân vật nào có chữ "ma cà rồng" trong description thì lore ma cà rồng luôn bật).' },
    ];

    const attachHints = (root)=>{
        for (const def of HINTS) {
            let anchor;
            try { anchor = root.querySelector(def.anchor); } catch { continue; }
            if (!anchor || anchor.querySelector(':scope > .stwii--hintIcon')) continue;
            const icon = PARENT.createElement('i');
            icon.classList.add('stwii--hintIcon', 'fa-solid', 'fa-circle-question');
            icon.tabIndex = -1;
            const html = `<div class="stwii--tooltipTitle">${esc(def.title)}</div><div class="stwii--tooltipBody">${esc(def.text)}</div>`;
            let hoverShown = false;
            icon.addEventListener('click', (evt)=>{
                evt.preventDefault();
                evt.stopPropagation();
                // second tap/click on the same icon closes it (but not right after a hover-open)
                if (getTooltip().stwiiAnchor === icon && tooltip.style.display == 'block' && !hoverShown) {
                    hideTooltip();
                } else {
                    showTooltip(icon, html);
                    hoverShown = false;
                }
            });
            // hover only for real mouse — emulated hover on touch would fight with the tap
            icon.addEventListener('pointerenter', (evt)=>{
                if (evt.pointerType !== 'mouse') return;
                showTooltip(icon, html);
                hoverShown = true;
            });
            icon.addEventListener('pointerleave', (evt)=>{
                if (evt.pointerType !== 'mouse') return;
                hideTooltip();
                hoverShown = false;
            });
            anchor.append(icon);
        }
    };

    // ---------- keyword cross-link underlining ----------
    const getGlobalWISettings = ()=>({
        // read straight from the World Info settings checkboxes in the UI
        caseSensitive: !!PARENT.querySelector('#world_info_case_sensitive')?.checked,
        wholeWords: !!PARENT.querySelector('#world_info_match_whole_words')?.checked,
        recursive: PARENT.querySelector('#world_info_recursive')?.checked ?? true,
    });

    const parseRegexFromString = (input)=>{
        const match = String(input).match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
        if (!match) return null;
        try { return new RegExp(match[1], match[2]); } catch { return null; }
    };

    const findRanges = (text, key, target, g)=>{
        const ranges = [];
        const keyRegex = parseRegexFromString(key);
        if (keyRegex) {
            const flags = keyRegex.flags.includes('g') ? keyRegex.flags : keyRegex.flags + 'g';
            let re;
            try { re = new RegExp(keyRegex.source, flags); } catch { return ranges; }
            let m;
            let guard = 0;
            while ((m = re.exec(text)) !== null && guard++ < 200) {
                if (m[0].length == 0) { re.lastIndex++; continue; }
                ranges.push([m.index, m.index + m[0].length]);
            }
            return ranges;
        }
        const caseSensitive = target.caseSensitive ?? g.caseSensitive;
        const hay = caseSensitive ? text : text.toLowerCase();
        const needle = caseSensitive ? key : key.toLowerCase();
        if (!needle.length) return ranges;
        const wholeWords = (target.matchWholeWords ?? g.wholeWords) && needle.split(/\s+/).length == 1;
        let idx = 0;
        while ((idx = hay.indexOf(needle, idx)) !== -1) {
            const end = idx + needle.length;
            if (wholeWords) {
                const before = idx > 0 ? hay[idx - 1] : '';
                const after = end < hay.length ? hay[end] : '';
                if (/\w/.test(before) || /\w/.test(after)) { idx = end; continue; }
            }
            ranges.push([idx, end]);
            idx = end;
        }
        return ranges;
    };

    const getEditorBookName = ()=>PARENT.querySelector('#world_editor_select')?.selectedOptions?.[0]?.textContent?.trim();

    const enhanceContent = (editEl)=>{
        const entryRoot = editEl.closest('.world_entry');
        const uid = entryRoot?.getAttribute('uid');
        const textarea = editEl.querySelector('textarea[name="content"]');
        if (!textarea || uid === null || uid === undefined) return;

        const wrap = PARENT.createElement('div');
        wrap.classList.add('stwii--contentWrap');
        textarea.parentNode.insertBefore(wrap, textarea);
        wrap.append(textarea);
        const overlay = PARENT.createElement('div');
        overlay.classList.add('stwii--contentOverlay');
        wrap.append(overlay);

        const syncStyles = ()=>{
            const cs = window.parent.getComputedStyle(textarea);
            for (const prop of ['font', 'letterSpacing', 'lineHeight', 'padding', 'borderWidth', 'borderStyle', 'textAlign']) {
                overlay.style[prop] = cs[prop];
            }
            overlay.style.borderColor = 'transparent';
        };
        const syncScroll = ()=>{
            overlay.scrollTop = textarea.scrollTop;
            overlay.scrollLeft = textarea.scrollLeft;
        };
        textarea.addEventListener('scroll', syncScroll);

        let markInfo = {};
        const analyze = async ()=>{
            const bookName = getEditorBookName();
            if (!bookName) return;
            let data;
            try { data = await ctx.loadWorldInfo(bookName); } catch { return; }
            if (!data?.entries) return;
            const g = getGlobalWISettings();
            const source = data.entries[uid] ?? {};
            const text = textarea.value ?? '';
            const marks = [];
            for (const [tuid, target] of Object.entries(data.entries)) {
                if (String(tuid) == String(uid)) continue;
                if (target.disable) continue;
                for (const rawKey of target.key ?? []) {
                    let key;
                    try { key = ctx.substituteParams(rawKey); } catch { key = rawKey; }
                    if (!key) continue;
                    for (const [s, e] of findRanges(text, key, target, g)) {
                        marks.push({ s, e, tuid, key });
                    }
                }
            }
            marks.sort((a, b)=>a.s - b.s || (b.e - b.s) - (a.e - a.s));
            const chosen = [];
            let lastEnd = -1;
            for (const m of marks) {
                if (m.s >= lastEnd) { chosen.push(m); lastEnd = m.e; }
            }
            markInfo = {};
            let html = '';
            let pos = 0;
            let id = 0;
            for (const m of chosen) {
                const target = data.entries[m.tuid];
                const blockers = [];
                if (!g.recursive) blockers.push('Đệ quy (Recursive Scan) đang TẮT trong cài đặt World Info toàn cục.');
                if (source.preventRecursion) blockers.push('Entry này bật "Prevent further recursion" — không kích hoạt entry khác.');
                if (target.excludeRecursion) blockers.push('Entry đích bật "Non-recursable" — không thể bị kích hoạt qua đệ quy.');
                const ok = blockers.length == 0;
                const prob = target.useProbability === false ? 100 : (target.probability ?? 100);
                const targetName = target.comment?.length ? target.comment : (target.key ?? []).join(', ');
                markInfo[id] = [
                    `<div class="stwii--tooltipTitle">🔑 "${esc(m.key)}" → ${esc(targetName)}</div>`,
                    `<div class="stwii--tooltipBody">${ok
                        ? `✅ Khi entry này active, từ này có thể kích hoạt entry trên qua đệ quy.\n🎲 Tỉ lệ trigger: ${prob}%${target.constant ? '\n🔵 Entry đích là Constant (vốn luôn active).' : ''}`
                        : `⚠️ Link đệ quy đang bị chặn:\n${blockers.map(b=>`• ${b}`).join('\n')}`
                    }</div>`,
                ].join('');
                html += esc(text.slice(pos, m.s));
                html += `<span class="stwii--kw ${ok ? 'stwii--kw-ok' : 'stwii--kw-blocked'}" data-stwii-mark="${id}">${esc(text.slice(m.s, m.e))}</span>`;
                pos = m.e;
                id++;
            }
            html += esc(text.slice(pos));
            overlay.innerHTML = `${html}\u200b`;
            syncStyles();
            syncScroll();
        };

        const markFromEvent = (evt)=>evt.target.closest?.('.stwii--kw');
        overlay.addEventListener('mouseover', (evt)=>{
            const mark = markFromEvent(evt);
            if (mark) showTooltip(mark, markInfo[mark.dataset.stwiiMark] ?? '');
        });
        overlay.addEventListener('mouseout', (evt)=>{
            if (markFromEvent(evt)) hideTooltip();
        });
        overlay.addEventListener('click', (evt)=>{
            const mark = markFromEvent(evt);
            if (!mark) return;
            evt.preventDefault();
            showTooltip(mark, markInfo[mark.dataset.stwiiMark] ?? '');
        });
        overlay.addEventListener('wheel', (evt)=>{
            textarea.scrollTop += evt.deltaY;
            syncScroll();
        }, { passive: true });

        let debounceTimer;
        textarea.addEventListener('input', ()=>{
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(analyze, 600);
        });
        editEl.stwiiAnalyze = analyze;
        analyze();
    };

    // ---------- wiring ----------
    const enhanceEdit = (editEl)=>{
        if (editEl.dataset.stwiiGuide) return;
        editEl.dataset.stwiiGuide = '1';
        attachHints(editEl);
        enhanceContent(editEl);
    };
    const enhanceHeader = (entryEl)=>{
        if (entryEl.dataset.stwiiGuide) return;
        entryEl.dataset.stwiiGuide = '1';
        attachHints(entryEl);
    };

    const scan = (root)=>{
        if (!(root instanceof window.parent.Element)) return;
        if (root.matches('.world_entry')) enhanceHeader(root);
        root.querySelectorAll('.world_entry').forEach(enhanceHeader);
        if (root.matches('.world_entry_edit')) enhanceEdit(root);
        root.querySelectorAll('.world_entry_edit').forEach(enhanceEdit);
    };

    const start = ()=>{
        const list = PARENT.querySelector('#world_popup_entries_list');
        if (!list) {
            setTimeout(start, 2000);
            return;
        }
        scan(list);
        const observer = new window.parent.MutationObserver((mutations)=>{
            for (const mut of mutations) {
                for (const node of mut.addedNodes) scan(node);
            }
        });
        observer.observe(list, { childList: true, subtree: true });
        // re-check links when a book is saved (keys may have changed)
        ctx.eventSource?.on?.(ctx.eventTypes?.WORLDINFO_UPDATED ?? 'worldinfo_updated', ()=>{
            PARENT.querySelectorAll('#world_popup_entries_list .world_entry_edit').forEach(el=>el.stwiiAnalyze?.());
        });
        console.log('[LorebookGuide] live guide attached');
    };
    start();
})();
