import { chat, chat_metadata, event_types, eventSource, main_api, saveSettingsDebounced, substituteParams } from '../../../../script.js';
import { metadata_keys } from '../../../authors-note.js';
import { extension_settings } from '../../../extensions.js';
import { promptManager } from '../../../openai.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { delay, escapeRegex } from '../../../utils.js';
import { parseRegexFromString, world_info_case_sensitive, world_info_depth, world_info_logic, world_info_match_whole_words, world_info_position } from '../../../world-info.js';
import { initGuide } from './wi-guide.js';

const strategy = {
    constant: '🔵',
    normal: '🟢',
    vectorized: '🔗',
};
const getStrategy = (entry)=>{
    if (entry.constant === true) {
        return 'constant';
    } else if (entry.vectorized === true) {
        return 'vectorized';
    } else {
        return 'normal';
    }
};

let generationType;
eventSource.on(event_types.GENERATION_STARTED, (genType)=>generationType = genType);

const logicNames = {
    [world_info_logic.AND_ANY]: 'AND ANY',
    [world_info_logic.NOT_ALL]: 'NOT ALL',
    [world_info_logic.NOT_ANY]: 'NOT ANY',
    [world_info_logic.AND_ALL]: 'AND ALL',
};

// mirrors WorldInfoBuffer.#transformString
const transformString = (str, entry)=>{
    const caseSensitive = entry.caseSensitive ?? world_info_case_sensitive;
    return caseSensitive ? str : str.toLowerCase();
};
// mirrors WorldInfoBuffer.matchKeys
const matchKey = (haystack, needle, entry)=>{
    const keyRegex = parseRegexFromString(needle);
    if (keyRegex) {
        return keyRegex.test(haystack);
    }
    haystack = transformString(haystack, entry);
    const transformedNeedle = transformString(needle, entry);
    const matchWholeWords = entry.matchWholeWords ?? world_info_match_whole_words;
    if (matchWholeWords) {
        const keyWords = transformedNeedle.split(/\s+/);
        if (keyWords.length > 1) {
            return haystack.includes(transformedNeedle);
        }
        return new RegExp(`(?:^|\\W)(${escapeRegex(transformedNeedle)})(?:$|\\W)`).test(haystack);
    }
    return haystack.includes(transformedNeedle);
};

/**
 * Figure out why an entry was activated: constant / sticky / vectorized,
 * or which keywords matched (in recent chat messages or via recursion).
 */
const analyzeActivation = (entry, entryList)=>{
    const reason = { type: 'keys', matchedKeys: [], secondary: [], logic: null };
    if (entry.constant === true) {
        reason.type = 'constant';
        return reason;
    }
    let scanChat = [...chat];
    if (generationType == 'swipe') scanChat.pop();
    const depth = entry.scanDepth ?? world_info_depth;
    const chatText = scanChat
        .slice(-depth)
        .map(m=>`${m.name}: ${m.mes}`)
        .join('\n')
    ;
    for (const rawKey of entry.key ?? []) {
        const key = substituteParams(rawKey);
        if (matchKey(chatText, key, entry)) {
            reason.matchedKeys.push({ key, source: 'chat' });
            continue;
        }
        // not in chat → maybe activated through recursion (content of another activated entry)
        for (const other of entryList) {
            if (other == entry) continue;
            if (matchKey(substituteParams(other.content ?? ''), key, entry)) {
                reason.matchedKeys.push({ key, source: `↩ ${other.comment?.length ? other.comment : (other.key ?? []).join(', ')}` });
                break;
            }
        }
    }
    if (entry.selective && entry.keysecondary?.length) {
        reason.logic = entry.selectiveLogic ?? world_info_logic.AND_ANY;
        for (const rawKey of entry.keysecondary) {
            const key = substituteParams(rawKey);
            reason.secondary.push({ key, matched: matchKey(chatText, key, entry) });
        }
    }
    if (reason.matchedKeys.length == 0) {
        if (entry.vectorized === true) reason.type = 'vectorized';
        else if (entry.sticky > 0) reason.type = 'sticky';
        else reason.type = 'unknown';
    }
    return reason;
};

const describeReason = (entry)=>{
    const r = entry.stwiiReason;
    if (!r) return '';
    const parts = [];
    if (r.type == 'constant') parts.push('🔵 Constant — always active');
    if (r.type == 'sticky') parts.push(`📌 Sticky — no key matched, still active for ${entry.sticky} more rounds`);
    if (r.type == 'vectorized') parts.push('🔗 Vectorized — activated by vector similarity, no literal key match');
    for (const k of r.matchedKeys) {
        parts.push(k.source == 'chat'
            ? `🔑 "${k.key}" — found in scanned messages`
            : `🔑 "${k.key}" — via recursion from entry "${k.source.slice(2)}"`);
    }
    if (r.secondary?.length) {
        parts.push(`Filter (${logicNames[r.logic]}): ${r.secondary.map(s=>`${s.matched ? '✔' : '✘'} "${s.key}"`).join('  ')}`);
    }
    if (r.type == 'unknown') parts.push('❓ No key match found (forced activation, /trigger, or external extension?)');
    return parts.join('\n');
};

const init = ()=>{
    let wasDragged = false;
    const closeAll = ()=>{
        panel.classList.remove('stwii--isActive');
        configPanel.classList.remove('stwii--isActive');
        backdrop.classList.remove('stwii--isActive');
    };
    const syncBackdrop = ()=>{
        const anyOpen = panel.classList.contains('stwii--isActive') || configPanel.classList.contains('stwii--isActive');
        backdrop.classList.toggle('stwii--isActive', anyOpen);
    };
    const makeHeader = (parent, titleText)=>{
        const header = document.createElement('div'); {
            header.classList.add('stwii--panelHeader');
            const title = document.createElement('div'); {
                title.classList.add('stwii--panelTitle');
                title.textContent = titleText;
                header.append(title);
            }
            const close = document.createElement('div'); {
                close.classList.add('stwii--panelClose');
                close.classList.add('fa-solid', 'fa-fw', 'fa-xmark');
                close.title = 'Close';
                close.addEventListener('click', closeAll);
                header.append(close);
            }
            parent.append(header);
        }
    };
    const trigger = document.createElement('div'); {
        trigger.classList.add('stwii--trigger');
        trigger.classList.add('fa-solid', 'fa-fw', 'fa-book-atlas');
        trigger.title = 'Active WI\n---\nright click for options\ndrag to move';
        trigger.addEventListener('click', ()=>{
            if (wasDragged) return;
            configPanel.classList.remove('stwii--isActive');
            panel.classList.toggle('stwii--isActive');
            syncBackdrop();
        });
        trigger.addEventListener('contextmenu', (evt)=>{
            evt.preventDefault();
            if (wasDragged) return;
            panel.classList.remove('stwii--isActive');
            configPanel.classList.toggle('stwii--isActive');
            syncBackdrop();
        });
        // drag to move (position saved in settings)
        const applyTriggerPos = ()=>{
            const pos = extension_settings.worldInfoInfo?.triggerPos;
            if (!pos) return;
            const rect = trigger.getBoundingClientRect();
            const left = Math.min(Math.max(0, pos.left), window.innerWidth - rect.width);
            const top = Math.min(Math.max(0, pos.top), window.innerHeight - rect.height);
            trigger.style.left = `${left}px`;
            trigger.style.top = `${top}px`;
            trigger.style.bottom = 'auto';
            trigger.style.right = 'auto';
        };
        trigger.addEventListener('pointerdown', (evt)=>{
            if (evt.button !== 0) return;
            const startX = evt.clientX;
            const startY = evt.clientY;
            const rect = trigger.getBoundingClientRect();
            const offsetX = startX - rect.left;
            const offsetY = startY - rect.top;
            wasDragged = false;
            const onMove = (e)=>{
                if (!wasDragged && Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
                wasDragged = true;
                const left = Math.min(Math.max(0, e.clientX - offsetX), window.innerWidth - rect.width);
                const top = Math.min(Math.max(0, e.clientY - offsetY), window.innerHeight - rect.height);
                trigger.style.left = `${left}px`;
                trigger.style.top = `${top}px`;
                trigger.style.bottom = 'auto';
                trigger.style.right = 'auto';
            };
            const onUp = ()=>{
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onUp);
                if (wasDragged) {
                    const rect = trigger.getBoundingClientRect();
                    if (!extension_settings.worldInfoInfo) {
                        extension_settings.worldInfoInfo = {};
                    }
                    extension_settings.worldInfoInfo.triggerPos = { left: rect.left, top: rect.top };
                    saveSettingsDebounced();
                    // let the click event fire (and get ignored) before resetting
                    setTimeout(()=>wasDragged = false, 0);
                }
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onUp);
        });
        window.addEventListener('resize', applyTriggerPos);
        document.body.append(trigger);
        applyTriggerPos();
    }
    const backdrop = document.createElement('div'); {
        backdrop.classList.add('stwii--backdrop');
        backdrop.addEventListener('click', (evt)=>{
            if (evt.target === backdrop) closeAll();
        });
        document.body.append(backdrop);
    }
    const panel = document.createElement('div'); {
        panel.classList.add('stwii--panel');
        backdrop.append(panel);
    }
    makeHeader(panel, 'Active World Info');
    const panelBody = document.createElement('div'); {
        panelBody.classList.add('stwii--panelBody');
        panelBody.innerHTML = '?';
        panel.append(panelBody);
    }
    const configPanel = document.createElement('div'); {
        configPanel.classList.add('stwii--panel');
        makeHeader(configPanel, 'Options');
        const rowGroup = document.createElement('label'); {
            rowGroup.classList.add('stwii--configRow');
            rowGroup.title = 'Group entries by World Info book';
            const cb = document.createElement('input'); {
                cb.type = 'checkbox';
                cb.checked = extension_settings.worldInfoInfo?.group ?? true;
                cb.addEventListener('click', ()=>{
                    if (!extension_settings.worldInfoInfo) {
                        extension_settings.worldInfoInfo = {};
                    }
                    extension_settings.worldInfoInfo.group = cb.checked;
                    updatePanel(currentEntryList);
                    saveSettingsDebounced();
                });
                rowGroup.append(cb);
            }
            const lbl = document.createElement('div'); {
                lbl.textContent = 'Group by book';
                rowGroup.append(lbl);
            }
            configPanel.append(rowGroup);
        }
        const orderRow = document.createElement('label'); {
            orderRow.classList.add('stwii--configRow');
            orderRow.title = 'Show in insertion depth / order instead of alphabetically';
            const cb = document.createElement('input'); {
                cb.type = 'checkbox';
                cb.checked = extension_settings.worldInfoInfo?.order ?? true;
                cb.addEventListener('click', ()=>{
                    if (!extension_settings.worldInfoInfo) {
                        extension_settings.worldInfoInfo = {};
                    }
                    extension_settings.worldInfoInfo.order = cb.checked;
                    updatePanel(currentEntryList);
                    saveSettingsDebounced();
                });
                orderRow.append(cb);
            }
            const lbl = document.createElement('div'); {
                lbl.textContent = 'Show in order';
                orderRow.append(lbl);
            }
            configPanel.append(orderRow);
        }
        const mesRow = document.createElement('label'); {
            mesRow.classList.add('stwii--configRow');
            mesRow.title = 'Indicate message history (only when ungrouped and shown in order)';
            const cb = document.createElement('input'); {
                cb.type = 'checkbox';
                cb.checked = extension_settings.worldInfoInfo?.mes ?? true;
                cb.addEventListener('click', ()=>{
                    if (!extension_settings.worldInfoInfo) {
                        extension_settings.worldInfoInfo = {};
                    }
                    extension_settings.worldInfoInfo.mes = cb.checked;
                    updatePanel(currentEntryList);
                    saveSettingsDebounced();
                });
                mesRow.append(cb);
            }
            const lbl = document.createElement('div'); {
                lbl.textContent = 'Show messages';
                mesRow.append(lbl);
            }
            configPanel.append(mesRow);
        }
        backdrop.append(configPanel);
    }

    let entries = [];

    let count = -1;
    const updateBadge = async(newEntries)=>{
        if (count != newEntries.length) {
            if (newEntries.length == 0) {
                trigger.classList.add('stwii--badge-out');
                await delay(510);
                trigger.setAttribute('data-stwii--badge-count', newEntries.length.toString());
                trigger.classList.remove('stwii--badge-out');
            } else if (count == 0) {
                trigger.classList.add('stwii--badge-in');
                trigger.setAttribute('data-stwii--badge-count', newEntries.length.toString());
                await delay(510);
                trigger.classList.remove('stwii--badge-in');
            } else {
                trigger.setAttribute('data-stwii--badge-count', newEntries.length.toString());
                trigger.classList.add('stwii--badge-bounce');
                await delay(1010);
                trigger.classList.remove('stwii--badge-bounce');
            }
            count = newEntries.length;
        } else if (new Set(newEntries).difference(new Set(entries)).size > 0) {
            trigger.classList.add('stwii--badge-bounce');
            await delay(1010);
            trigger.classList.remove('stwii--badge-bounce');
        }
        entries = newEntries;
    };
    let currentEntryList = [];
    let currentChat = [];
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, async(entryList)=>{
        panelBody.innerHTML = 'Updating...';
        updateBadge(entryList.map(it=>`${it.world}§§§${it.uid}`));
        for (const entry of entryList) {
            entry.type = 'wi';
            entry.sticky = parseInt(/**@type {string}*/(await SlashCommandParser.commands['wi-get-timed-effect'].callback(
                {
                    effect: 'sticky',
                    format: 'number',
                    file: `${entry.world}`,
                    _scope: null,
                    _abortController: null,
                },
                entry.uid,
            )));
        }
        for (const entry of entryList) {
            try {
                entry.stwiiReason = analyzeActivation(entry, entryList);
            } catch (ex) {
                console.warn('[STWII] failed to analyze activation reason', ex);
            }
        }
        currentEntryList = [...entryList];
        updatePanel(entryList, true);
    });


    const updatePanel = (entryList, newChat = false)=>{
        const isGrouped = extension_settings.worldInfoInfo?.group ?? true;
        const isOrdered = extension_settings.worldInfoInfo?.order ?? true;
        const isMes = extension_settings.worldInfoInfo?.mes ?? true;
        panelBody.innerHTML = '';
        let grouped;
        if (isGrouped) {
            grouped = Object.groupBy(entryList, (it,idx)=>it.world);
        } else {
            grouped = {
                'WI Entries': [...entryList],
            };
        }
        const depthPos = [world_info_position.ANBottom, world_info_position.ANTop, world_info_position.atDepth];
        for (const [world, entries] of Object.entries(grouped)) {
            for (const e of entries) {
                e.depth = e.position == world_info_position.atDepth ? e.depth : (chat_metadata[metadata_keys.depth] + (e.position == world_info_position.ANTop ? 0.1 : 0));
            }
            const w = document.createElement('div'); {
                w.classList.add('stwii--world');
                w.textContent = world;
                panelBody.append(w);
                entries.sort((a,b)=>{
                    if (isOrdered) {
                        // order by strategy / depth / order
                        if (!depthPos.includes(a.position) && !depthPos.includes(b.position)) return a.position - b.position;
                        if (depthPos.includes(a.position) && !depthPos.includes(b.position)) return 1;
                        if (!depthPos.includes(a.position) && depthPos.includes(b.position)) return -1;
                        if ((a.depth ?? Number.MAX_SAFE_INTEGER) < (b.depth ?? Number.MAX_SAFE_INTEGER)) return 1;
                        if ((a.depth ?? Number.MAX_SAFE_INTEGER) > (b.depth ?? Number.MAX_SAFE_INTEGER)) return -1;
                        if ((a.order ?? Number.MAX_SAFE_INTEGER) > (b.order ?? Number.MAX_SAFE_INTEGER)) return 1;
                        if ((a.order ?? Number.MAX_SAFE_INTEGER) < (b.order ?? Number.MAX_SAFE_INTEGER)) return -1;
                        return (a.comment ?? a.key.join(', ')).toLowerCase().localeCompare((b.comment ?? b.key.join(', ')).toLowerCase());
                    } else {
                        // order alphabetically
                        return (a.comment?.length ? a.comment : a.key.join(', '))
                            .toLowerCase()
                            .localeCompare(b.comment?.length ? b.comment : b.key.join(', '))
                        ;
                    }
                });
                if (!isGrouped && isOrdered && isMes) {
                    const an = chat_metadata[metadata_keys.prompt];
                    const ad = chat_metadata[metadata_keys.depth];
                    if (an?.length) {
                        const idx = entries.findIndex(e=>depthPos.includes(e.position) && e.depth <= ad);
                        entries.splice(idx, 0, {
                            type: 'note',
                            position: world_info_position.ANBottom,
                            depth: ad,
                            text: an,
                        });
                    }
                    if (newChat) {
                        currentChat = [...chat];
                        if (generationType == 'swipe') currentChat.pop();
                    }
                    const segmenter = new Intl.Segmenter('en', { granularity:'sentence' });
                    let currentDepth = currentChat.length - 1;
                    let isDumped = false;
                    for (let i = entries.length - 1; i >= -1; i--) {
                        if (i < 0 && currentDepth < 0) continue;
                        if (isDumped) continue;
                        if ((i < 0 && currentDepth >= 0) || !depthPos.includes(entries[i].position)) {
                            // anything not @D is considered as "before chat"
                            isDumped = true;
                            const depth = -1;
                            const mesList = currentChat.slice(depth + 1, currentDepth + 1);
                            const text = mesList
                                .map(it=>it.mes)
                                .map(it=>it
                                    .replace(/```.+```/gs, '')
                                    .replace(/<[^>]+?>/g, '')
                                    .trim()
                                    ,
                                )
                                .filter(it=>it.length)
                                .join('\n')
                            ;
                            const sentences = [...segmenter.segment(text)].map(it=>it.segment.trim());
                            entries.splice(i + 1, 0, {
                                type: 'mes',
                                count: mesList.length,
                                from: depth + 1,
                                to: currentDepth,
                                first: sentences.at(0),
                                last: sentences.length > 1 ? sentences.at(-1) : null,
                            });
                            currentDepth = -1;
                            continue;
                        }
                        let depth = Math.max(-1, currentChat.length - entries[i].depth - 1);
                        if (depth >= currentDepth) continue;
                        depth = Math.ceil(depth);
                        if (depth == currentDepth) continue;
                        const mesList = currentChat.slice(depth + 1, currentDepth + 1);
                        const text = mesList
                            .map(it=>it.mes)
                            .map(it=>it
                                .replace(/```.+```/gs, '')
                                .replace(/<[^>]+?>/g, '')
                                .trim()
                                ,
                            )
                            .filter(it=>it.length)
                            .join('\n')
                        ;
                        const sentences = [...segmenter.segment(text)].map(it=>it.segment.trim());
                        entries.splice(i + 1, 0, {
                            type: 'mes',
                            count: mesList.length,
                            from: depth + 1,
                            to: currentDepth,
                            first: sentences.at(0),
                            last: sentences.length > 1 ? sentences.at(-1) : null,
                        });
                        currentDepth = depth;
                    }
                }
                for (const entry of entries) {
                    const e = document.createElement('div'); {
                        e.classList.add('stwii--entry');
                        const wipChar = [world_info_position.before, world_info_position.after];
                        const wipEx = [world_info_position.EMTop, world_info_position.EMBottom];
                        // not needed after all?
                        if (false && [...wipChar, ...wipEx].includes(entry.position)) {
                            if (main_api == 'openai') {
                                const pm = promptManager.getPromptCollection().collection;
                                if (wipChar.includes(entry.position) && !pm.find(it=>it.identifier == 'charDescription')) {
                                    e.classList.add('stwii--isBroken');
                                    e.title = '⚠️ Not sent because position anchor is missing (Char Description)!\n';
                                } else if (wipEx.includes(entry.position) && !pm.find(it=>it.identifier == 'dialogueExamples')) {
                                    e.classList.add('stwii--isBroken');
                                    e.title = '⚠️ Not sent because position anchor is missing (Example Messages)!\n';
                                }
                            }
                        } else {
                            e.title = '';
                        }
                        if (entry.type == 'mes') e.classList.add('stwii--messages');
                        if (entry.type == 'note') e.classList.add('stwii--note');
                        const strat = document.createElement('div'); {
                            strat.classList.add('stwii--strategy');
                            if (entry.type == 'wi') {
                                strat.textContent = strategy[getStrategy(entry)];
                            } else if (entry.type == 'mes') {
                                strat.classList.add('fa-solid', 'fa-fw', 'fa-comments');
                                strat.setAttribute('data-stwii--count', entry.count.toString());
                            } else if (entry.type == 'note') {
                                strat.classList.add('fa-solid', 'fa-fw', 'fa-note-sticky');
                            }
                            e.append(strat);
                        }
                        const title = document.createElement('div'); {
                            title.classList.add('stwii--title');
                            if (entry.type == 'wi') {
                                title.textContent = entry.comment?.length ? entry.comment : entry.key.join(', ');
                                const reasonText = describeReason(entry);
                                e.title += `[${entry.world}] ${entry.comment?.length ? entry.comment : entry.key.join(', ')}\n---\n${reasonText.length ? `${reasonText}\n---\n` : ''}${entry.content}`;
                                if (entry.stwiiReason?.matchedKeys?.length) {
                                    const reason = document.createElement('div'); {
                                        reason.classList.add('stwii--reason');
                                        reason.textContent = entry.stwiiReason.matchedKeys.map(k=>k.source == 'chat' ? k.key : `↩${k.key}`).join(', ');
                                        title.append(reason);
                                    }
                                }
                            } else if (entry.type == 'mes') {
                                const first = document.createElement('div'); {
                                    first.classList.add('stwii--first');
                                    first.textContent = entry.first;
                                    title.append(first);
                                }
                                if (entry.last) {
                                    e.title = `Messages #${entry.from}-${entry.to}\n---\n${entry.first}\n...\n${entry.last}`;
                                    const sep = document.createElement('div'); {
                                        sep.classList.add('stwii--sep');
                                        sep.textContent = '...';
                                        title.append(sep);
                                    }
                                    const last = document.createElement('div'); {
                                        last.classList.add('stwii--last');
                                        last.textContent = entry.last;
                                        title.append(last);
                                    }
                                } else {
                                    e.title = `Message #${entry.from}\n---\n${entry.first}`;
                                }
                            } else if (entry.type == 'note') {
                                title.textContent = 'Author\'s Note';
                                e.title = `Author's Note\n---\n${entry.text}`;
                            }
                            e.append(title);
                        }
                        const sticky = document.createElement('div'); {
                            sticky.classList.add('stwii--sticky');
                            sticky.textContent = entry.sticky ? `📌 ${entry.sticky}` : '';
                            sticky.title = `Sticky for ${entry.sticky} more rounds`;
                            e.append(sticky);
                        }
                        panelBody.append(e);
                    }
                }
            }
        }
    };

    //! HACK: no event when no entries are activated, only a debug message
    const original_debug = console.debug;
    console.debug = function(...args) {
        const triggers = [
            '[WI] Found 0 world lore entries. Sorted by strategy',
            '[WI] Adding 0 entries to prompt',
        ];
        if (triggers.includes(args[0])) {
            panelBody.innerHTML = 'No active entries';
            updateBadge([]);
            currentEntryList = [];
        }
        return original_debug.bind(console)(...args);
    };
    const original_log = console.log;
    console.log = function(...args) {
        const triggers = [
            '[WI] Found 0 world lore entries. Sorted by strategy',
            '[WI] Adding 0 entries to prompt',
        ];
        if (triggers.includes(args[0])) {
            panelBody.innerHTML = 'No active entries';
            updateBadge([]);
            currentEntryList = [];
        }
        return original_log.bind(console)(...args);
    };

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({ name: 'wi-triggered',
        callback: (args, value)=>{
            return JSON.stringify(currentEntryList);
        },
        returns: 'list of triggered WI entries',
        helpString: 'Get the list of World Info entries triggered on the last generation.',
    }));
};
init();
initGuide();
