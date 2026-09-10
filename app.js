// app.js - Gesamte Logik, State, KI & Rendering (Mit Bild-Integration für Open Food Facts)

function getGroqApiKey() {
  let key = localStorage.getItem('dino_groq_api_key_v1');
  if (!key || key.trim() === '' || key.startsWith('gsk_...')) {
    key = prompt("Bitte gib deinen Groq API-Key ein (wird sicher und ausschließlich lokal auf deinem Gerät gespeichert):");
    if (key && key.trim() !== '') {
      localStorage.setItem('dino_groq_api_key_v1', key.trim());
    }
  }
  return key ? key.trim() : "";
}

let recognition = null;
let isListening = false;

async function handleSpokenInput(spokenText) {
  if (!spokenText) return;
  const rawInput = spokenText.trim();
  showToast(`Verarbeite Sprachbefehl: "${rawInput}"... 🤖`);

  const apiKey = getGroqApiKey();
  if (!apiKey) {
    processDirectSpeechMatch(rawInput);
    return;
  }

  try {
    const systemPrompt = buildAppContextPrompt();
    const historyMessages = state.chatMessages.slice(-6).map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text
    }));

    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: rawInput }
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: messages,
        temperature: 0.2
      })
    });

    const data = await response.json();

    if (response.ok && data.choices && data.choices[0]?.message?.content) {
      const aiReply = data.choices[0].message.content;
      const regex = /\[ADD_ITEM:\s*(\{.*?\})\]/g;
      let match;
      let addedCount = 0;

      while ((match = regex.exec(aiReply)) !== null) {
        try {
          const itemObj = JSON.parse(match[1]);
          if (itemObj && itemObj.name) {
            const targetLId = itemObj.listId && state.lists.some(l => l.id === itemObj.listId) ? itemObj.listId : state.activeListId;
            const targetList = state.lists.find(l => l.id === targetLId);
            
            addItem({ name: itemObj.name, defaultPrice: itemObj.price }, itemObj.quantity || 1, null, targetLId);
            addedCount++;
            showToast(`✨ ${itemObj.quantity || 1}x "${itemObj.name}" auf ${targetList ? targetList.name : 'Liste'} eingetragen!`);
          }
        } catch (e) {}
      }

      if (addedCount === 0) {
        processDirectSpeechMatch(rawInput);
      }
    } else {
      processDirectSpeechMatch(rawInput);
    }
  } catch (err) {
    processDirectSpeechMatch(rawInput);
  }
}

function processDirectSpeechMatch(spokenText) {
  const parsed = extractNameAndPriceFromSpeech(spokenText);
  const query = (parsed.name || spokenText).trim().toLowerCase();
  
  const catalog = getCatalog();
  const matches = catalog.filter(p => p.name.toLowerCase().includes(query));

  if (matches.length > 1) {
    state.voiceDisambiguationMatches = matches;
    state.showVoiceDisambiguationModal = true;
    soundAdd();
    render();
    showToast(`Mehrere Treffer für "${spokenText}" – bitte auswählen! 🔍`);
    return;
  } else if (matches.length === 1) {
    addItem({ name: matches[0].name, shopUnit: matches[0].shopUnit, defaultPrice: matches[0].defaultPrice, depositAmount: matches[0].depositAmount, aisleNumber: matches[0].aisleNumber, imageUrl: matches[0].imageUrl }, 1, matches[0].shopUnit);
    showToast(`Hinzugefügt: "${matches[0].name}" ✓`);
    return;
  }

  addItem(spokenText, 1);
  showToast(`Hinzugefügt: "${spokenText}" ✓`);
}

function toggleSpeechRecognition(isChatContext = false) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    return showToast('Dein Browser unterstützt leider keine Spracherkennung ❌');
  }

  const micBtn = document.getElementById(isChatContext ? 'chat-mic-btn' : 'mic-btn');

  if (isListening) {
    if (recognition) recognition.stop();
    isListening = false;
    if (micBtn) micBtn.classList.remove('bg-red-600', 'text-white', 'animate-pulse');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'de-DE';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isListening = true;
    if (micBtn) {
      micBtn.classList.add('bg-red-600', 'text-white', 'animate-pulse');
      micBtn.innerHTML = '🎙️ <span class="absolute -top-1 -right-1 flex h-3 w-3"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span><span class="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span></span>';
    }
    
    playTone(587.33, 'sine', 0.08, 0.2);
    setTimeout(() => playTone(880, 'sine', 0.1, 0.2), 90);
    
    showToast('Höre zu... Sprich jetzt! 🎤');
  };

  recognition.onresult = (event) => {
    const spokenText = event.results[0][0].transcript;
    if (spokenText) {
      if (isChatContext) {
        const chatInput = document.getElementById('chat-input');
        if (chatInput) {
          chatInput.value = spokenText;
          sendChatMessage(spokenText);
        }
      } else {
        const text = spokenText.trim();
        const hasActionWord = /(pack|setz|füg|nimm|schreib|hinzufügen|kaufen|brauch|\d+\s*x|\d+\s*flasche|\d+\s*dose)/i.test(text);

        if (hasActionWord) {
          handleSpokenInput(text);
        } else {
          const searchInp = document.getElementById('main-search-input');
          if (searchInp) {
            searchInp.value = text;
            handleSearchInput(text);
            showToast(`Suche nach "${text}"... 🔍`);
          }
        }
      }
    }
  };

  recognition.onerror = () => {
    isListening = false;
    if (micBtn) micBtn.classList.remove('bg-red-600', 'text-white', 'animate-pulse');
  };

  recognition.onend = () => {
    isListening = false;
    if (micBtn) {
      micBtn.classList.remove('bg-red-600', 'text-white', 'animate-pulse');
      micBtn.innerHTML = '🎤';
    }
  };

  try {
    recognition.start();
  } catch (err) {
    isListening = false;
    if (micBtn) micBtn.classList.remove('bg-red-600', 'text-white', 'animate-pulse');
  }
}

function extractNameAndPriceFromSpeech(input) {
  if (!input) return { name: '', price: null };
  let str = input.trim();
  const priceRegex = /(?:(\d+[\.,]\d{2})|(\d+)\s*(?:euro|€)(?:\s*(\d{1,2}))?)/i;
  const match = str.match(priceRegex);
  let extractedPrice = null;

  if (match) {
    if (match[1]) {
      extractedPrice = parseFloat(match[1].replace(',', '.'));
    } else if (match[2]) {
      const euros = match[2];
      const cents = match[3] ? (match[3].length === 1 ? match[3] + '0' : match[3]) : '00';
      extractedPrice = parseFloat(`${euros}.${cents}`);
    }
    str = str.replace(priceRegex, '').replace(/\b(euro|€)\b/gi, '').replace(/\s+/g, ' ').trim();
  }
  return { name: str, price: extractedPrice };
}

function initTheme() {
  try {
    const isDark = state.isDarkMode || false;
    if (isDark) { document.documentElement.classList.add('dark'); } else { document.documentElement.classList.remove('dark'); }
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.innerText = isDark ? '🌙' : '☀️';
  } catch (e) {}
}

function toggleDarkMode() {
  state.isDarkMode = !state.isDarkMode;
  const isDark = state.isDarkMode;
  if (isDark) { document.documentElement.classList.add('dark'); } else { document.documentElement.classList.remove('dark'); }
  saveState();
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.innerText = isDark ? '🌙' : '☀️';
  showToast(isDark ? 'Dark Mode aktiv 🌙' : 'Light Mode aktiv ☀️');
}

let audioCtx = null;
function playTone(freq, type = 'sine', duration = 0.12, gainVal = 0.15) {
  if (!state.soundEnabled) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start(); osc.stop(audioCtx.currentTime + duration);
  } catch (e) {}
}
const soundAdd = () => { playTone(523, 'sine', 0.08, 0.2); setTimeout(() => playTone(659, 'sine', 0.1, 0.2), 70); };
const soundCheck = () => playTone(880, 'triangle', 0.15, 0.25);
const soundUncheck = () => playTone(440, 'sine', 0.1, 0.15);
const soundDelete = () => { playTone(330, 'sawtooth', 0.08, 0.1); setTimeout(() => playTone(220, 'sawtooth', 0.1, 0.1), 60); };
const soundComplete = () => { playTone(523, 'triangle', 0.1, 0.2); setTimeout(() => playTone(659, 'triangle', 0.1, 0.2), 90); setTimeout(() => playTone(784, 'triangle', 0.1, 0.2), 180); setTimeout(() => playTone(1046, 'triangle', 0.25, 0.25), 270); };

function parsePackMultiplier(u) {
  if (!u || typeof u !== 'string') return 1;
  const c = u.toLowerCase().trim(), m1 = c.match(/(\d+)\s*er/), m2 = c.match(/(\d+)\s*x/), m3 = c.match(/(\d+)\s*(?:stk|stück|st\b)/);
  if (m1) return parseInt(m1[1], 10); if (m2) return parseInt(m2[1], 10); if (m3) return parseInt(m3[1], 10);
  return 1;
}

const initialPriceMap = {}, initialDepositMap = {};
PERSONAL_SEED.forEach(r => { initialPriceMap[r[0]] = r[2]; if (r[3] > 0) initialDepositMap[r[0]] = r[3]; });

function cleanDuplicateList(list) {
  if (!list || !Array.isArray(list)) return [];
  const seen = new Set();
  return list.filter(f => {
    const key = (typeof f === 'string' ? f : (f.name || f)).toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

let state = {
  activeTab: 'list',
  soundEnabled: true,
  storeMode: false,
  isDarkMode: false,
  activeListId: 'list-penny',
  lists: [
    { id: 'list-penny', name: 'Penny Markt', icon: '🛒', marketKey: 'penny', isDefault: true },
    { id: 'list-aldi', name: 'Aldi Nord', icon: '⭐', marketKey: 'aldi', isDefault: false },
    { id: 'list-edeka', name: 'Edeka', icon: '🏪', marketKey: 'edeka', isDefault: false },
    { id: 'list-rossmann', name: 'Rossmann', icon: '💄', marketKey: 'rossmann', isDefault: false }
  ],
  customProducts: [],
  deletedMasterIds: [],
  customMarketAisles: {},
  marketOverrides: {},
  favorites: cleanDuplicateList(INITIAL_FAVORITE_NAMES),
  savedPrices: Object.assign({}, initialPriceMap),
  savedDeposits: Object.assign({}, initialDepositMap),
  purchaseHistory: [],
  expandedHistoryIds: [],
  items: [
    { id: 'i-1', listId: 'list-penny', name: 'Yumm yumm', packageUnit: 'Packung', aisleNumber: 6, quantity: 10, isChecked: false, estimatedPrice: 0.49 },
    { id: 'i-2', listId: 'list-penny', name: 'Gouda jung Scheiben', packageUnit: 'Packung', aisleNumber: 7, quantity: 1, isChecked: false, estimatedPrice: 2.99 },
    { id: 'i-3', listId: 'list-penny', name: 'Taschentücher Box', packageUnit: 'Packung', aisleNumber: 12, quantity: 1, isChecked: false, estimatedPrice: 1.85 }
  ],
  pantry: [
    { id: 'p-1', name: 'Toilettenpapier', shopUnit: 'Packung', pantryUnit: 'Packung', totalPieces: 10, minPieces: 2, buyQty: 1, itemsPerPack: 1, dailyConsumption: 0.5, aisleNumber: 12, lastChecked: Date.now() },
    { id: 'p-2', name: 'Emma tabs Somat', shopUnit: 'Packung', pantryUnit: 'Stk.', totalPieces: 45, minPieces: 10, buyQty: 1, itemsPerPack: 41, dailyConsumption: 1, aisleNumber: 12, lastChecked: Date.now() },
    { id: 'p-3', name: 'Lenor Weichspüler', shopUnit: 'Flasche', pantryUnit: 'Flasche', totalPieces: 2, minPieces: 1, buyQty: 1, itemsPerPack: 1, dailyConsumption: 0.1, aisleNumber: 12, lastChecked: Date.now() },
    { id: 'p-4', name: 'Coca-Cola Zero', shopUnit: 'Einzelflasche', pantryUnit: 'Flasche', totalPieces: 6, minPieces: 2, buyQty: 6, itemsPerPack: 1, dailyConsumption: 1.5, aisleNumber: 3, lastChecked: Date.now() },
    { id: 'p-5', name: 'Lucky cat Nassfutter', shopUnit: 'Packung', pantryUnit: 'Stk.', totalPieces: 12, minPieces: 4, buyQty: 1, itemsPerPack: 15, dailyConsumption: 2, aisleNumber: 12, lastChecked: Date.now() },
    { id: 'p-6', name: 'Colgate Zahnpasta', shopUnit: 'Tube', pantryUnit: 'Tube', totalPieces: 2, minPieces: 1, buyQty: 1, itemsPerPack: 1, dailyConsumption: 0.05, aisleNumber: 12, lastChecked: Date.now() },
    { id: 'p-7', name: 'Instant Kaffee', shopUnit: 'Packung', pantryUnit: 'Glas', totalPieces: 1, minPieces: 1, buyQty: 1, itemsPerPack: 1, dailyConsumption: 0.2, aisleNumber: 4, lastChecked: Date.now() }
  ],
  chatMessages: [
    { sender: 'ai', text: 'Moin Dino! 🤖 Ich bin dein persönlicher KI-Assistent. Sag mir einfach, was du brauchst oder frage mich nach Rezepten!' }
  ],
  isChatLoading: false,
  searchQuery: '', isSearchOpen: false,
  showCompleted: true, editingModalItem: null, editingPantryModalItem: null, showWhatsAppModal: false, showNewListModal: false, showNewPantryModal: false,
  showNewAisleModal: false, showFinishModal: false, finishDepositReceipt: 0, autoFillPantryOnFinish: true, newListSelectedIcon: '📋', newListSelectedMarket: 'penny', dbSearchFilter: '',
  pantrySearchQuery: '', pantrySearchDropdownOpen: '',
  lastRemovedItem: null,
  showDuplicateModal: false, duplicateSearchTerm: '',
  showExportModal: false, exportTextContent: '',
  showVoiceDisambiguationModal: false, voiceDisambiguationMatches: [],
  showBarcodeMatchModal: false,
  scannedBarcodeData: null,
  barcodeMatchCandidates: [],
  savedBarcodes: {},
  savedImages: {}
};

async function saveState() {
  try {
    state.favorites = cleanDuplicateList(state.favorites);
    await localforage.setItem('dino_app_state_v125', state);
  } catch (e) {
    console.error('Fehler beim Speichern in IndexedDB:', e);
  }
}

async function loadAppState() {
  try {
    const savedState = await localforage.getItem('dino_app_state_v125');
    if (savedState) {
      state = Object.assign(state, savedState);
      if (!state.savedBarcodes) state.savedBarcodes = {};
      if (!state.savedImages) state.savedImages = {};
    } else {
      try {
        const oldItems = localStorage.getItem('penny_items_v124');
        if (oldItems) {
          state.activeTab = localStorage.getItem('penny_activetab_v124') || state.activeTab;
          state.soundEnabled = JSON.parse(localStorage.getItem('penny_sound_v124') || 'true');
          state.storeMode = JSON.parse(localStorage.getItem('penny_storemode_v124') || 'false');
          state.isDarkMode = JSON.parse(localStorage.getItem('penny_dark_v124') || 'false');
          state.activeListId = localStorage.getItem('penny_list_id_v124') || state.activeListId;
          state.lists = JSON.parse(localStorage.getItem('penny_lists_v124')) || state.lists;
          state.customProducts = JSON.parse(localStorage.getItem('penny_custom_v124')) || state.customProducts;
          state.deletedMasterIds = JSON.parse(localStorage.getItem('penny_deleted_v124')) || state.deletedMasterIds;
          state.customMarketAisles = JSON.parse(localStorage.getItem('penny_custom_aisles_v124')) || state.customMarketAisles;
          state.marketOverrides = JSON.parse(localStorage.getItem('penny_market_overrides_v124')) || state.marketOverrides;
          state.favorites = JSON.parse(localStorage.getItem('penny_favs_v124')) || state.favorites;
          state.savedPrices = JSON.parse(localStorage.getItem('penny_prices_v124')) || state.savedPrices;
          state.savedDeposits = JSON.parse(localStorage.getItem('penny_deposits_v124')) || state.savedDeposits;
          state.purchaseHistory = JSON.parse(localStorage.getItem('penny_history_v124')) || state.purchaseHistory;
          state.items = JSON.parse(oldItems) || state.items;
          state.pantry = JSON.parse(localStorage.getItem('penny_pantry_v124')) || state.pantry;
          state.chatMessages = JSON.parse(localStorage.getItem('penny_chat_messages_v124')) || state.chatMessages;

          await saveState();
          showToast('Daten erfolgreich in IndexedDB migriert! 🚀');
        }
      } catch (migErr) {
        console.error('Fehler bei der Migration vom localStorage:', migErr);
      }
    }
  } catch (e) {
    console.error('Fehler beim Laden aus IndexedDB:', e);
  }
  initTheme();
  runAutomaticPantryConsumption();
}

function getTodayString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function runAutomaticPantryConsumption() {
  const today = getTodayString();
  
  state.pantry.forEach(p => {
    if (!p.lastUpdateDate) {
      p.lastUpdateDate = today;
      p.lastChecked = Date.now();
      return;
    }

    const lastDate = new Date(p.lastUpdateDate);
    const currentDate = new Date(today);
    
    const diffTime = currentDate - lastDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
      if (p.intervallAktiv !== false) {
        const consumed = diffDays * (p.dailyConsumption || 1);
        p.totalPieces = Math.max(0, parseFloat(((p.totalPieces || 0) - consumed).toFixed(2)));
      }
      p.lastUpdateDate = today;
      p.lastChecked = Date.now();
    }
  });
  saveState();
}

function getActiveMarketKey() {
  const l = state.lists.find(x => x.id === state.activeListId);
  return (l && l.marketKey) ? l.marketKey : 'penny';
}

function getActiveAisles() {
  const mk = getActiveMarketKey();
  if (!state.customMarketAisles[mk]) {
    state.customMarketAisles[mk] = JSON.parse(JSON.stringify(MARKET_AISLES[mk] || MARKET_AISLES['penny']));
  }
  return state.customMarketAisles[mk];
}

function getProductAisleForMarket(name, marketKey) {
  const mk = marketKey || getActiveMarketKey();
  const cl = name.toLowerCase().trim();
  if (state.marketOverrides[mk] && state.marketOverrides[mk][cl] !== undefined) {
    return state.marketOverrides[mk][cl];
  }
  const cat = getCatalog();
  const ex = cat.find(p => p.name.toLowerCase().trim() === cl);
  if (ex && ex.aisleNumber !== undefined && ex.aisleNumber !== null) {
    return ex.aisleNumber;
  }
  const catType = getCategoryType(cl);
  return getAisleForMarket(catType, mk);
}

function setProductAisleForMarket(name, aisleNumber, marketKey) {
  const mk = marketKey || getActiveMarketKey();
  const cl = name.toLowerCase().trim();
  if (!state.marketOverrides[mk]) state.marketOverrides[mk] = {};
  state.marketOverrides[mk][cl] = parseInt(aisleNumber, 10);
  saveState();
}

function calculatePantryDaysLeft(item) {
  if (!item.dailyConsumption || item.dailyConsumption <= 0) return null;
  return Math.max(0, Math.floor((item.totalPieces || 0) / (item.dailyConsumption || 1)));
}

const BASE_CATALOG = PERSONAL_SEED.map((r, i) => ({ id: `p-m-${i+1}`, name: r[0], aisleNumber: r[1], defaultPrice: r[2], depositAmount: r[3], shopUnit: r[4] || 'Stk.' }));

function getCatalog() {
  const activeMaster = BASE_CATALOG.filter(p => !state.deletedMasterIds.includes(p.id) && !state.deletedMasterIds.includes(p.name.toLowerCase().trim()));
  const combined = [...activeMaster], seen = new Set(activeMaster.map(p => p.name.toLowerCase().trim()));
  state.customProducts.forEach(cp => {
    const cl = cp.name.toLowerCase().trim();
    if (!state.deletedMasterIds.includes(cp.id) && !state.deletedMasterIds.includes(cl) && !seen.has(cl)) { combined.push(cp); seen.add(cl); }
  });
  return combined;
}

function getCategoryType(name) {
  const l = name.toLowerCase().trim();
  if (/seife|duschgel|shampoo|deo|zahnpasta|tabs|toilettenpapier|weichspüler|reiniger|rasier|kerzen|pants|tücher|waschmittel|spülung|spülmittel|deo-spray/i.test(l)) return 'drugstore';
  if (/hähnchen|brust|sucuk|wurst|fleisch|steak|salami|schinken|frikadelle|würstchen|schnitzel|schweine|pute|hackfleisch|geschnetzeltes|schenkel|filet/i.test(l)) return 'meat';
  if (/apfel|banane|gemüse|salat|tomate|gurke|obst|erdbeeren|zwiebeln|kartoffel|karotte|karotten|möhre|möhren|trauben|kiwi|paprika/i.test(l)) return 'produce';
  if (/brot|brötchen|toast|croissant|backware|kuchen|baguette|ciabatta/i.test(l)) return 'bakery';
  if (/cola|fanta|sprite|wasser|selter|energy|bier|saft|wein|getränk|limo|schorle|mate|sekt|bacardi|rum|wodka|gin|whisky|likör/i.test(l)) return 'drinks';
  if (/käse|milch|joghurt|butter|quark|quark|gouda|sahne|frischkäse|mozzarella|parmesan|kefir/i.test(l)) return 'dairy';
  if (/pizza|fischstäbchen|eis|tiefkühl|tk-|baguette|pommes|spinat|gemüsemischung/i.test(l)) return 'frozen';
  if (/chips|schoki|schokolade|knabber|süß|kekse|gummibärchen|erdnüsse|flips|popcorn|riegel/i.test(l)) return 'snacks';
  if (/katz|hund|tier|fressnapf|streu/i.test(l)) return 'pet';
  if (/nudeln|reis|mehl|zucker|öl|essig|soße|maggi|fix|suppe|konserve|thunfisch|gurken|kaffee|haferflocken|gewürz|pesto|ketchup|mayo|müsli/i.test(l)) return 'dry';
  return 'dry';
}

function getAisleForMarket(categoryType, marketKey) {
  const mk = marketKey || 'penny';
  switch (mk) {
    case 'fressnapf':
      if (categoryType === 'drugstore') return 10;
      if (categoryType === 'pet') return 4;
      return 1;
    case 'rossmann':
      if (categoryType === 'drugstore') return 1;
      return 5;
    case 'penny':
      if (categoryType === 'drugstore') return 12;
      switch (categoryType) {
        case 'produce': return 1;
        case 'snacks': return 2;
        case 'drinks': return 3;
        case 'dry': return 6;
        case 'meat': return 5;
        case 'dairy': return 7;
        case 'bakery': return 10;
        case 'frozen': return 11;
        case 'pet': return 12;
        default: return 6;
      }
    case 'rewe':
      if (categoryType === 'drugstore') return 9;
      switch (categoryType) {
        case 'produce': return 1;
        case 'meat': return 2;
        case 'dairy': return 3;
        case 'bakery': return 4;
        case 'dry': return 5;
        case 'snacks': return 7;
        case 'drinks': return 8;
        case 'drugstore': return 9;
        case 'pet': return 10;
        case 'frozen': return 11;
        default: return 5;
      }
    case 'aldi':
      if (categoryType === 'drugstore') return 8;
      switch (categoryType) {
        case 'produce': return 1;
        case 'bakery': return 2;
        case 'dairy': return 3;
        case 'meat': return 4;
        case 'dry': return 5;
        case 'drinks': return 6;
        case 'snacks': return 7;
        case 'drugstore': return 8;
        case 'frozen': return 9;
        default: return 5;
      }
    case 'lidl':
      if (categoryType === 'drugstore') return 8;
      switch (categoryType) {
        case 'produce': return 1;
        case 'bakery': return 2;
        case 'meat': return 3;
        case 'dairy': return 4;
        case 'dry': return 5;
        case 'snacks': return 6;
        case 'drinks': return 7;
        case 'drugstore': return 8;
        case 'frozen': return 9;
        case 'non-food': return 10;
        default: return 5;
      }
    case 'netto':
      if (categoryType === 'drugstore') return 8;
      switch (categoryType) {
        case 'produce': return 1;
        case 'bakery': return 2;
        case 'dairy': return 3;
        case 'meat': return 4;
        case 'dry': return 5;
        case 'snacks': return 6;
        case 'drinks': return 7;
        case 'drugstore': return 8;
        case 'frozen': return 9;
        default: return 5;
      }
    case 'edeka':
      if (categoryType === 'drugstore') return 7;
      switch (categoryType) {
        case 'produce': return 1;
        case 'bakery': return 2;
        case 'meat': return 3;
        case 'dairy': return 4;
        case 'dry': return 5;
        case 'drinks': return 6;
        case 'drugstore': return 7;
        case 'frozen': return 8;
        default: return 5;
      }
    default:
      if (categoryType === 'drugstore') return 8;
      return 1;
  }
}

function getExactProductInfo(name, marketKey = 'penny') {
  const l = name.toLowerCase().trim();
  const catType = getCategoryType(l);
  const aisle = getProductAisleForMarket(l, marketKey);
  
  const cat = getCatalog();
  const ex = cat.find(p => p.name.toLowerCase().trim() === l);
  if (ex) {
    return {
      aisleNumber: aisle,
      defaultPrice: ex.defaultPrice || 0,
      depositAmount: ex.depositAmount || 0,
      shopUnit: ex.shopUnit || 'Packung',
      imageUrl: ex.imageUrl || ''
    };
  }

  let unit = 'Packung';
  if (/cola|fanta|sprite|wasser|selter|energy|bier|saft|wein|bacardi|rum|wodka|gin|whisky/i.test(l)) unit = 'Flasche';
  else if (/apfel|banane|gemüse|salat|tomate|gurke|obst|karotte|karotten|möhre|möhren/i.test(l)) unit = 'Stk.';

  return { aisleNumber: aisle, defaultPrice: 0, depositAmount: 0, shopUnit: unit, imageUrl: '' };
}

function persistProduct(p, oldName = null) {
  if (!p || !p.name) return null;
  const newName = p.name.trim(); if (!newName) return null;
  const newLower = newName.toLowerCase();
  const oldLower = oldName ? oldName.trim().toLowerCase() : null;

  state.deletedMasterIds = state.deletedMasterIds.filter(x => x !== newLower && x !== oldLower);

  if (oldLower && oldLower !== newLower) {
    const cpMatch = state.customProducts.find(x => x.name.toLowerCase().trim() === oldLower);
    if (cpMatch) { cpMatch.name = newName; }
    
    const bmMatch = BASE_CATALOG.find(x => x.name.toLowerCase().trim() === oldLower);
    if (bmMatch) { bmMatch.name = newName; }

    if (state.savedPrices[oldName]) { state.savedPrices[newName] = state.savedPrices[oldName]; delete state.savedPrices[oldName]; }
    if (state.savedDeposits[oldName]) { state.savedDeposits[newName] = state.savedDeposits[oldName]; delete state.savedDeposits[oldName]; }
    if (state.savedImages && state.savedImages[oldName]) { state.savedImages[newName] = state.savedImages[oldName]; delete state.savedImages[oldName]; }

    state.favorites = cleanDuplicateList(state.favorites.map(f => (String(f).toLowerCase().trim() === oldLower ? newName : f)));

    state.pantry.forEach(pt => {
      if (pt.name.toLowerCase().trim() === oldLower) { pt.name = newName; }
    });
    state.items.forEach(it => {
      if (it.name.toLowerCase().trim() === oldLower) { it.name = newName; }
    });
    state.purchaseHistory.forEach(rec => {
      if (rec.items) {
        rec.items.forEach(rit => {
          if (rit.name.toLowerCase().trim() === oldLower) { rit.name = newName; }
        });
      }
    });
    if (state.marketOverrides) {
      Object.keys(state.marketOverrides).forEach(mk => {
        if (state.marketOverrides[mk] && state.marketOverrides[mk][oldLower] !== undefined) {
          state.marketOverrides[mk][newLower] = state.marketOverrides[mk][oldLower];
          delete state.marketOverrides[mk][oldLower];
        }
      });
    }
  }

  const activeList = state.lists.find(l => l.id === state.activeListId) || state.lists[0];
  const marketKey = activeList.marketKey || 'penny';
  const info = getExactProductInfo(newName, marketKey);

  if (p.aisleNumber !== undefined && p.aisleNumber !== null) {
    setProductAisleForMarket(newName, p.aisleNumber, marketKey);
  }

  if (p.imageUrl) {
    if (!state.savedImages) state.savedImages = {};
    state.savedImages[newName] = p.imageUrl;
  }

  const cat = getCatalog();
  const exist = cat.find(x => x.name.toLowerCase().trim() === newLower);
  if (exist) {
    if (p.shopUnit && p.shopUnit !== 'Stk.') exist.shopUnit = p.shopUnit;
    if (p.defaultPrice !== undefined && p.defaultPrice > 0) exist.defaultPrice = p.defaultPrice;
    if (p.depositAmount !== undefined) exist.depositAmount = p.depositAmount;
    if (p.imageUrl) exist.imageUrl = p.imageUrl;
    else if (state.savedImages && state.savedImages[newName]) exist.imageUrl = state.savedImages[newName];
    
    const pantryMatch = state.pantry.find(px => px.name.toLowerCase().trim() === newLower);
    if (pantryMatch && p.shopUnit) pantryMatch.shopUnit = p.shopUnit;
    
    saveState(); return exist;
  }

  const np = {
    id: `p-c-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`, name: newName,
    aisleNumber: p.aisleNumber !== undefined ? parseInt(p.aisleNumber, 10) : info.aisleNumber,
    defaultPrice: p.defaultPrice !== undefined ? p.defaultPrice : info.defaultPrice,
    depositAmount: p.depositAmount !== undefined ? p.depositAmount : info.depositAmount,
    shopUnit: p.shopUnit || info.shopUnit,
    imageUrl: p.imageUrl || (state.savedImages && state.savedImages[newName]) || info.imageUrl || ''
  };
  state.customProducts.push(np); saveState(); return np;
}

function exportAppDataSafe() {
  const backupData = {
    version: "1.25-indexeddb",
    date: new Date().toISOString(),
    lists: state.lists,
    activeListId: state.activeListId,
    items: state.items,
    pantry: state.pantry,
    favorites: cleanDuplicateList(state.favorites),
    savedPrices: state.savedPrices,
    savedDeposits: state.savedDeposits,
    customProducts: state.customProducts,
    deletedMasterIds: state.deletedMasterIds,
    customMarketAisles: state.customMarketAisles,
    marketOverrides: state.marketOverrides,
    purchaseHistory: state.purchaseHistory,
    savedBarcodes: state.savedBarcodes,
    savedImages: state.savedImages
  };
  state.exportTextContent = JSON.stringify(backupData, null, 2);
  state.showExportModal = true;
  soundAdd();
  render();
}

function importAppDataText() {
  const txtArea = document.getElementById('import-json-textarea');
  if (!txtArea) return;
  const val = txtArea.value.trim();
  if (!val) return showToast('Bitte Backup-Text einfügen');
  try {
    const parsed = JSON.parse(val);
    if (parsed && (parsed.lists || parsed.items)) {
      state.lists = parsed.lists || state.lists;
      state.activeListId = parsed.activeListId || 'list-penny';
      state.items = parsed.items || [];
      state.pantry = parsed.pantry || [];
      state.favorites = cleanDuplicateList(parsed.favorites || INITIAL_FAVORITE_NAMES);
      state.savedPrices = parsed.savedPrices || {};
      state.savedDeposits = parsed.savedDeposits || {};
      state.customProducts = parsed.customProducts || [];
      state.deletedMasterIds = parsed.deletedMasterIds || [];
      state.customMarketAisles = parsed.customMarketAisles || {};
      state.marketOverrides = parsed.marketOverrides || {};
      state.purchaseHistory = parsed.purchaseHistory || [];
      state.savedBarcodes = parsed.savedBarcodes || {};
      state.savedImages = parsed.savedImages || {};
      saveState();
      soundComplete();
      showToast("Backup erfolgreich eingespielt! 🎉");
      render();
    } else {
      showToast("Ungültiges Format ❌");
    }
  } catch (err) {
    showToast("Fehler beim Verarbeiten ❌");
  }
}

function showToast(t) {
  const el = document.getElementById('toast'), tx = document.getElementById('toast-text');
  if (el && tx) { tx.innerText = t; el.classList.remove('hidden'); setTimeout(() => el.classList.add('hidden'), 2500); }
}

function getBaseUnitPrice(n, fb = 0) {
  if (state.savedPrices[n] !== undefined) return state.savedPrices[n];
  const m = getCatalog().find(p => p.name.toLowerCase().trim() === n.toLowerCase().trim());
  return (m && m.defaultPrice !== undefined) ? m.defaultPrice : fb;
}

function getBaseUnitDeposit(n, fb = 0) {
  if (state.savedDeposits[n] !== undefined) return state.savedDeposits[n];
  const m = getCatalog().find(p => p.name.toLowerCase().trim() === n.toLowerCase().trim());
  return (m && m.depositAmount !== undefined) ? m.depositAmount : fb;
}

function getProductImageUrl(n) {
  if (state.savedImages && state.savedImages[n]) return state.savedImages[n];
  const m = getCatalog().find(p => p.name.toLowerCase().trim() === n.toLowerCase().trim());
  return (m && m.imageUrl) ? m.imageUrl : '';
}

function calculateItemPriceInfo(it) {
  const bPrice = getBaseUnitPrice(it.name, it.estimatedPrice || 0);
  let effPrice = bPrice;
  let hasPromoActive = false;
  let promoInfoText = '';

  if (it.promoPrice !== undefined && it.promoPrice !== null && it.promoPrice !== '') {
    effPrice = parseFloat(it.promoPrice);
    hasPromoActive = true;
    promoInfoText = `Aktion: ${effPrice.toFixed(2)}€ (statt ${bPrice.toFixed(2)}€)`;
  } else if (it.promoPercent !== undefined && it.promoPercent !== null && it.promoPercent > 0) {
    effPrice = bPrice * (1 - (it.promoPercent / 100));
    hasPromoActive = true;
    promoInfoText = `-${it.promoPercent}% (statt ${bPrice.toFixed(2)}€)`;
  }

  const u = it.packageUnit || 'Stk.', pm = parsePackMultiplier(u), mult = pm > 1 ? pm : 1;
  const pUnit = mult > 1 ? effPrice * mult : effPrice;
  const sDep = it.depositAmount !== undefined ? it.depositAmount : getBaseUnitDeposit(it.name, 0);
  const dUnit = mult > 1 && sDep > 0 ? sDep * mult : sDep;
  return {
    baseUnitPrice: bPrice, pricePerUnit: pUnit, singleDeposit: sDep, depositPerUnit: dUnit,
    totalItemPrice: pUnit * (it.quantity || 1), totalItemDeposit: dUnit * (it.quantity || 1),
    totalItemBottles: sDep > 0 ? mult * (it.quantity || 1) : 0, isMultipack: mult > 1, hasPromo: hasPromoActive,
    promoText: promoInfoText, originalSinglePrice: bPrice
  };
}

function isFavoriteItem(it) {
  if (!it) return false;
  const cl = (typeof it === 'string' ? it : it.name || '').trim().toLowerCase();
  const p = getCatalog().find(x => x.name.toLowerCase().trim() === cl || x.id === it);
  const tid = p ? p.id : (typeof it === 'string' ? it : it.id), tname = p ? p.name : cl;
  return state.favorites.some(f => {
    const fKey = (typeof f === 'string' ? f : (f.name || f)).toLowerCase().trim();
    return fKey === cl || f === tid || f === tname;
  });
}

function toggleFavorite(idOrName) {
  const cat = getCatalog();
  let prod = cat.find(p => p.id === idOrName || p.name.toLowerCase().trim() === String(idOrName).toLowerCase().trim());
  if (!prod) prod = persistProduct({ name: String(idOrName).trim() });
  const lname = prod ? prod.name : idOrName;
  const lNameLower = String(lname).toLowerCase().trim();

  const alreadyExists = state.favorites.some(f => {
    const fKey = (typeof f === 'string' ? f : (f.name || f)).toLowerCase().trim();
    return fKey === lNameLower;
  });

  if (alreadyExists) {
    state.favorites = cleanDuplicateList(state.favorites.filter(x => {
      const xKey = (typeof x === 'string' ? x : (x.name || x)).toLowerCase().trim();
      return xKey !== lNameLower;
    }));
    soundDelete(); 
    showToast(`"${lname}" aus Favoriten entfernt`);
  } else {
    state.favorites = cleanDuplicateList(state.favorites.filter(x => {
      const xKey = (typeof x === 'string' ? x : (x.name || x)).toLowerCase().trim();
      return xKey !== lNameLower;
    }));
    state.favorites.push(lname);
    state.favorites = cleanDuplicateList(state.favorites);
    soundAdd(); 
    showToast(`"${lname}" als Favorit gespeichert ★`);
  }

  saveState(); 
  render();
}

function addItem(prod, qty = 1, customUnit = null, targetListId = null) {
  const rawInput = typeof prod === 'string' ? prod : (prod.name || '');
  const parsed = extractNameAndPriceFromSpeech(rawInput);
  
  const cl = parsed.name || rawInput.trim();
  if (!cl) return;

  const detectedPrice = parsed.price !== null ? parsed.price : (prod.defaultPrice !== undefined && prod.defaultPrice !== null ? prod.defaultPrice : null);
  const detectedImage = prod.imageUrl || (typeof prod === 'object' ? prod.imageUrl : null);

  const pantryObj = state.pantry.find(p => p.name.toLowerCase().trim() === cl.toLowerCase());
  
  const targetLId = targetListId || state.activeListId;
  const curList = state.lists.find(l => l.id === targetLId) || state.lists[0];
  const marketKey = curList.marketKey || 'penny';
  const exactInfo = getExactProductInfo(cl, marketKey);

  const defaultShopUnit = pantryObj ? (pantryObj.shopUnit || 'Packung') : (prod.shopUnit || exactInfo.shopUnit);
  const finalUnit = customUnit || defaultShopUnit;

  const resolvedAisle = (prod.aisleNumber !== undefined && prod.aisleNumber !== null) ? prod.aisleNumber : getProductAisleForMarket(cl, marketKey);
  const imgUrlToUse = detectedImage || getProductImageUrl(cl) || exactInfo.imageUrl;
  
  const sp = persistProduct({ ...prod, name: cl, shopUnit: finalUnit, aisleNumber: resolvedAisle, imageUrl: imgUrlToUse });
  
  const curItems = state.items.filter(i => (i.listId || 'list-penny') === targetLId);
  const existingListItem = curItems.find(i => i.name.toLowerCase().trim() === cl.toLowerCase());
  
  const finalPrice = detectedPrice !== null ? detectedPrice : getBaseUnitPrice(cl, (sp ? sp.defaultPrice : 0) || exactInfo.defaultPrice);
  const dep = prod.depositAmount !== undefined ? prod.depositAmount : getBaseUnitDeposit(cl, (sp ? sp.depositAmount : null) || exactInfo.depositAmount);

  if (finalPrice > 0) {
    state.savedPrices[cl] = finalPrice;
    if (sp) sp.defaultPrice = finalPrice;
  }
  if (dep >= 0) {
    state.savedDeposits[cl] = dep;
  }
  if (imgUrlToUse) {
    if (!state.savedImages) state.savedImages = {};
    state.savedImages[cl] = imgUrlToUse;
  }

  if (existingListItem) {
    existingListItem.quantity += qty; 
    existingListItem.isChecked = false;
    existingListItem.aisleNumber = resolvedAisle;
    if (detectedPrice !== null) {
      existingListItem.estimatedPrice = detectedPrice;
    } else if (finalPrice > 0) {
      existingListItem.estimatedPrice = finalPrice;
    }
    if (customUnit) existingListItem.packageUnit = customUnit;
    if (imgUrlToUse) existingListItem.imageUrl = imgUrlToUse;
    showToast(`"${cl}" auf ${curList.name} aktualisiert ✓`);
  } else {
    state.items.unshift({
      id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      listId: targetLId, 
      name: cl, 
      packageUnit: finalUnit,
      aisleNumber: resolvedAisle, 
      quantity: Math.max(1, qty), 
      isChecked: false, 
      estimatedPrice: finalPrice > 0 ? finalPrice : (sp ? sp.defaultPrice : 0), 
      depositAmount: dep, 
      promoPrice: null, 
      promoPercent: null,
      imageUrl: imgUrlToUse || ''
    });
    showToast(`"${cl}" zu ${curList.name} hinzugefügt ✓`);
  }

  soundAdd(); state.searchQuery = ''; state.isSearchOpen = false;
  saveState(); render();
}

function addAllFavoritesToList() {
  const db = getCatalog();
  if (!state.favorites || state.favorites.length === 0) {
    return showToast('Keine Favoriten vorhanden');
  }
  
  state.favorites.forEach(fav => {
    let fName = '';
    let fUnit = 'Packung';
    let fImg = '';
    
    if (typeof fav === 'string') {
      fName = fav;
      const foundProd = db.find(p => p.id === fav || p.name.toLowerCase().trim() === fav.toLowerCase().trim());
      if (foundProd) {
        fName = foundProd.name;
        fUnit = foundProd.shopUnit || 'Packung';
        fImg = foundProd.imageUrl || '';
      }
    } else if (fav && typeof fav === 'object') {
      fName = fav.name || '';
      fUnit = fav.shopUnit || 'Packung';
      fImg = fav.imageUrl || '';
    }

    if (fName) {
      addItem({ name: fName, shopUnit: fUnit, imageUrl: fImg }, 1, fUnit);
    }
  });

  soundAdd();
  showToast('Alle Favoriten zur Liste hinzugefügt! ★');
  render();
}

function toggleItemChecked(id) {
  const item = state.items.find(i => i.id === id);
  if (item) { item.isChecked = !item.isChecked; if (item.isChecked) soundCheck(); else soundUncheck(); saveState(); render(); }
}
function updateItemQty(id, d) {
  const item = state.items.find(i => i.id === id);
  if (item) { item.quantity = Math.max(1, item.quantity + d); if (d > 0) soundAdd(); else soundDelete(); saveState(); render(); }
}

function removeItem(id) {
  const item = state.items.find(i => i.id === id);
  if (item) {
    state.lastRemovedItem = JSON.parse(JSON.stringify(item));
  }
  state.items = state.items.filter(i => i.id !== id);
  soundDelete(); 
  showToast(`"${item ? item.name : 'Artikel'}" entfernt 🗑`); 
  saveState(); 
  render();
}

function openNewListModal() { 
  state.showNewListModal = true; 
  state.newListSelectedIcon = '📋'; 
  state.newListSelectedMarket = 'penny'; 
  render(); 
}
function closeNewListModal() { state.showNewListModal = false; render(); }
function selectListEmoji(emoji) { state.newListSelectedIcon = emoji; const p = document.getElementById('new-list-icon-preview'); if (p) p.innerText = emoji; render(); }
function selectListMarket(mk) { 
  state.newListSelectedMarket = mk; 
  const customSection = document.getElementById('custom-aisles-input-section');
  if (customSection) {
    if (mk === 'custom') customSection.classList.remove('hidden');
    else customSection.classList.add('hidden');
  }
}

function createNewList() {
  const inp = document.getElementById('new-list-name'); if (!inp) return;
  const n = inp.value.trim(); if (!n) return showToast('Bitte Namen eingeben');
  const mkSel = state.newListSelectedMarket || 'penny';
  const listId = 'list-' + Date.now();
  
  let finalMarketKey = mkSel;
  if (mkSel === 'custom') {
    finalMarketKey = 'custom-' + Date.now();
    const customTextarea = document.getElementById('new-list-custom-aisles');
    const rawLines = customTextarea ? customTextarea.value.trim() : '';
    let aislesArr = [];
    if (rawLines) {
      const lines = rawLines.split('\n');
      lines.forEach((l, idx) => {
        const trimmed = l.trim();
        if (trimmed) {
          aislesArr.push({ id: 'ca-' + idx + '-' + Date.now(), number: idx + 1, name: trimmed, orderIndex: idx + 1 });
        }
      });
    }
    if (aislesArr.length === 0) {
      aislesArr = [
        { id: 'ca-1-' + Date.now(), number: 1, name: '1. Allgemeine Waren', orderIndex: 1 },
        { id: 'ca-2-' + Date.now(), number: 2, name: '2. Kasse / Ausgang', orderIndex: 2 }
      ];
    }
    state.customMarketAisles[finalMarketKey] = aislesArr;
  } else {
    state.customMarketAisles[finalMarketKey] = JSON.parse(JSON.stringify(MARKET_AISLES[mkSel] || MARKET_AISLES['penny']));
  }

  const nl = { id: listId, name: n, icon: state.newListSelectedIcon || '📋', marketKey: finalMarketKey, isDefault: false };
  state.lists.push(nl); 
  state.activeListId = nl.id; 
  state.showNewListModal = false;
  soundAdd(); saveState(); showToast(`Liste "${n}" angelegt`); render();
}

function deleteShoppingList(lid, lnm) {
  if (lid === 'list-penny') return showToast('Hauptliste kann nicht gelöscht werden');
  if (confirm(`Liste "${lnm}" löschen?`)) {
    state.lists = state.lists.filter(l => l.id !== lid);
    state.items = state.items.filter(i => i.listId !== lid);
    state.activeListId = 'list-penny'; soundDelete(); saveState(); showToast(`Liste gelöscht`); render();
  }
}
function removePantryItem(id) { state.pantry = state.pantry.filter(p => p.id !== id); soundDelete(); saveState(); showToast(`Aus Vorrat gelöscht`); render(); }

function updatePantryPieces(id, delta) {
  const p = state.pantry.find(x => x.id === id);
  if (p) {
    const step = p.pantryUnit === 'ml' ? 50 : 1;
    const oldPieces = p.totalPieces || 0;
    p.totalPieces = Math.max(0, parseFloat((oldPieces + (delta * step)).toFixed(2)));
    
    if (delta < 0) {
      soundDelete();
      const newDaysLeft = calculatePantryDaysLeft(p);
      if (newDaysLeft !== null && newDaysLeft <= 2) {
        showToast(`⚠️ Achtung! "${p.name}" reicht nur noch ca. ${newDaysLeft} Tage!`);
        setTimeout(() => {
          if (confirm(`"${p.name}" wird bald leer sein (${newDaysLeft} Tage übrig). Direkt auf die Einkaufsliste setzen?`)) {
            addItem({ name: p.name, shopUnit: p.shopUnit || 'Packung', aisleNumber: p.aisleNumber || 12 }, p.buyQty || 1, p.shopUnit || 'Packung');
          }
        }, 300);
      } else {
        showToast(`Vorrat aktualisiert: ${p.totalPieces} ${p.pantryUnit || 'Stk.'} übrig.`);
      }
    } else {
      soundAdd();
      showToast(`Vorrat aufgefüllt: ${p.totalPieces} ${p.pantryUnit || 'Stk.'}`);
    }
    
    p.lastChecked = Date.now();
    p.lastUpdateDate = getTodayString();
    saveState(); 
    render();
  }
}

function addMissingPantryToShopping() {
  const miss = state.pantry.filter(p => {
    const daysLeft = calculatePantryDaysLeft(p);
    return (p.totalPieces || 0) < (p.minPieces || 1) || (daysLeft !== null && daysLeft <= 2);
  });
  if (miss.length === 0) return showToast('Alles im Vorrat ausreichend gefüllt!');
  miss.forEach(p => {
    const unitToBuy = p.shopUnit || (p.pantryUnit === 'ml' ? 'Flasche' : (p.pantryUnit || 'Packung'));
    const addQty = p.buyQty || 1;
    addItem({ name: p.name, shopUnit: unitToBuy, aisleNumber: p.aisleNumber || 12 }, addQty, unitToBuy);
  });
  soundAdd(); showToast(`${miss.length} Vorräte auf Liste gesetzt`); render();
}

function handlePantrySearchInput(v) {
  state.pantrySearchQuery = v;
  state.pantrySearchDropdownOpen = v.trim().length > 0;
  const dd = document.getElementById('pantry-search-dropdown');
  if (!dd) return;
  if (!v.trim()) { dd.innerHTML = ''; dd.classList.add('hidden'); return; }
  const q = v.toLowerCase().trim();
  const res = getCatalog().filter(p => p.name.toLowerCase().includes(q)).slice(0, 6);
  
  let htmlContent = '';
  if (res.length > 0) {
    htmlContent += res.map(p => `
      <div onclick="selectPantryCatalogItem('${p.name.replace(/'/g, "\\'")} ', '${p.shopUnit||'Flasche'}', ${getProductAisleForMarket(p.name, 'penny')})" class="p-3 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer border-b border-stone-100 dark:border-stone-800 last:border-0 text-xs flex justify-between items-center">
        <span class="font-bold text-stone-900 dark:text-stone-100 leading-snug break-words">${p.name}</span>
        <span class="text-[10px] bg-red-500/10 text-red-600 dark:text-red-400 px-2 py-0.5 rounded font-bold shrink-0 ml-2">Kauf: ${p.shopUnit||'Flasche'} ↗</span>
      </div>
    `).join('');
  }
  
  const exactInfo = getExactProductInfo(v, 'penny');
  htmlContent += `
    <div onclick="selectPantryCatalogItem('${v.replace(/'/g, "\\'")} ', '${exactInfo.shopUnit}', ${exactInfo.aisleNumber})" class="p-3 bg-red-500/10 hover:bg-red-500/20 cursor-pointer text-xs font-bold text-red-600 dark:text-red-400 flex justify-between items-center border-t border-stone-200 dark:border-stone-800">
      <span class="leading-snug break-words">✨ "${v}" neu anlegen</span>
      <span class="shrink-0 ml-2">Gang ${exactInfo.aisleNumber}</span>
    </div>
  `;

  dd.innerHTML = htmlContent;
  dd.classList.remove('hidden');
}

function selectPantryCatalogItem(name, shopUnit, aisle) {
  const nameInp = document.getElementById('new-pantry-name');
  const shopUnitSel = document.getElementById('new-pantry-shopunit');
  const aisleSel = document.getElementById('new-pantry-aisle');
  if (nameInp) nameInp.value = name;
  if (shopUnitSel) shopUnitSel.value = shopUnit;
  if (aisleSel) aisleSel.value = aisle;
  state.pantrySearchQuery = name;
  state.pantrySearchDropdownOpen = false;
  const dd = document.getElementById('pantry-search-dropdown');
  if (dd) dd.classList.add('hidden');
}

function saveNewPantryItem() {
  const nameInp = document.getElementById('new-pantry-name');
  const shopUnitSel = document.getElementById('new-pantry-shopunit');
  const pantryUnitSel = document.getElementById('new-pantry-pantryunit');
  const piecesInp = document.getElementById('new-pantry-pieces');
  const minInp = document.getElementById('new-pantry-min');
  const buyQtyInp = document.getElementById('new-pantry-buyqty');
  const perPackInp = document.getElementById('new-pantry-perpack');
  const dailyInp = document.getElementById('new-pantry-daily');
  const intervallInp = document.getElementById('new-pantry-intervall');
  const aisleSel = document.getElementById('new-pantry-aisle');

  const n = nameInp ? nameInp.value.trim() : ''; if (!n) return;
  
  const dbProd = getCatalog().find(p => p.name.toLowerCase().trim() === n.toLowerCase().trim());
  const exactInfo = getExactProductInfo(n, 'penny');
  const shopUnit = shopUnitSel ? shopUnitSel.value.trim() : (dbProd ? dbProd.shopUnit : exactInfo.shopUnit);
  const pantryUnit = pantryUnitSel ? pantryUnitSel.value.trim() : 'Stk.';
  
  const pieces = piecesInp ? parseFloat(piecesInp.value) || 10 : 10;
  const min = minInp ? parseFloat(minInp.value) || 2 : 2;
  const buyQty = buyQtyInp ? parseInt(buyQtyInp.value, 10) || 1 : 1;
  const itemsPerPack = perPackInp ? parseInt(perPackInp.value, 10) || 1 : 1;
  const daily = dailyInp ? parseFloat(dailyInp.value) || 0.5 : 0.5;
  const a = aisleSel ? parseInt(aisleSel.value, 10) || getProductAisleForMarket(n, 'penny') : getProductAisleForMarket(n, 'penny');

  persistProduct({ name: n, aisleNumber: a, shopUnit: shopUnit });

  state.pantry.unshift({ 
    id: 'pantry-' + Date.now(), name: n, shopUnit: shopUnit, pantryUnit: pantryUnit, 
    totalPieces: pieces, minPieces: min, buyQty: buyQty, itemsPerPack: itemsPerPack, dailyConsumption: daily, 
    intervallAktiv: intervallInp ? intervallInp.checked : true,
    aisleNumber: a, lastChecked: Date.now(), lastUpdateDate: getTodayString()
  });
  state.showNewPantryModal = false; state.pantrySearchQuery = ''; soundAdd(); saveState(); showToast(`Vorrat "${n}" gespeichert`); render();
}

function openNewAisleModal() { state.showNewAisleModal = true; render(); }
function createNewAisle() {
  const numInp = document.getElementById('new-aisle-num'), nameInp = document.getElementById('new-aisle-name');
  if (!nameInp) return;
  const name = nameInp.value.trim(), num = parseInt(numInp ? numInp.value : (getActiveAisles().length + 1), 10) || (getActiveAisles().length + 1);
  if (!name) return showToast('Bitte Gang-Namen angeben');
  
  const activeAisles = getActiveAisles();
  activeAisles.push({ id: 'a-' + Date.now(), number: num, name: `Gang ${num}: ${name}`, orderIndex: activeAisles.length + 1 });
  const mk = getActiveMarketKey();
  state.customMarketAisles[mk] = activeAisles;
  
  state.showNewAisleModal = false; soundAdd(); saveState(); showToast(`Gang ${num} angelegt`); render();
}

function deleteAisle(aisleId) {
  const mk = getActiveMarketKey();
  let activeAisles = getActiveAisles();
  if (activeAisles.length <= 1) return showToast('Mindestens ein Gang muss erhalten bleiben!');
  if (confirm('Diesen Gang wirklich löschen?')) {
    state.customMarketAisles[mk] = activeAisles.filter(a => a.id !== aisleId);
    soundDelete(); saveState(); showToast('Gang gelöscht'); render();
  }
}

function toggleHistoryItem(recId) {
  if (state.expandedHistoryIds.includes(recId)) {
    state.expandedHistoryIds = state.expandedHistoryIds.filter(id => id !== recId);
  } else {
    state.expandedHistoryIds.push(recId);
  }
  render();
}

function openFinishShoppingModal() { state.showFinishModal = true; state.finishDepositReceipt = 0; render(); }
function confirmFinishShopping() {
  const curList = state.lists.find(l => l.id === state.activeListId) || state.lists[0];
  const curItems = state.items.filter(i => (i.listId || 'list-penny') === state.activeListId);
  const compItems = curItems.filter(i => i.isChecked);
  if (compItems.length === 0) return showToast('Keine erledigten Artikel vorhanden');

  let subtotal = 0, depTotal = 0;
  const purchasedItemsSnapshot = compItems.map(i => {
    const inf = calculateItemPriceInfo(i);
    subtotal += inf.totalItemPrice;
    depTotal += inf.totalItemDeposit;
    return { 
      name: i.name, 
      quantity: i.quantity, 
      packageUnit: i.packageUnit || 'Packung', 
      totalPrice: inf.totalItemPrice, 
      totalDeposit: inf.totalItemDeposit,
      hasPromo: inf.hasPromo,
      promoText: inf.promoText,
      originalSinglePrice: inf.originalSinglePrice
    };
  });

  const receipt = parseFloat(state.finishDepositReceipt) || 0;
  const finalToPay = Math.max(0, (subtotal + depTotal) - receipt);

  state.purchaseHistory.unshift({
    id: 'rec-' + Date.now(), date: new Date().toISOString(), listName: curList.name,
    itemCount: compItems.length, subtotal: subtotal, depositTotal: depTotal, depositReceipt: receipt, finalTotal: finalToPay,
    items: purchasedItemsSnapshot
  });

  let pantryUpdated = 0;
  const todayStr = getTodayString();

  compItems.forEach(ci => {
    const matchP = state.pantry.find(p => p.name.toLowerCase().trim() === ci.name.toLowerCase().trim());
    if (matchP) {
      const perPack = matchP.itemsPerPack || parsePackMultiplier(ci.packageUnit || matchP.shopUnit || 'Packung') || 1;
      const totalUnitsToAdd = perPack * (ci.quantity || 1);
      
      matchP.totalPieces = parseFloat(((matchP.totalPieces || 0) + totalUnitsToAdd).toFixed(2));
      matchP.lastChecked = Date.now();
      matchP.lastUpdateDate = todayStr;
      pantryUpdated++;
    }
  });

  if (pantryUpdated > 0) {
    showToast(`${pantryUpdated} Vorräte aufgefüllt! 🥫`);
  }

  state.items = state.items.filter(i => !((i.listId || 'list-penny') === state.activeListId && i.isChecked));
  state.showFinishModal = false; saveState(); soundComplete();
  render();
}

function handleSearchInput(v) {
  state.searchQuery = v; state.isSearchOpen = v.trim().length > 0;
  const cb = document.getElementById('search-clear-btn');
  if (cb) { if (v.trim()) cb.classList.remove('hidden'); else cb.classList.add('hidden'); }
  updateSearchDropdown();
  if (v.trim().length > 0) {
    const wrap = document.getElementById('search-wrapper-container');
    if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function updateSearchDropdown() {
  const dd = document.getElementById('search-dropdown-container'); if (!dd) return;
  if (!state.searchQuery.trim() || !state.isSearchOpen) { dd.innerHTML = ''; dd.classList.add('hidden'); return; }
  
  const parsed = extractNameAndPriceFromSpeech(state.searchQuery);
  const searchItemName = parsed.name || state.searchQuery.trim();
  const q = searchItemName.toLowerCase();
  
  const catalog = getCatalog();
  const res = catalog.filter(p => p.name.toLowerCase().includes(q)).slice(0, 10);
  
  let htmlContent = '';

  const curList = state.lists.find(l => l.id === state.activeListId) || state.lists[0];
  const mk = curList.marketKey || 'penny';
  const exactInfo = getExactProductInfo(searchItemName, mk);
  
  const priceText = parsed.price !== null ? ` (${parsed.price.toFixed(2)} €)` : '';

  htmlContent += `
    <div onclick="
      const rawName = '${state.searchQuery.replace(/'/g, "\\'")}';
      addItem(rawName, 1, '${exactInfo.shopUnit}');
      render();
    " class="p-3 bg-red-500/10 hover:bg-red-500/20 cursor-pointer text-xs font-bold text-red-600 dark:text-red-400 flex justify-between items-center border-b border-stone-200/60 dark:border-stone-800/80">
      <span class="leading-snug break-words">✨ Als neuen Artikel hinzufügen: "${searchItemName}"${priceText}</span>
      <span class="shrink-0 ml-2">Gang ${exactInfo.aisleNumber} ↗</span>
    </div>
  `;

  if (res.length > 0) {
    htmlContent += res.map(p => renderDropdownItem(p, mk)).join('');
  }

  dd.innerHTML = htmlContent;
  dd.classList.add('hidden');
}

function renderDropdownItem(p, marketKey) {
  const isFav = isFavoriteItem(p.name) || isFavoriteItem(p.id), aNum = getProductAisleForMarket(p.name, marketKey);
  const aisles = getActiveAisles();
  const aDef = aisles.find(a => parseInt(a.number, 10) === aNum), pPrice = getBaseUnitPrice(p.name, p.defaultPrice || 0), pDep = getBaseUnitDeposit(p.name, p.depositAmount || 0);
  const defaultShopUnit = p.shopUnit || 'Packung';
  const pImg = getProductImageUrl(p.name) || p.imageUrl;
  
  return `
    <div class="p-2.5 hover:bg-stone-50 dark:hover:bg-stone-800/60 flex items-center justify-between gap-2 border-b border-stone-100 dark:border-stone-800/80 last:border-0 text-xs">
      <div class="flex items-center gap-2.5 min-w-0 flex-1">
        ${pImg ? `<img src="${pImg}" class="w-8 h-8 object-cover rounded-xl shrink-0 border border-stone-200 dark:border-stone-700 shadow-xs" />` : '<div class="w-8 h-8 rounded-xl bg-stone-100 dark:bg-stone-800 flex items-center justify-center text-xs shrink-0 border border-stone-200 dark:border-stone-700">🛒</div>'}
        <div class="min-w-0 flex-1 pr-1">
          <span class="font-bold text-stone-900 dark:text-stone-100 leading-snug break-words block">${p.name}</span>
          <span class="text-[10px] text-stone-500 block truncate">${aDef ? aDef.name : `Gang ${aNum}`} • ${pPrice.toFixed(2)}€</span>
        </div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0" onclick="event.stopPropagation();">
        <select id="vpe-in-${p.id}" class="bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-lg px-1.5 py-1 text-[10px] font-semibold">
          ${COMMON_UNITS.map(u => `<option value="${u}" ${u===defaultShopUnit?'selected':''}>${u}</option>`).join('')}
        </select>
        <button onclick="event.stopPropagation(); toggleFavorite('${p.name.replace(/'/g, "\\'")}');" class="p-1 text-sm ${isFav?'text-amber-400 font-black':'text-stone-300 dark:text-stone-600'}">${isFav?'★':'☆'}</button>
        <button onclick="event.stopPropagation(); const cu=document.getElementById('vpe-in-${p.id}').value; persistProduct({ name: '${p.name.replace(/'/g, "\\'")}', shopUnit: cu, aisleNumber: ${aNum}, imageUrl: '${pImg}' }); addItem({ name: '${p.name.replace(/'/g, "\\'")}', shopUnit: cu, defaultPrice: ${pPrice}, depositAmount: ${pDep}, aisleNumber: ${aNum}, imageUrl: '${pImg}' }, 1, cu); render();" class="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-xl shadow-xs">+ Liste</button>
      </div>
    </div>
  `;
}

function buildAppContextPrompt() {
  const curList = state.lists.find(l => l.id === state.activeListId) || state.lists[0];
  const activeListItems = state.items.filter(i => (i.listId || 'list-penny') === state.activeListId);
  const openItems = activeListItems.map(i => `- ${i.quantity}x ${i.name} (${i.packageUnit||'Packung'})`).join('\n');
  const favoritesList = cleanDuplicateList(state.favorites).map(f => (typeof f === 'string' ? f : f.name)).join(', ');
  
  const pantrySummary = state.pantry.map(p => {
    const daysLeft = calculatePantryDaysLeft(p);
    const status = (p.totalPieces || 0) < (p.minPieces || 1) || (daysLeft !== null && daysLeft <= 2) ? '🚨 KRITISCH / FAST LEER' : '✅ Ausreichend';
    return `- ${p.name}: ${p.totalPieces} ${p.pantryUnit || 'Stk.'} übrig (Min: ${p.minPieces}, Status: ${status})`;
  }).join('\n');

  const allListsInfo = state.lists.map(l => `- Markt/Liste: "${l.name}" (ID: "${l.id}")`).join('\n');
  
  const dbCatalog = getCatalog();
  const catalogSummary = dbCatalog.slice(0, 150).map(p => p.name).join(', ');

  return `Du bist Dinos persönlicher Alltags-, Koch- und Einkaufs-Assistent für Schwarzenbek. 
Du hast vollständigen Einblick in Dinos echte Einkaufslisten, Favoriten, den **Vorratsschrank** und die Produktdatenbank:

VERFÜGBARE MÄRKTE / LISTEN:
[
${allListsInfo}
]

AKTIVE LISTE: "${curList.name}" (ID: "${curList.id}")

OFFENE EINKAUFSLISTE DER AKTIVEN LISTE:
[
${openItems || 'Die Einkaufsliste ist aktuell leer.'}
]

FAVORITEN: [ ${favoritesList} ]

VORRATSSCHRANK (AKTUELLER BESTAND & WARNUNGEN):
[
${pantrySummary || 'Der Vorratsschrank ist leer.'}
]

AUSGEWÄHLTE PRODUKTDATENBANK (WICHTIG FÜR EXAKTE NAMEN!):
[ ${catalogSummary} ]

STRIKTE REGELN FÜR DIE ARTIKEL-ERKENNUNG:
1. **Datenbank-Abgleich (WICHTIG):** Wenn Dino nach einem umgangssprachlichen Begriff wie "Energy", "Cola", "Kaffee" oder "Chips" fragt, suche IMMER in der Produktdatenbank nach dem passenden, bereits existierenden vollständigen Namen (z.B. "Energy Papa groß", "Coca-Cola Zero", "Instant Kaffee"). Erstelle **niemals** ein neues, generisches Produkt, wenn ein treffender Artikel in der Produktdatenbank existiert! Verwende im [ADD_ITEM]-Befehl exakt den Namen aus der Datenbank.
2. Wenn Dino verlangt, einen Artikel auf eine *bestimmte* Liste zu setzen (z. B. "Setze Milch auf die Aldi-Liste"), musst du im JSON the korrekte "listId" der jeweiligen Liste mitangeben!
3. Wenn Dino nach Rezepten fragt, prüfe, welche Zutaten fehlen und frage: "Für das Rezept fehlen dir noch folgende Artikel auf deiner Einkaufsliste: [Zutaten]. Soll ich die fehlenden Artikel direkt auf deine Einkaufsliste setzen?"
4. BEFEHL: Wenn Dino in seiner letzten Antwort "Ja", "Bitte", "Mach", "Gerne" oder ähnlich zustimmt, musst du für JEDE fehlende Zutat sofort diesen Befehl ausgeben:
[ADD_ITEM: {"name": "Exakter Datenbank-Name", "quantity": 1, "listId": "${curList.id}"}]`;
}

async function sendChatMessage(presetText = null) {
  const inputEl = document.getElementById('chat-input');
  const text = presetText || (inputEl ? inputEl.value.trim() : '');
  if (!text || state.isChatLoading) return;

  if (inputEl) inputEl.value = '';

  state.chatMessages.push({ sender: 'user', text: text });
  state.isChatLoading = true;
  soundAdd();
  saveState();
  render();

  const apiKey = getGroqApiKey();
  if (!apiKey) {
    setTimeout(() => {
      state.chatMessages.push({ sender: 'ai', text: '⚠️ Bitte gib deinen API-Key ein, um den KI-Chat zu nutzen.' });
      state.isChatLoading = false;
      saveState();
      render();
    }, 500);
    return;
  }

  try {
    const systemPrompt = buildAppContextPrompt();
    const historyMessages = state.chatMessages.map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text
    }));

    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: messages,
        temperature: 0.5
      })
    });

    const data = await response.json();

    if (response.ok && data.choices && data.choices[0]?.message?.content) {
      let aiReply = data.choices[0].message.content;

      const regex = /\[ADD_ITEM:\s*(\{.*?\})\]/g;
      let match;
      let itemsAddedCount = 0;

      while ((match = regex.exec(aiReply)) !== null) {
        try {
          const itemObj = JSON.parse(match[1]);
          if (itemObj && itemObj.name) {
            const prodData = {
              name: itemObj.name,
              defaultPrice: itemObj.price !== undefined ? parseFloat(itemObj.price) : undefined
            };
            const targetLId = itemObj.listId && state.lists.some(l => l.id === itemObj.listId) ? itemObj.listId : state.activeListId;
            addItem(prodData, itemObj.quantity || 1, null, targetLId);
            itemsAddedCount++;
          }
        } catch (e) {}
      }

      aiReply = aiReply.replace(regex, '').trim();
      if (itemsAddedCount > 0) {
        aiReply += `\n\n✨ (${itemsAddedCount} Artikel erkannt und direkt auf die entsprechende Einkaufsliste gesetzt! 🛒)`;
      }

      state.chatMessages.push({ sender: 'ai', text: aiReply });
    } else {
      const errDetail = data.error?.message || JSON.stringify(data);
      state.chatMessages.push({ sender: 'ai', text: `⚠️ API-Fehler (${response.status}): ${errDetail}` });
    }

  } catch (err) {
    state.chatMessages.push({ sender: 'ai', text: 'Verbindungsfehler: ' + err.message });
  } finally {
    state.isChatLoading = false;
    saveState();
    render();
    
    const chatBox = document.getElementById('chat-messages-container');
    if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
  }
}

function render() {
  try {
    const app = document.getElementById('app');
    if (!app) return;
    const curList = state.lists.find(l => l.id === state.activeListId) || state.lists[0];
    const marketKey = curList.marketKey || 'penny';
    const activeAisles = getActiveAisles();
    
    const hIcon = document.getElementById('header-market-icon');
    const hTitle = document.getElementById('header-market-title');
    const hBadge = document.getElementById('header-market-badge');
    const hAisleCount = document.getElementById('header-aisle-count');
    const storeModeBtn = document.getElementById('store-mode-toggle-btn');
    
    if(hIcon) hIcon.innerText = curList.icon || '🛒';
    if(hTitle) hTitle.innerText = curList.name;
    if(hBadge) hBadge.innerText = curList.name.toUpperCase();
    if(hAisleCount) hAisleCount.innerText = `${activeAisles.length} Gänge aktiv`;
    if(storeModeBtn) {
      if(state.storeMode) {
        storeModeBtn.className = 'px-3 h-9 rounded-xl bg-red-600 text-white border border-red-500 backdrop-blur-sm flex items-center justify-center text-xs font-extrabold shadow-md gap-1.5 animate-pulse';
        const smText = document.getElementById('store-mode-text');
        if(smText) smText.innerText = 'Einkaufs-Modus AN 🛍️';
      } else {
        storeModeBtn.className = 'px-2.5 h-9 rounded-xl bg-white/80 dark:bg-stone-800/80 border border-stone-200/80 dark:border-stone-700/60 backdrop-blur-sm flex items-center justify-center text-xs font-bold text-stone-700 dark:text-stone-300 shadow-xs gap-1';
        const smText = document.getElementById('store-mode-text');
        if(smText) smText.innerText = 'Modus';
      }
    }

    initTheme();

    ['list', 'pantry', 'favorites', 'chat', 'menu'].forEach(tab => {
      const btn = document.getElementById('nav-btn-' + tab);
      if(btn) {
        if(state.activeTab === tab) {
          btn.className = 'flex flex-col items-center justify-center py-1.5 rounded-2xl transition-all text-red-600 dark:text-red-400 bg-red-500/10 font-bold relative shadow-xs';
        } else {
          btn.className = 'flex flex-col items-center justify-center py-1.5 rounded-2xl transition-all text-stone-400 hover:text-stone-700 dark:hover:text-stone-300 relative';
        }
      }
    });

    const curItems = state.items.filter(i => (i.listId || 'list-penny') === state.activeListId);
    const openItems = curItems.filter(i => !i.isChecked), compItems = curItems.filter(i => i.isChecked);
    
    const lowPantryCount = state.pantry.filter(p => {
      const daysLeft = calculatePantryDaysLeft(p);
      return (p.totalPieces || 0) < (p.minPieces || 1) || (daysLeft !== null && daysLeft <= 2);
    }).length;

    const pantryBtn = document.getElementById('nav-btn-pantry');
    let navBadge = document.getElementById('nav-pantry-badge');
    if (pantryBtn && navBadge) {
      if (navBadge.parentElement !== pantryBtn) { pantryBtn.appendChild(navBadge); }
      if (lowPantryCount > 0) { navBadge.classList.remove('hidden'); } else { navBadge.classList.add('hidden'); }
    }

    let subtotal = 0, depTotal = 0, depCount = 0;
    curItems.forEach(i => { const inf = calculateItemPriceInfo(i); subtotal += inf.totalItemPrice; depTotal += inf.totalItemDeposit; depCount += inf.totalItemBottles; });

    const sortedAisles = [...activeAisles].sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0));
    const aMap = new Map(); sortedAisles.forEach(a => aMap.set(parseInt(a.number, 10), a.orderIndex));
    
    const grp = {}; 
    openItems.forEach(i => { 
      const a = getProductAisleForMarket(i.name, marketKey);
      i.aisleNumber = a;
      if (!grp[a]) grp[a] = []; 
      grp[a].push(i); 
    });
    const aKeys = Object.keys(grp).map(Number).sort((a, b) => (aMap.get(a) || a) - (aMap.get(b) || b));
    
    const catalogDb = getCatalog();
    
    const usageCounts = {};
    state.purchaseHistory.forEach(rec => {
      if (rec.items) {
        rec.items.forEach(rit => {
          const k = rit.name.toLowerCase().trim();
          usageCounts[k] = (usageCounts[k] || 0) + (rit.quantity || 1);
        });
      }
    });
    state.items.forEach(it => {
      const k = it.name.toLowerCase().trim();
      usageCounts[k] = (usageCounts[k] || 0) + (it.quantity || 1);
    });

    const seenFavKeys = new Set();
    const favs = cleanDuplicateList(state.favorites).map(f => {
      if (typeof f === 'string') {
        return catalogDb.find(p => p.id === f || p.name.toLowerCase().trim() === f.toLowerCase().trim()) || { name: f, shopUnit: 'Packung', defaultPrice: 0, depositAmount: 0, aisleNumber: 6 };
      }
      return f;
    }).filter(Boolean).filter(fav => {
      const k = (fav.name || '').toLowerCase().trim();
      if (seenFavKeys.has(k)) return false;
      seenFavKeys.add(k);
      return true;
    }).sort((a, b) => {
      const countA = usageCounts[(a.name || '').toLowerCase().trim()] || 0;
      const countB = usageCounts[(b.name || '').toLowerCase().trim()] || 0;
      return countB - countA;
    });

    let html = '';

    if (state.activeTab === 'chat') {
      html += `
        <div class="space-y-3">
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl p-3.5 shadow-xs flex justify-between items-center">
            <div>
              <h2 class="text-sm font-extrabold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                <span>🤖</span> GPT-OSS KI-Assistent & Rezept-Bot
              </h2>
              <p class="text-[11px] text-stone-500 font-medium">Frage nach Rezepten oder sage direkt: „Setze Milch auf die Aldi-Liste!“</p>
            </div>
            <button onclick="if(confirm('Chat-Verlauf löschen?')){ state.chatMessages=[]; saveState(); render(); }" class="text-xs font-bold text-red-600 bg-red-50 dark:bg-red-950/40 px-2.5 py-1.5 rounded-xl border border-red-200">Verlauf leeren</button>
          </div>

          <div class="flex gap-1.5 overflow-x-auto custom-scrollbar pb-1">
            <button onclick="sendChatMessage('Was soll ich heute kochen? Mach mir einen Rezept-Vorschlag.')" class="bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-800 dark:text-stone-200 text-[11px] font-bold px-3.5 py-1.5 rounded-xl shrink-0 shadow-xs hover:border-red-500">🍲 Rezept-Vorschlag</button>
            <button onclick="sendChatMessage('Rezept für Spaghetti Bolognese')" class="bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-800 dark:text-stone-200 text-[11px] font-bold px-3.5 py-1.5 rounded-xl shrink-0 shadow-xs hover:border-red-500">🍝 Rezept Spaghetti Bolognese</button>
          </div>

          <div id="chat-messages-container" class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl p-4 shadow-xs space-y-3 min-h-[300px] max-h-[50vh] overflow-y-auto custom-scrollbar">
            ${state.chatMessages.map(m => `
              <div class="flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}">
                <div class="max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed ${
                  m.sender === 'user' 
                    ? 'bg-red-600 text-white font-medium rounded-br-none shadow-xs' 
                    : 'bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100 rounded-bl-none border border-stone-200 dark:border-stone-700 shadow-xs whitespace-pre-wrap'
                }">
                  ${m.text}
                </div>
              </div>
            `).join('')}
            ${state.isChatLoading ? `
              <div class="flex justify-start">
                <div class="bg-stone-100 dark:bg-stone-800 text-stone-500 rounded-2xl rounded-bl-none p-3 text-xs font-bold border border-stone-200 dark:border-stone-700 flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full bg-red-600 animate-ping"></span> GPT denkt nach...
                </div>
              </div>
            ` : ''}
          </div>

          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl p-2 shadow-xs flex gap-2">
            <input 
              type="text" 
              id="chat-input" 
              placeholder="z.B. 'Setze Milch auf die Aldi-Liste'..." 
              onkeydown="if(event.key==='Enter') sendChatMessage();"
              class="flex-1 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-2xl px-3.5 py-2.5 text-xs font-medium focus:outline-none focus:border-red-600"
            />
            <button 
              id="chat-mic-btn"
              onclick="toggleSpeechRecognition(true)" 
              class="bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300 px-3 py-2.5 rounded-2xl shrink-0 shadow-xs flex items-center justify-center text-sm transition-all" 
              title="Nachricht einsprechen">
              🎤
            </button>
            <button 
              onclick="sendChatMessage();" 
              class="bg-red-600 hover:bg-red-700 text-white font-extrabold px-4 py-2.5 rounded-2xl text-xs shadow-xs shrink-0 flex items-center gap-1">
              <span>Senden</span> ↗
            </button>
          </div>
        </div>
      `;
    }

    else if (state.activeTab === 'menu') {
      html += `
        <div class="bg-white/95 dark:bg-[#1a1a1a]/95 backdrop-blur-2xl border border-stone-200 dark:border-stone-800 rounded-3xl p-4 shadow-2xl space-y-3">
          <div class="flex justify-between items-center pb-2 border-b border-stone-200 dark:border-stone-800">
            <div class="flex items-center gap-2">
              <span class="text-base">☰</span>
              <h2 class="text-xs sm:text-sm font-extrabold text-stone-900 dark:text-stone-100">Menü & Zusatzfunktionen</h2>
            </div>
          </div>
          
          <div class="grid grid-cols-2 gap-2">
            <button onclick="state.activeTab='recipes'; saveState(); render();" class="p-3 rounded-2xl bg-white/70 dark:bg-stone-800/60 hover:bg-red-500/10 border border-stone-200 dark:border-stone-700 flex items-center gap-2.5 text-left shadow-xs transition-all backdrop-blur-md">
              <span class="text-base w-8 h-8 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center shrink-0">🍲</span>
              <div>
                <span class="font-bold text-xs text-stone-900 dark:text-stone-100 block">Rezepte</span>
                <span class="text-[10px] text-stone-500 block">Chefkoch Suche</span>
              </div>
            </button>

            <button onclick="state.activeTab='more-prospects'; saveState(); render();" class="p-3 rounded-2xl bg-white/70 dark:bg-stone-800/60 hover:bg-red-500/10 border border-stone-200 dark:border-stone-700 flex items-center gap-2.5 text-left shadow-xs transition-all backdrop-blur-md">
              <span class="text-base w-8 h-8 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">📰</span>
              <div>
                <span class="font-bold text-xs text-stone-900 dark:text-stone-100 block">Prospekte</span>
                <span class="text-[10px] text-stone-500 block">Schwarzenbek</span>
              </div>
            </button>

            <button onclick="state.activeTab='more-history'; saveState(); render();" class="p-3 rounded-2xl bg-white/70 dark:bg-stone-800/60 hover:bg-red-500/10 border border-stone-200 dark:border-stone-700 flex items-center gap-2.5 text-left shadow-xs transition-all backdrop-blur-md">
              <span class="text-base w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">📊</span>
              <div>
                <span class="font-bold text-xs text-stone-900 dark:text-stone-100 block">Historie</span>
                <span class="text-[10px] text-stone-500 block">Kassenbons</span>
              </div>
            </button>

            <button onclick="state.activeTab='more-aisles'; saveState(); render();" class="p-3 rounded-2xl bg-white/70 dark:bg-stone-800/60 hover:bg-red-500/10 border border-stone-200 dark:border-stone-700 flex items-center gap-2.5 text-left shadow-xs transition-all backdrop-blur-md">
              <span class="text-base w-8 h-8 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center shrink-0">🗺️</span>
              <div>
                <span class="font-bold text-xs text-stone-900 dark:text-stone-100 block">Gänge</span>
                <span class="text-[10px] text-stone-500 block">Markt-Laufwege</span>
              </div>
            </button>

            <button onclick="state.activeTab='more-db'; saveState(); render();" class="p-3 rounded-2xl bg-white/70 dark:bg-stone-800/60 hover:bg-red-500/10 border border-stone-200 dark:border-stone-700 flex items-center gap-2.5 text-left shadow-xs transition-all backdrop-blur-md col-span-2">
              <span class="text-base w-8 h-8 rounded-xl bg-stone-500/10 text-stone-500 flex items-center justify-center shrink-0">🗄️</span>
              <div>
                <span class="font-bold text-xs text-stone-900 dark:text-stone-100 block">Datenbank</span>
                <span class="text-[10px] text-stone-500 block">Artikel verwalten, Duplikate bereinigen</span>
              </div>
            </button>

            <div class="col-span-2 pt-2 border-t border-stone-200 dark:border-stone-800 grid grid-cols-2 gap-2">
              <button onclick="exportAppDataSafe()" class="p-3 rounded-2xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-300 dark:border-emerald-900/40 flex items-center gap-2 text-left shadow-xs transition-all">
                <span class="text-base">💾</span>
                <div>
                  <span class="font-bold text-xs text-emerald-800 dark:text-emerald-300 block">Backup anzeigen</span>
                  <span class="text-[9px] text-stone-500 block">Sicherer Text-Export</span>
                </div>
              </button>
              <button onclick="state.showExportModal=true; state.exportTextContent=''; render();" class="p-3 rounded-2xl bg-blue-500/10 hover:bg-blue-500/20 border border-blue-300 dark:border-blue-900/40 flex items-center gap-2 text-left shadow-xs transition-all">
                <span class="text-base">📂</span>
                <div>
                  <span class="font-bold text-xs text-blue-800 dark:text-blue-300 block">Backup einspielen</span>
                  <span class="text-[9px] text-stone-500 block">Code einfügen</span>
                </div>
              </button>
            </div>

            <div class="col-span-2 pt-2">
              <button onclick="const newKey = prompt('Gib deinen neuen Groq API-Key ein:', localStorage.getItem('dino_groq_api_key_v1') || ''); if(newKey !== null) { localStorage.setItem('dino_groq_api_key_v1', newKey.trim()); showToast('API-Key aktualisiert! 🔑'); }" class="w-full p-3 rounded-2xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-300 dark:border-amber-900/40 flex items-center justify-center gap-2 text-center shadow-xs transition-all text-xs font-bold text-amber-800 dark:text-amber-300">
                <span>🔑 API-Key verwalten / ändern</span>
              </button>
            </div>
          </div>
        </div>
      `;
    } else if (state.activeTab === 'list') {
      const isStore = state.storeMode;
      const itemTextSz = isStore ? 'text-lg sm:text-xl font-extrabold' : 'text-sm font-extrabold';
      const itemBoxPad = isStore ? 'p-4 sm:p-5' : 'p-3.5';
      const itemBg = isStore ? 'bg-red-50/40 dark:bg-stone-900/80 border-2 border-red-500/40 my-1.5 rounded-2xl' : '';

      html += `
        <div class="space-y-3">
          <div class="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1">
            ${state.lists.map(l => `
              <div class="inline-flex items-center rounded-2xl shrink-0 transition-all ${state.activeListId===l.id?'bg-red-600 text-white shadow-xs font-bold':'bg-white dark:bg-[#1a1a1a] text-stone-700 dark:text-stone-200 border border-stone-200 dark:border-stone-800'}">
                <button onclick="state.activeListId='${l.id}'; saveState(); render();" class="px-3 py-2 text-xs font-extrabold flex items-center gap-1.5">
                  <span>${l.icon||'🛒'}</span><span>${l.name}</span>
                  <span class="text-[9px] ${state.activeListId===l.id?'bg-white/20 text-white':'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300'} px-1.5 py-0.2 rounded-full">${state.items.filter(i=>(i.listId||'list-penny')===l.id).length}</span>
                </button>
                ${l.id!=='list-penny'?`<button onclick="deleteShoppingList('${l.id}','${l.name}')" class="pr-2.5 text-stone-400 hover:text-white text-xs">✕</button>`:''}
              </div>
            `).join('')}
            <button onclick="openNewListModal();" class="px-3 py-2 rounded-2xl text-xs font-bold text-stone-700 dark:text-stone-300 bg-white dark:bg-[#1a1a1a] border border-dashed border-stone-300 dark:border-stone-700 shrink-0 shadow-xs">+ Markt</button>
          </div>

          ${lowPantryCount > 0 ? `
            <div class="bg-white dark:bg-red-950/30 border-2 border-red-600 p-3 rounded-3xl flex items-center justify-between text-xs pantry-red-blink shadow-sm cursor-pointer" onclick="state.activeTab='pantry'; saveState(); render();">
              <div class="flex items-center gap-2">
                <span class="text-base">🚨</span>
                <div>
                  <span class="font-extrabold text-red-700 dark:text-red-300 text-xs block">
                    Vorrat warnt: ${lowPantryCount} Artikel knapp/leer!
                  </span>
                  <span class="text-[10px] text-red-600 dark:text-red-400 font-medium block">Tippe hier, um Schrank zu öffnen</span>
                </div>
              </div>
              <button onclick="event.stopPropagation(); addMissingPantryToShopping();" class="bg-red-600 hover:bg-red-700 text-white font-extrabold px-3 py-1.5 rounded-xl text-[11px] shadow-xs">
                + Auf Liste
              </button>
            </div>
          ` : ''}

          <div id="search-wrapper-container" class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl p-3 shadow-xs relative z-30 space-y-2">
            <div class="flex gap-2">
              <div class="relative flex-1">
                <input
                  type="text"
                  id="main-search-input"
                  value="${state.searchQuery}"
                  oninput="handleSearchInput(this.value)"
                  onkeydown="if(event.key==='Enter'){ const n=this.value.trim(); if(n){ addItem(n, 1); render(); } }"
                  placeholder="Artikel suchen oder einsprechen..."
                  class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-2xl pl-3.5 pr-10 py-2.5 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-red-600 font-medium"
                />
                <button onclick="document.getElementById('main-search-input').value=''; handleSearchInput(''); document.getElementById('main-search-input').focus();" class="absolute right-3 top-3 text-stone-400 font-bold text-xs ${state.searchQuery?'':'hidden'}" id="search-clear-btn">✕</button>
              </div>
              <button id="mic-btn" onclick="toggleSpeechRecognition(false)" class="bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300 px-3 py-2.5 rounded-2xl shrink-0 shadow-xs flex items-center justify-center text-sm transition-all" title="Sprachsteuerung starten">
                🎤
              </button>
              <button onclick="openBarcodeScannerModal();" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2.5 rounded-2xl shrink-0 shadow-xs flex items-center justify-center text-sm transition-all" title="Barcode scannen">
                📷
              </button>
              <button onclick="const n=document.getElementById('main-search-input').value.trim(); if(n){ addItem(n, 1); render(); }" class="bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold px-3.5 py-2.5 rounded-2xl shrink-0 shadow-xs">+ Hinzufügen</button>
            </div>
            <div id="search-dropdown-container" class="hidden absolute left-3 right-3 top-full mt-2 bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl shadow-xl overflow-hidden z-40 max-h-60 overflow-y-auto custom-scrollbar"></div>
          </div>

          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl p-3.5 shadow-xs space-y-2.5">
            <div class="flex justify-between items-center">
              <div class="flex items-center gap-2">
                <h2 class="text-xs sm:text-sm font-extrabold text-stone-900 dark:text-stone-100">Übersicht</h2>
                <span class="bg-red-600 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full shadow-xs">${openItems.length} offen</span>
              </div>
              <div class="flex items-center gap-1.5">
                ${compItems.length > 0 ? `
                  <button onclick="openFinishShoppingModal();" class="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold px-3 py-1.5 rounded-xl shadow-xs transition-colors flex items-center gap-1">
                    <span>✓ Kassenbon</span>
                    <span class="bg-emerald-800/60 px-1.5 py-0.2 rounded-full text-[9px]">${compItems.length}</span>
                  </button>
                ` : ''}
                <button onclick="state.showWhatsAppModal=true; render();" class="bg-[#25D366] text-white text-xs font-bold px-2.5 py-1.5 rounded-xl shadow-xs">💬 WA</button>
              </div>
            </div>
            ${curItems.length>0?`
              <div class="grid grid-cols-3 gap-1.5 pt-2 border-t border-stone-100 dark:border-stone-800 text-center">
                <div class="bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-2xl py-1.5 shadow-xs"><span class="text-[9px] text-stone-500 uppercase font-extrabold block">Warenwert</span><span class="text-xs font-bold text-stone-900 dark:text-stone-200">${subtotal.toFixed(2)} €</span></div>
                <div class="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-2xl py-1.5 shadow-xs"><span class="text-[9px] text-emerald-700 dark:text-emerald-400 uppercase font-extrabold block">Pfand (${depCount} Fl.)</span><span class="text-xs font-bold text-emerald-800 dark:text-emerald-300">+${depTotal.toFixed(2)} €</span></div>
                <div class="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40 rounded-2xl py-1.5 shadow-xs"><span class="text-[9px] text-red-600 dark:text-red-400 uppercase font-extrabold block">Gesamt</span><span class="text-xs font-black text-red-600 dark:text-red-400">${(subtotal+depTotal).toFixed(2)} €</span></div>
              </div>
            `:''}
          </div>

          ${curItems.length === 0 ? `
            <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl p-8 text-center text-stone-500 space-y-1.5 shadow-xs">
              <span class="text-2xl">🛒</span>
              <p class="text-xs font-bold">Deine Einkaufsliste ist leer.</p>
            </div>
          ` : ''}

          ${aKeys.map(aNum => {
            const aItems = grp[aNum] || [], aDef = activeAisles.find(a => parseInt(a.number, 10) === aNum);
            return `
              <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl overflow-hidden shadow-xs">
                <div class="bg-stone-50 dark:bg-stone-800/50 px-3.5 py-3 border-b border-stone-100 dark:border-stone-800 flex items-center justify-between text-xs font-extrabold text-stone-800 dark:text-stone-200">
                  <div class="flex items-center gap-2.5 pr-2 min-w-0">
                    <span class="w-6 h-6 rounded-xl bg-red-600 text-white text-xs flex items-center justify-center font-black shadow-xs shrink-0">${aNum}</span>
                    <span class="text-stone-900 dark:text-stone-100 text-sm leading-snug break-words">${aDef ? aDef.name : `Gang ${aNum}`}</span>
                  </div>
                  <span class="text-[11px] bg-stone-200/60 dark:bg-stone-700/60 px-2.5 py-0.5 rounded-full text-stone-700 dark:text-stone-300 font-bold shrink-0 ml-2">${aItems.length} offen</span>
                </div>
                <div class="divide-y divide-stone-100 dark:divide-stone-800">
                  ${aItems.map(item => {
                    const inf = calculateItemPriceInfo(item), isFav = isFavoriteItem(item.name) || isFavoriteItem(item.id);
                    const itemImg = item.imageUrl || getProductImageUrl(item.name);
                    return `
                      <div class="${itemBoxPad} flex items-center justify-between gap-3 hover:bg-stone-50/50 dark:hover:bg-stone-800/35 transition-colors ${itemBg}" onclick="toggleItemChecked('${item.id}')" title="Antippen zum Abhaken">
                        <div class="flex items-center gap-3.5 flex-1 min-w-0">
${itemImg && itemImg.trim() !== '' ? `<img src="${itemImg}" class="w-10 h-10 object-cover rounded-2xl shrink-0 border border-stone-200 dark:border-stone-700 shadow-xs" onerror="this.style.display='none'" />` : '<div class="w-10 h-10 rounded-2xl bg-stone-100 dark:bg-stone-800 flex items-center justify-center text-sm shrink-0 border border-stone-200 dark:border-stone-700 shadow-xs">🛒</div>'}
                          <div class="min-w-0 flex-1 py-0.5">
                            <div class="flex items-center gap-2.5 flex-wrap">
                              <button onclick="event.stopPropagation(); toggleFavorite('${item.name.replace(/'/g, "\\'")}');" class="text-base ${isFav ? 'text-amber-400 font-black' : 'text-stone-300 dark:text-stone-600 hover:text-amber-400'} transition-colors" title="${isFav ? 'Aus Favoriten entfernen' : 'Als Favorit speichern'}">${isFav ? '★' : '☆'}</button>
                              <span class="${itemTextSz} text-stone-900 dark:text-stone-100 hover:text-red-600 text-left leading-snug break-words">${item.name}</span>
                              ${inf.hasPromo?'<span class="text-[10px] bg-red-600 text-white px-2 py-0.5 rounded-full font-extrabold shadow-xs">⚡ ANGEBOT</span>':''}
                            </div>
                            <div class="flex items-center gap-2 mt-2 text-xs flex-wrap text-stone-500 dark:text-stone-400" onclick="event.stopPropagation();">
                              <button onclick="openEditItemModal('${item.id}')" class="bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 px-2.5 py-1 rounded-xl font-bold border border-stone-200 dark:border-stone-700 hover:text-red-600">📦 ${item.packageUnit||'Packung'} ✎</button>
                              <button onclick="openEditItemModal('${item.id}')" class="bg-stone-100 dark:bg-stone-800 font-bold px-2.5 py-1 rounded-xl text-stone-700 dark:text-stone-300 hover:text-red-600">${inf.pricePerUnit>0?`${inf.pricePerUnit.toFixed(2)} €`:'0.00 €'} ✎</button>
                              <span class="text-stone-400">•</span>
                              <button onclick="openEditItemModal('${item.id}')" class="hover:text-red-600 font-semibold">Gang ${item.aisleNumber || 6} ✎</button>
                            </div>
                          </div>
                        </div>
                        <div class="flex items-center gap-2.5 shrink-0" onclick="event.stopPropagation();">
                          <div class="flex items-center bg-stone-100 dark:bg-stone-800 rounded-2xl p-1 border border-stone-200 dark:border-stone-700 shadow-xs">
                            <button onclick="updateItemQty('${item.id}', -1)" class="w-9 h-9 bg-white dark:bg-stone-700 text-stone-800 dark:text-stone-200 rounded-xl font-bold text-base shadow-xs flex items-center justify-center">-</button>
                            <span class="px-3.5 text-base font-extrabold min-w-[2rem] text-center">${item.quantity}</span>
                            <button onclick="updateItemQty('${item.id}', 1)" class="w-9 h-9 bg-white dark:bg-stone-700 text-stone-800 dark:text-stone-200 rounded-xl font-bold text-base shadow-xs flex items-center justify-center">+</button>
                          </div>
                          <button onclick="removeItem('${item.id}')" class="w-9 h-9 bg-red-50 dark:bg-red-950/40 text-red-600 rounded-xl flex items-center justify-center text-sm border border-red-200 shadow-xs">🗑</button>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `;
          }).join('')}

          ${compItems.length > 0 ? `
            <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl overflow-hidden shadow-xs mt-3">
              <div class="bg-stone-50 dark:bg-stone-800/50 px-3.5 py-3 flex items-center justify-between text-xs font-extrabold text-stone-700 dark:text-stone-300 border-b border-stone-100 dark:border-stone-800">
                <button onclick="state.showCompleted=!state.showCompleted; render();" class="flex items-center gap-1.5 text-sm"><span>${state.showCompleted?'▼':'▶'}</span><span>Erledigt (${compItems.length})</span></button>
                <button onclick="state.items=state.items.filter(i=>!((i.listId||'list-penny')===state.activeListId && i.isChecked)); saveState(); render();" class="text-xs text-red-600 font-extrabold">Leeren 🗑</button>
              </div>
              ${state.showCompleted ? `<div class="divide-y divide-stone-100 dark:divide-stone-800">${compItems.map(item => `
                <div class="p-3.5 flex items-center justify-between gap-2 opacity-60 bg-stone-50/50 dark:bg-stone-900/30 cursor-pointer" onclick="toggleItemChecked('${item.id}')">
                  <div class="flex items-center gap-2.5 min-w-0 flex-1">
                    <span class="text-xs sm:text-sm line-through text-stone-500 dark:text-stone-400 font-medium leading-snug break-words flex-1">${item.name} (${item.quantity}x ${item.packageUnit||'Packung'})</span>
                  </div>
                  <div class="flex items-center gap-2 shrink-0" onclick="event.stopPropagation();">
                    <button onclick="toggleItemChecked('${item.id}')" class="px-2.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 rounded-xl text-xs font-bold border border-amber-300 shadow-xs" title="Wieder nach oben holen">↩️ Zurück</button>
                    <button onclick="removeItem('${item.id}')" class="text-stone-400 hover:text-red-600 text-sm p-1">🗑</button>
                  </div>
                </div>
              `).join('')}</div>` : ''}
            </div>
          ` : ''}
        </div>
      `;
    }

    else if (state.activeTab === 'pantry') {
      const pantryAisles = MARKET_AISLES['penny'];

      html += `
        <div class="space-y-3">
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl p-3.5 shadow-xs space-y-2.5">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
              <div>
                <h2 class="text-sm font-extrabold text-stone-900 dark:text-stone-100">Vorratsschrank</h2>
                <p class="text-[11px] text-stone-500 font-medium">Fester Verbrauch pro Tag 🤖</p>
              </div>
              <div class="flex gap-1.5">
                <button onclick="addMissingPantryToShopping();" class="bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold px-3 py-2 rounded-xl shadow-xs">+ Fehlendes auf Liste</button>
                <button onclick="state.showNewPantryModal=true; render();" class="bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-extrabold px-3 py-2 rounded-xl shadow-xs">+ Neu</button>
              </div>
            </div>
            ${lowPantryCount > 0 ? `
              <div class="bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 p-3 rounded-2xl flex items-center justify-between text-xs pantry-red-blink">
                <span class="font-extrabold text-red-700 dark:text-red-300 text-[11px] flex items-center gap-1.5">
                  <span class="w-2 h-2 rounded-full bg-red-600 animate-ping"></span>
                  🚨 ${lowPantryCount} Vorräte kritisch / fast leer!
                </span>
                <button onclick="addMissingPantryToShopping();" class="bg-red-600 text-white font-extrabold px-2.5 py-1 rounded-xl text-[11px] shadow-xs">Auf Liste</button>
              </div>
            ` : `
              <div class="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 p-2.5 rounded-2xl text-[11px] text-emerald-900 dark:text-emerald-300 font-semibold shadow-xs">
                <span>✨ Alle Vorräte ausreichend gefüllt!</span>
              </div>
            `}
          </div>

          <div class="space-y-2.5">
            ${state.pantry.map(it => {
              const daysLeft = calculatePantryDaysLeft(it);
              const low = (it.totalPieces || 0) < (it.minPieces || 1) || (daysLeft !== null && daysLeft <= 2);
              const empty = (it.totalPieces || 0) === 0;
              
              const aNum = it.aisleNumber || 12;

              const buyPacks = it.buyQty || 1;
              const perPack = it.itemsPerPack || 1;
              const pantryUnit = it.pantryUnit || 'Stk.';
              const shopUnit = it.shopUnit || 'Packung';
              const safeName = it.name.replace(/'/g, "\\'");
              const safeShopUnit = shopUnit.replace(/'/g, "\\'");

              let timeAgoText = 'Noch nie aktualisiert';
              if (it.lastChecked) {
                const diffMs = Date.now() - it.lastChecked;
                const diffMins = Math.floor(diffMs / (1000 * 60));
                const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

                if (diffMins < 2) {
                  timeAgoText = 'Gerade eben aufgefüllt 🕒';
                } else if (diffMins < 60) {
                  timeAgoText = `Vor ${diffMins} Minuten aufgefüllt 🕒`;
                } else if (diffHours < 24) {
                  timeAgoText = `Vor ${diffHours} ${diffHours === 1 ? 'Stunde' : 'Stunden'} aufgefüllt 🕒`;
                } else if (diffDays === 1) {
                  timeAgoText = 'Gestern aufgefüllt 🕒';
                } else {
                  timeAgoText = `Vor ${diffDays} Tagen aufgefüllt (${new Date(it.lastChecked).toLocaleDateString('de-DE')}) 🕒`;
                }
              }

              const displayPieces = Number(it.totalPieces || 0).toFixed(2).replace(/\.00$/, '');

              return `
                <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl p-3.5 shadow-xs space-y-2.5 ${low ? 'pantry-red-blink border-2' : ''}">
                  
                  <div class="flex items-start justify-between gap-2">
                    <div class="flex items-start gap-2 min-w-0 flex-1">
                      <span class="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5 ${low ? 'bg-red-600 animate-ping' : 'bg-emerald-500'}"></span>
                      <div class="min-w-0 flex-1">
                        <span class="font-extrabold text-xs sm:text-sm text-stone-900 dark:text-stone-100 leading-snug break-words block">${it.name}</span>
                        
                        <div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          <button onclick="openEditPantryModal('${it.id}')" class="text-[10px] ${low ? 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 font-black border-red-300' : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300'} px-2.5 py-0.5 rounded-full font-bold border border-stone-200 dark:border-stone-700 flex items-center gap-1 cursor-pointer hover:bg-stone-200 shadow-xs">
                            <span>${displayPieces} ${pantryUnit}</span>
                            <span class="text-xs">✎</span>
                          </button>
                          <span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full ${low ? 'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/60 animate-pulse' : 'text-stone-500 bg-stone-100 dark:bg-stone-800'}">
                            ${empty ? '🚨 LEER!' : (daysLeft !== null ? (daysLeft <= 0 ? '⚠️ Leer!' : `~${daysLeft} Tage`) : `Min: ${it.minPieces||1}`)}
                          </span>
                          <span class="text-[9px] font-semibold ${it.intervallAktiv === false ? 'text-amber-500' : 'text-stone-400'}">
                            (${it.dailyConsumption || 1}/Tag ${it.intervallAktiv === false ? '⏸️ paussiert' : '▶️ aktiv'})
                          </span>
                        </div>

                        <div class="mt-1.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1 rounded-xl border border-amber-200 dark:border-amber-900/40 inline-block shadow-xs">
                          ${timeAgoText}
                        </div>
                      </div>
                    </div>

                    <button onclick="openEditPantryModal('${it.id}')" class="w-7 h-7 rounded-xl bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 flex items-center justify-center text-xs font-bold border border-stone-200 dark:border-stone-700 hover:bg-red-600 hover:text-white shrink-0 shadow-xs" title="Bearbeiten">✎</button>
                  </div>

                  <div class="text-[10px] text-stone-600 dark:text-stone-400 bg-stone-50 dark:bg-stone-800/40 p-2 rounded-2xl border border-stone-200/80 dark:border-stone-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <div class="flex items-center gap-1.5 font-medium w-full sm:w-auto">
                      <span>Gang:</span>
                      <select onchange="changePantryAisle('${it.id}', this.value)" class="bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-1.5 py-0.5 text-[10px] font-bold shadow-xs truncate max-w-[200px]">
                        ${pantryAisles.map(a => `<option value="${a.number}" ${aNum===parseInt(a.number,10)?'selected':''}>${a.name}</option>`).join('')}
                      </select>
                    </div>
                    <div class="font-medium">
                      <span>Kauf: <b class="text-red-600 dark:text-red-400">${buyPacks}x ${shopUnit}</b> (${perPack>1 ? `${perPack} ${pantryUnit}/Pack` : '1:1'})</span>
                    </div>
                  </div>

                  <div class="flex justify-between items-center pt-0.5">
                    <div class="flex items-center bg-stone-100 dark:bg-stone-800 rounded-2xl p-0.5 border border-stone-200 dark:border-stone-700 shadow-xs">
                      <button onclick="updatePantryPieces('${it.id}', -1)" class="w-6 h-6 bg-white dark:bg-stone-700 text-stone-800 dark:text-stone-200 rounded-xl font-bold text-xs shadow-xs">-</button>
                      <span class="px-3 text-xs font-bold text-stone-900 dark:text-stone-100">${displayPieces} ${pantryUnit}</span>
                      <button onclick="updatePantryPieces('${it.id}', 1)" class="w-6 h-6 bg-white dark:bg-stone-700 text-stone-800 dark:text-stone-200 rounded-xl font-bold text-xs shadow-xs">+</button>
                    </div>
                    <div class="flex gap-1.5">
                      <button onclick="addItem({ name: '${safeName}', shopUnit: '${safeShopUnit}', aisleNumber: ${aNum} }, ${buyPacks}, '${safeShopUnit}'); render();" class="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-extrabold text-xs shadow-xs">
                        + ${buyPacks}x 🛒
                      </button>
                      <button onclick="removePantryItem('${it.id}')" class="px-2.5 py-1.5 bg-red-50 dark:bg-red-950/40 text-red-600 rounded-xl font-bold text-xs border border-red-200 shadow-xs">🗑</button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    else if (state.activeTab === 'recipes') {
      html += `
        <div class="space-y-3">
          <button onclick="state.activeTab='menu'; render();" class="text-xs font-extrabold text-white bg-red-600 px-3 py-1.5 rounded-xl shadow-xs inline-block">← Zurück zum Menü</button>
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl p-3.5 shadow-xs space-y-2.5">
            <h2 class="text-sm font-extrabold text-stone-900 dark:text-stone-100">🍲 Chefkoch Rezept-Schnellsuche</h2>
            <div class="flex gap-2">
              <input type="text" id="chefkoch-search-box" placeholder="z.B. Pfannkuchen..." onkeydown="if(event.key==='Enter'){ window.open('https://www.chefkoch.de/rs/s0/' + encodeURIComponent(this.value) + '/Rezepte.html', '_blank'); }" class="flex-1 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-2xl px-3.5 py-2.5 text-xs text-stone-900 dark:text-stone-100 focus:outline-none focus:border-red-600 font-medium shadow-xs" />
              <button onclick="const q=document.getElementById('chefkoch-search-box').value.trim(); if(q) window.open('https://www.chefkoch.de/rs/s0/' + encodeURIComponent(q) + '/Rezepte.html', '_blank'); else window.open('https://www.chefkoch.de', '_blank');" class="bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold px-3.5 py-2.5 rounded-2xl shadow-xs">Suchen ↗</button>
            </div>
          </div>
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl p-3.5 shadow-xs space-y-2.5">
            <h3 class="font-extrabold text-xs text-stone-900 dark:text-stone-100">Kategorien</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              ${RECIPE_CATEGORIES.map(cat => `
                <button onclick="window.open('https://www.chefkoch.de/rs/s0/' + encodeURIComponent('${cat.query}') + '/Rezepte.html', '_blank');" class="p-3 rounded-2xl bg-white dark:bg-stone-800/40 hover:bg-red-500/10 border border-stone-200 dark:border-stone-700 flex items-center justify-between text-left shadow-xs group">
                  <div class="flex items-center gap-2.5">
                    <span class="text-base w-8 h-8 rounded-xl bg-stone-50 dark:bg-stone-700 border border-stone-200 dark:border-stone-600 flex items-center justify-center shrink-0 shadow-xs">${cat.icon}</span>
                    <span class="font-bold text-xs text-stone-900 dark:text-stone-100 group-hover:text-red-600">${cat.name}</span>
                  </div>
                  <span class="text-[11px] font-bold text-stone-400 shrink-0">Öffnen ↗</span>
                </button>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }

    else if (state.activeTab === 'favorites') {
      html += `
        <div class="space-y-3">
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl p-3.5 shadow-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5">
            <div>
              <h2 class="text-sm font-extrabold text-stone-900 dark:text-stone-100 flex items-center gap-1"><span class="text-amber-500 font-black">★</span> Favoriten (${favs.length})</h2>
              <p class="text-[11px] text-stone-500 font-medium">Nach Gebrauchshäufigkeit sortiert</p>
            </div>
            <div class="flex gap-1.5">
              <button onclick="addAllFavoritesToList();" class="bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold px-3 py-2 rounded-xl shadow-xs">+ Alle auf Liste</button>
            </div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            ${favs.map(fav => {
              const fPrice = getBaseUnitPrice(fav.name, fav.defaultPrice || 0), fDep = getBaseUnitDeposit(fav.name, fav.depositAmount || 0);
              const aNum = getProductAisleForMarket(fav.name, marketKey), aDef = activeAisles.find(a => parseInt(a.number, 10) === aNum);
              const safeFavName = fav.name.replace(/'/g, "\\'");
              const currentShopUnit = fav.shopUnit || 'Packung';
              const usageCount = usageCounts[(fav.name || '').toLowerCase().trim()] || 0;
              const fImg = fav.imageUrl || getProductImageUrl(fav.name);
              return `
                <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-xs">
                  <div class="flex items-center gap-2.5 min-w-0 flex-1">
                    ${fImg ? `<img src="${fImg}" class="w-9 h-9 object-cover rounded-xl shrink-0 border border-stone-200 dark:border-stone-700 shadow-xs" />` : '<div class="w-9 h-9 rounded-xl bg-stone-100 dark:bg-stone-800 flex items-center justify-center text-xs shrink-0 border border-stone-200 dark:border-stone-700 shadow-xs">🛒</div>'}
                    <div class="min-w-0 flex-1 space-y-1">
                      <div class="flex items-center gap-1.5">
                        <input type="text" value="${fav.name}" onchange="updateFavoriteName('${safeFavName}', this.value)" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-2.5 py-1 text-xs font-extrabold shadow-xs focus:outline-none focus:border-red-600" title="Tippen zum Umbenennen" />
                        ${usageCount > 0 ? `<span class="text-[9px] bg-red-500/10 text-red-600 dark:text-red-400 font-extrabold px-2 py-0.5 rounded-full shrink-0">${usageCount}x</span>` : ''}
                      </div>
                      <span class="text-[10px] text-stone-500 block truncate font-medium pl-1">${aDef ? aDef.name : `Gang ${aNum}`} • <b>${fPrice.toFixed(2)} €</b></span>
                    </div>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <select onchange="updateFavoriteUnit('${safeFavName}', this.value)" class="bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-800 dark:text-stone-200 rounded-xl px-2 py-1 text-[10px] font-semibold shadow-xs">
                      ${COMMON_UNITS.map(u => `<option value="${u}" ${u===currentShopUnit?'selected':''}>${u}</option>`).join('')}
                    </select>
                    <button onclick="toggleFavorite('${safeFavName}');" class="p-1 text-sm text-amber-500 font-black">★</button>
                    <button onclick="addItem({ name: '${safeFavName}', shopUnit: '${currentShopUnit}', defaultPrice: ${fPrice}, depositAmount: ${fDep}, aisleNumber: ${aNum}, imageUrl: '${fImg}' }, 1, '${currentShopUnit}'); render();" class="bg-red-50 hover:bg-red-600 hover:text-white text-red-700 dark:text-red-400 text-xs font-bold px-3 py-1.5 rounded-xl shadow-xs transition-colors border border-red-200">+ Liste</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    else if (state.activeTab === 'more-prospects') {
      html += `
        <div class="space-y-3">
          <button onclick="state.activeTab='menu'; render();" class="text-xs font-extrabold text-white bg-red-600 px-3 py-1.5 rounded-xl shadow-xs inline-block">← Zurück zum Menü</button>
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl p-3.5 shadow-xs space-y-2.5">
            <h3 class="font-extrabold text-xs text-stone-900 dark:text-stone-100">📰 Online-Prospekte Schwarzenbek</h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              ${BROCHURES.map(b => `
                <a href="${b.link}" target="_blank" rel="noopener noreferrer" class="p-2.5 bg-white dark:bg-stone-800/40 hover:bg-stone-50 dark:hover:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-2xl flex items-center justify-between transition-all group shadow-xs">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <span class="text-base w-8 h-8 rounded-xl bg-stone-50 dark:bg-stone-700 border border-stone-200 dark:border-stone-600 flex items-center justify-center shrink-0 shadow-xs">${b.icon}</span>
                    <div class="min-w-0">
                      <span class="font-bold text-xs text-stone-900 dark:text-stone-100 block group-hover:text-red-600 truncate">${b.store}</span>
                      <span class="text-[9px] text-stone-500 truncate block">${b.branch}</span>
                    </div>
                  </div>
                  <span class="text-[10px] font-bold text-stone-400 shrink-0 ml-1">Öffnen ↗</span>
                </a>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }

    else if (state.activeTab === 'more-history') {
      html += `
        <div class="space-y-3">
          <button onclick="state.activeTab='menu'; render();" class="text-xs font-extrabold text-white bg-red-600 px-3 py-1.5 rounded-xl shadow-xs inline-block">← Zurück zum Menü</button>
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl p-3.5 shadow-xs space-y-2.5">
            <div class="flex justify-between items-center">
              <div>
                <h3 class="font-extrabold text-xs text-stone-900 dark:text-stone-100">📊 Einkaufs-Historie (${state.purchaseHistory.length})</h3>
                <p class="text-[10px] text-stone-500 font-medium">Vergangene Kassenbons</p>
              </div>
              ${state.purchaseHistory.length>0?`<button onclick="if(confirm('Historie leeren?')){ state.purchaseHistory=[]; state.expandedHistoryIds=[]; saveState(); render(); }" class="text-xs font-bold text-red-600">Leeren</button>`:''}
            </div>
            ${state.purchaseHistory.length === 0 ? `
              <p class="text-xs text-stone-500 py-1 font-medium">Keine Historie vorhanden.</p>
            ` : `
              <div class="space-y-1.5 max-h-96 overflow-y-auto custom-scrollbar">
                ${state.purchaseHistory.map(rec => {
                  const isExpanded = state.expandedHistoryIds.includes(rec.id);
                  return `
                    <div class="bg-stone-50 dark:bg-stone-800/40 border border-stone-200 dark:border-stone-700 rounded-2xl overflow-hidden text-xs shadow-xs">
                      <div onclick="toggleHistoryItem('${rec.id}')" class="p-2.5 flex justify-between items-center cursor-pointer hover:bg-stone-100 dark:hover:bg-stone-800">
                        <div class="flex items-center gap-2">
                          <span class="font-bold text-stone-400">${isExpanded ? '▼' : '▶'}</span>
                          <div>
                            <span class="font-bold text-stone-900 dark:text-stone-100 text-xs block">${rec.listName}</span>
                            <span class="text-[9px] text-stone-500">${new Date(rec.date).toLocaleDateString('de-DE')} • ${rec.itemCount} Artikel</span>
                          </div>
                        </div>
                        <span class="font-black text-xs text-red-600 dark:text-red-400">${(rec.finalTotal||0).toFixed(2)} €</span>
                      </div>
                      ${isExpanded && rec.items ? `
                        <div class="px-3 pb-2.5 pt-1 border-t border-stone-200 dark:border-stone-700 bg-white dark:bg-[#1a1a1a] space-y-1.5 text-[10px] text-stone-700 dark:text-stone-300">
                          ${rec.items.map(it => `
                            <div class="flex justify-between items-center py-0.5 border-b border-stone-100 dark:border-stone-800 last:border-0">
                              <div>
                                <span class="font-bold block">• ${it.quantity}x ${it.name} [${it.packageUnit}]</span>
                                ${it.hasPromo ? `<span class="text-[9px] text-red-600 dark:text-red-400 font-bold block">⚡ ${it.promoText}</span>` : ''}
                              </div>
                              <div class="text-right">
                                ${it.hasPromo ? `<span class="line-through text-stone-400 block text-[9px]">${(it.originalSinglePrice * it.quantity).toFixed(2)} €</span>` : ''}
                                <span class="font-extrabold text-stone-900 dark:text-stone-100">${(it.totalPrice||0).toFixed(2)} €</span>
                              </div>
                            </div>
                          `).join('')}
                          ${rec.depositReceipt > 0 ? `
                            <div class="flex justify-between items-center py-1 text-emerald-600 dark:text-emerald-400 font-bold border-t border-stone-100 dark:border-stone-800 mt-1">
                              <span>Pfandbon Abzug:</span>
                              <span>-${rec.depositReceipt.toFixed(2)} €</span>
                            </div>
                          ` : ''}
                        </div>
                      ` : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>
        </div>
      `;
    }

    else if (state.activeTab === 'more-aisles') {
      html += `
        <div class="space-y-3">
          <button onclick="state.activeTab='menu'; render();" class="text-xs font-extrabold text-white bg-red-600 px-3 py-1.5 rounded-xl shadow-xs inline-block">← Zurück zum Menü</button>
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl p-3.5 shadow-xs space-y-2.5">
            <div class="flex justify-between items-center">
              <div>
                <h3 class="font-extrabold text-xs text-stone-900 dark:text-stone-100">Gänge für "${curList.name}"</h3>
                <p class="text-[10px] text-stone-500 font-medium">Gänge verwalten & löschen</p>
              </div>
              <button onclick="openNewAisleModal();" class="bg-red-600 text-white text-xs font-extrabold px-2.5 py-1.5 rounded-xl shadow-xs">+ Gang</button>
            </div>
            <div class="space-y-1.5 max-h-96 overflow-y-auto custom-scrollbar">
              ${sortedAisles.map((a, idx) => `
                <div class="bg-stone-50 dark:bg-stone-800/40 border border-stone-200 dark:border-stone-700 rounded-2xl p-2 flex justify-between items-center gap-2 text-xs shadow-xs">
                  <div class="flex items-center gap-2 flex-1 min-w-0">
                    <span class="w-5 h-5 rounded-lg bg-red-600 text-white font-bold flex items-center justify-center text-[9px] shrink-0">${a.number}</span>
                    <input type="text" value="${a.name}" onchange="updateAisleName('${a.id}', this.value)" class="bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-2 py-0.5 text-xs font-semibold w-full shadow-xs" />
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <button ${idx===0?'disabled':''} onclick="moveAisle(${idx}, -1)" class="w-6 h-6 bg-white dark:bg-stone-700 text-stone-800 dark:text-stone-200 border border-stone-200 dark:border-stone-600 rounded-xl font-bold text-[10px] disabled:opacity-30 shadow-xs">↑</button>
                    <button ${idx===sortedAisles.length-1?'disabled':''} onclick="moveAisle(${idx}, 1)" class="w-6 h-6 bg-white dark:bg-stone-700 text-stone-800 dark:text-stone-200 border border-stone-200 dark:border-stone-600 rounded-xl font-bold text-[10px] disabled:opacity-30 shadow-xs">↓</button>
                    <button onclick="deleteAisle('${a.id}')" class="w-6 h-6 bg-red-50 text-red-600 border border-red-200 rounded-xl font-bold text-[10px] shadow-xs">🗑</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }

    else if (state.activeTab === 'more-db') {
      const dbItems = getCatalog();
      html += `
        <div class="space-y-3">
          <button onclick="state.activeTab='menu'; render();" class="text-xs font-extrabold text-white bg-red-600 px-3 py-1.5 rounded-xl shadow-xs inline-block">← Zurück zum Menü</button>
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl p-3.5 shadow-xs space-y-2.5">
            <div class="flex justify-between items-center flex-wrap gap-2">
              <div>
                <h3 class="font-extrabold text-xs text-stone-900 dark:text-stone-100">🗄️ Produktdatenbank (${dbItems.length})</h3>
                <p class="text-[10px] text-stone-500 font-medium">Artikel dauerhaft löschen</p>
              </div>
              <div class="flex gap-1.5">
                <button onclick="state.showDuplicateModal=true; render();" class="bg-amber-500 hover:bg-amber-600 text-white text-xs font-extrabold px-3 py-1.5 rounded-xl shadow-xs">🔍 Ähnliche / Duplikate</button>
                ${state.deletedMasterIds.length>0?`<button onclick="state.deletedMasterIds=[]; saveState(); render();" class="text-xs font-bold text-blue-600 px-2 py-1 bg-blue-50 rounded-xl">Reset</button>`:''}
              </div>
            </div>
            <input type="text" id="db-search-filter-input" value="${state.dbSearchFilter||''}" oninput="state.dbSearchFilter=this.value; const listContainer=document.getElementById('db-filtered-list-container'); if(listContainer){ listContainer.innerHTML=getFilteredDbHtml(); }" placeholder="Produkt suchen..." class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:border-red-600 shadow-xs" />
            <div id="db-filtered-list-container" class="space-y-1 max-h-96 overflow-y-auto custom-scrollbar divide-y divide-stone-100 dark:divide-stone-800">
              ${getFilteredDbHtml(marketKey)}
            </div>
          </div>
        </div>
      `;
    }

    if (state.showVoiceDisambiguationModal) {
      html += `
        <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl max-w-sm w-full p-4 shadow-2xl space-y-3 text-stone-900 dark:text-stone-100">
            <div class="flex justify-between items-center pb-2 border-b border-stone-100 dark:border-stone-800">
              <div class="flex items-center gap-1.5">
                <span class="text-base">🎙️</span>
                <h3 class="font-extrabold text-sm">Mehrere Treffer gefunden</h3>
              </div>
              <button onclick="state.showVoiceDisambiguationModal=false; render();" class="text-stone-400 hover:text-stone-700 font-bold">✕</button>
            </div>
            <p class="text-xs text-stone-600 dark:text-stone-400 font-medium">Welchen Artikel meinst du genau? Bitte tippe auf den gewünschten Eintrag:</p>
            
            <div class="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
              ${state.voiceDisambiguationMatches.map(m => `
                <button onclick="
                  addItem({ name: '${m.name.replace(/'/g, "\\'")}', shopUnit: '${m.shopUnit||'Packung'}', defaultPrice: ${m.defaultPrice||0}, depositAmount: ${m.depositAmount||0}, aisleNumber: ${m.aisleNumber||6}, imageUrl: '${m.imageUrl||''}' }, 1, '${m.shopUnit||'Packung'}');
                  state.showVoiceDisambiguationModal = false;
                  render();
                " class="w-full text-left p-3 rounded-2xl bg-stone-50 dark:bg-stone-800 hover:bg-red-500/10 border border-stone-200 dark:border-stone-700 flex justify-between items-center transition-all shadow-xs">
                  <div class="flex items-center gap-2.5">
                    ${m.imageUrl ? `<img src="${m.imageUrl}" class="w-8 h-8 object-cover rounded-xl shrink-0" />` : ''}
                    <div>
                      <span class="font-extrabold text-xs text-stone-900 dark:text-stone-100 block">${m.name}</span>
                      <span class="text-[10px] text-stone-500">Gang ${m.aisleNumber || 6} • ${m.shopUnit || 'Packung'}</span>
                    </div>
                  </div>
                  <span class="text-xs font-bold text-red-600 dark:text-red-400 bg-red-500/10 px-2 py-1 rounded-xl shrink-0">+ Auswählen</span>
                </button>
              `).join('')}
            </div>

            <div class="flex justify-end pt-2 border-t border-stone-100 dark:border-stone-800">
              <button onclick="state.showVoiceDisambiguationModal=false; render();" class="px-4 py-2 bg-stone-200 dark:bg-stone-800 text-stone-800 dark:text-stone-200 font-bold text-xs rounded-xl shadow-xs">Abbrechen</button>
            </div>
          </div>
        </div>
      `;
    }

    if (state.showBarcodeMatchModal) {
      const scannedInfo = state.scannedBarcodeData || {};
      html += `
        <div class="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl max-w-md w-full p-4 shadow-2xl space-y-3 text-stone-900 dark:text-stone-100">
            <div class="flex justify-between items-center pb-2 border-b border-stone-100 dark:border-stone-800">
              <div class="flex items-center gap-1.5">
                <span class="text-base">🔍</span>
                <h3 class="font-extrabold text-sm">Gescannter Artikel zuordnen</h3>
              </div>
              <button onclick="state.showBarcodeMatchModal=false; render();" class="text-stone-400 hover:text-stone-700 font-bold">✕</button>
            </div>
            
            <div class="bg-stone-50 dark:bg-stone-800/60 p-3 rounded-2xl border border-stone-200 dark:border-stone-700 text-xs flex items-center gap-3">
              ${scannedInfo.imageUrl ? `<img src="${scannedInfo.imageUrl}" class="w-12 h-12 object-cover rounded-xl border border-stone-200 shrink-0" />` : ''}
              <div>
                <span class="text-[10px] font-bold text-stone-400 uppercase block">Offizieller Name laut Datenbank:</span>
                <p class="font-black text-stone-900 dark:text-stone-100">${scannedInfo.rawName || 'Unbekannt'}</p>
              </div>
            </div>

            <p class="text-xs text-stone-600 dark:text-stone-400 font-medium">Wir haben folgende passende Artikel in deiner Datenbank gefunden. Ist das einer davon?</p>

            <div class="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
              ${state.barcodeMatchCandidates.map(cand => `
                <button onclick="assignBarcodeToExistingProduct('${cand.name.replace(/'/g, "\\'")}')" class="w-full text-left p-3 rounded-2xl bg-stone-50 dark:bg-stone-800 hover:bg-red-500/10 border border-stone-200 dark:border-stone-700 flex justify-between items-center transition-all shadow-xs">
                  <div class="flex items-center gap-2.5">
                    ${cand.imageUrl ? `<img src="${cand.imageUrl}" class="w-8 h-8 object-cover rounded-xl shrink-0" />` : ''}
                    <div>
                      <span class="font-extrabold text-xs text-stone-900 dark:text-stone-100 block">✨ ${cand.name}</span>
                      <span class="text-[10px] text-stone-500">Gang ${cand.aisleNumber || 6} • ${cand.shopUnit || 'Packung'}</span>
                    </div>
                  </div>
                  <span class="text-xs font-bold text-white bg-red-600 px-3 py-1 rounded-xl shrink-0">Das ist er ✓</span>
                </button>
              `).join('')}
            </div>

            <div class="pt-2 border-t border-stone-100 dark:border-stone-800 space-y-2">
              <button onclick="assignBarcodeAsNewProduct()" class="w-full py-2.5 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 font-bold text-xs rounded-xl border border-stone-200 dark:border-stone-700 shadow-xs text-center">
                Nein, als neuen Artikel "${scannedInfo.rawName}" in Datenbank aufnehmen
              </button>
            </div>
          </div>
        </div>
      `;
    }

    if (state.showScanIntentModal) {
      const scannedInfo = state.scannedBarcodeData || {};
      const currentDefaultPrice = getBaseUnitPrice(scannedInfo.finalName, 0);
      const currentDeposit = getBaseUnitDeposit(scannedInfo.finalName, 0);

      html += `
        <div class="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl max-w-sm w-full p-4 shadow-2xl space-y-3 text-stone-900 dark:text-stone-100">
            <div class="flex justify-between items-center pb-2 border-b border-stone-100 dark:border-stone-800">
              <div class="flex items-center gap-1.5">
                <span class="text-base">📷</span>
                <h3 class="font-extrabold text-sm">Artikel gescannt</h3>
              </div>
              <button onclick="state.showScanIntentModal=false; render();" class="text-stone-400 hover:text-stone-700 font-bold">✕</button>
            </div>
            
            ${scannedInfo.imageUrl ? `
              <div class="flex justify-center">
                <img src="${scannedInfo.imageUrl}" class="w-20 h-20 object-cover rounded-2xl border-2 border-red-500 shadow-md" />
              </div>
            ` : ''}

            <div class="space-y-1">
              <label class="text-[10px] font-bold text-stone-400 uppercase block">Produktname anpassen:</label>
              <input type="text" id="scan-modal-name-input" value="${scannedInfo.finalName || ''}" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-3 py-2 text-xs font-bold shadow-xs focus:outline-none focus:border-red-600" />
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-[10px] font-bold text-stone-400 uppercase block">Preis (€):</label>
                <input type="number" step="0.01" min="0" id="scan-modal-price-input" value="${currentDefaultPrice > 0 ? currentDefaultPrice.toFixed(2) : ''}" placeholder="0.00" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-3 py-2 text-xs font-bold shadow-xs focus:outline-none focus:border-red-600" />
              </div>
              <div>
                <label class="text-[10px] font-bold text-stone-400 uppercase block">Pfand (€):</label>
                <input type="number" step="0.01" min="0" id="scan-modal-deposit-input" value="${currentDeposit > 0 ? currentDeposit.toFixed(2) : '0.00'}" placeholder="0.00" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-3 py-2 text-xs font-bold shadow-xs focus:outline-none focus:border-red-600" />
              </div>
            </div>

            <p class="text-xs text-stone-600 dark:text-stone-400 font-medium pt-1">Was möchtest du mit diesem Artikel tun?</p>

            <div class="space-y-2 pt-1">
              <button onclick="executeScanIntent('cart')" class="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-extrabold text-xs rounded-2xl shadow-xs flex items-center justify-center gap-2">
                <span>🛒 Direkt in den Einkaufswagen</span>
              </button>
              <button onclick="executeScanIntent('db')" class="w-full py-3 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 font-extrabold text-xs rounded-2xl border border-stone-200 dark:border-stone-700 shadow-xs flex items-center justify-center gap-2">
                <span>🗄️ Nur für die Datenbank merken</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }

    if (state.showExportModal) {
      html += `
        <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl max-w-lg w-full p-4 shadow-2xl space-y-3 max-h-[90vh] flex flex-col text-stone-900 dark:text-stone-100">
            <div class="flex justify-between items-center pb-2 border-b border-stone-100 dark:border-stone-800">
              <div class="flex items-center gap-1.5">
                <span class="text-base">💾</span>
                <h3 class="font-extrabold text-sm">Backup verwalten</h3>
              </div>
              <button onclick="state.showExportModal=false; render();" class="text-stone-400 hover:text-stone-700 font-bold">✕</button>
            </div>
            
            <div class="space-y-2 flex-1 flex flex-col min-h-0">
              <label class="text-xs font-bold text-stone-700 dark:text-stone-300 block">Dein Backup-Code (zum Kopieren oder Einspielen):</label>
              <textarea id="import-json-textarea" rows="10" placeholder="JSON Code hier einfügen zum Wiederherstellen..." class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-2xl p-3 text-[11px] font-mono text-stone-900 dark:text-stone-100 focus:outline-none focus:border-red-600 custom-scrollbar shadow-inner">${state.exportTextContent || ''}</textarea>
            </div>

            <div class="flex flex-wrap justify-between items-center gap-2 pt-2 border-t border-stone-100 dark:border-stone-800">
              <div class="flex gap-2">
                <button onclick="const ta=document.getElementById('import-json-textarea'); ta.select(); document.execCommand('copy'); soundAdd(); showToast('In Zwischenablage kopiert! 📋');" class="px-3 py-2 bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-200 text-xs font-bold rounded-xl shadow-xs">Kopieren</button>
                <button onclick="importAppDataText();" class="px-3 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl shadow-xs">Einspielen</button>
              </div>
              <button onclick="state.showExportModal=false; render();" class="px-4 py-2 bg-red-600 text-white font-extrabold text-xs rounded-xl shadow-xs">Schließen</button>
            </div>
          </div>
        </div>
      `;
    }

    if (state.showDuplicateModal) {
      const dbItems = getCatalog();
      
      function getEditDistance(a, b) {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;
        const matrix = [];
        for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
        for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
        for (let i = 1; i <= b.length; i++) {
          for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
              matrix[i][j] = matrix[i - 1][j - 1];
            } else {
              matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
            }
          }
        }
        return matrix[b.length][a.length];
      }

      const duplicateGroups = [];
      const processedIds = new Set();

      for (let i = 0; i < dbItems.length; i++) {
        const itemA = dbItems[i];
        if (processedIds.has(itemA.id)) continue;

        const nameA = itemA.name.toLowerCase().trim();
        const group = [itemA];

        for (let j = i + 1; j < dbItems.length; j++) {
          const itemB = dbItems[j];
          if (processedIds.has(itemB.id)) continue;

          const nameB = itemB.name.toLowerCase().trim();

          let isMatch = (nameA === nameB);

          if (!isMatch && (nameA.includes(nameB) || nameB.includes(nameA))) {
            if (Math.min(nameA.length, nameB.length) >= 3) {
              isMatch = true;
            }
          }

          if (!isMatch && Math.abs(nameA.length - nameB.length) <= 3) {
            const distance = getEditDistance(nameA, nameB);
            const maxLen = Math.max(nameA.length, nameB.length);
            if (maxLen >= 4 && distance <= 3) {
              isMatch = true;
            }
          }

          if (isMatch) {
            group.push(itemB);
            processedIds.add(itemB.id);
          }
        }

        if (group.length > 1) {
          duplicateGroups.push(group);
          processedIds.add(itemA.id);
        }
      }

      const filterTerm = (state.duplicateSearchTerm || '').toLowerCase().trim();
      const filteredGroups = filterTerm 
        ? duplicateGroups.filter(g => g.some(it => it.name.toLowerCase().includes(filterTerm)))
        : duplicateGroups;

      html += `
        <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl max-w-lg w-full p-4 shadow-2xl space-y-3 max-h-[90vh] flex flex-col text-stone-900 dark:text-stone-100">
            <div class="flex justify-between items-center pb-2 border-b border-stone-100 dark:border-stone-800">
              <div class="flex items-center gap-1.5">
                <span class="text-base">🔍</span>
                <h3 class="font-extrabold text-sm">Ähnliche Artikel & Duplikate</h3>
              </div>
              <button onclick="state.showDuplicateModal=false; render();" class="text-stone-400 hover:text-stone-700 font-bold">✕</button>
            </div>
            <div class="flex justify-between items-center text-xs bg-stone-50 dark:bg-stone-800/50 p-2.5 rounded-2xl border border-stone-200 dark:border-stone-700">
              <span>Gefundene Gruppen:</span>
              <span class="font-black text-red-600">${duplicateGroups.length} Gruppen</span>
            </div>
            <input type="text" value="${state.duplicateSearchTerm || ''}" oninput="state.duplicateSearchTerm = this.value; render();" placeholder="In Gruppen suchen..." class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl px-3 py-2 text-xs font-semibold shadow-xs" />
            
            <div class="flex-1 overflow-y-auto custom-scrollbar space-y-2.5 max-h-96 pr-1">
              ${filteredGroups.length === 0 ? `
                <div class="text-center py-6 text-xs text-stone-500 font-medium">Keine Duplikate oder Tippfehler gefunden! 🎉</div>
              ` : filteredGroups.map(group => `
                <div class="bg-stone-50 dark:bg-stone-800/40 border border-stone-200 dark:border-stone-700 rounded-2xl p-3 space-y-2 text-xs">
                  <span class="text-[10px] font-extrabold text-stone-400 uppercase tracking-wide block">Mögliche Gruppe (${group.length} Einträge):</span>
                  <div class="space-y-2">
                    ${group.map(item => {
                      const itemPrice = getBaseUnitPrice(item.name, item.defaultPrice || 0);
                      const itemAisle = getProductAisleForMarket(item.name, marketKey);
                      const itemImg = item.imageUrl || getProductImageUrl(item.name);
                      return `
                        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-white dark:bg-stone-900 p-2.5 rounded-2xl border border-stone-200 dark:border-stone-700">
                          <div class="flex items-center gap-2.5 min-w-0 flex-1">
                            ${itemImg ? `<img src="${itemImg}" class="w-8 h-8 object-cover rounded-xl shrink-0" />` : ''}
                            <div class="min-w-0 flex-1 pr-1">
                              <span class="font-bold text-stone-900 dark:text-stone-100 block break-words text-xs leading-snug">${item.name}</span>
                              <span class="text-[10px] text-stone-500 block truncate font-medium">Einheit: <b>${item.shopUnit || 'Packung'}</b> • Preis: <b>${itemPrice.toFixed(2)} €</b> • Gang ${itemAisle}</span>
                            </div>
                          </div>
                          <button onclick="purgeProductFromDatabase('${item.id}');" class="px-3 py-1.5 bg-red-50 hover:bg-red-600 hover:text-white text-red-600 font-extrabold rounded-xl border border-red-200 shrink-0 shadow-xs text-xs self-end sm:self-center">Löschen 🗑</button>
                        </div>
                      `;
                    }).join('')}
                  </div>
                </div>
              `).join('')}
            </div>

            <div class="flex justify-end items-center pt-2 border-t border-stone-100 dark:border-stone-800">
              <button onclick="state.showDuplicateModal=false; render();" class="px-4 py-1.5 bg-red-600 text-white font-extrabold text-xs rounded-xl shadow-xs">Schließen</button>
            </div>
          </div>
        </div>
      `;
    }
    if (state.showScannerModal) {
      html += `
        <div class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl max-w-sm w-full p-4 shadow-2xl space-y-3 text-stone-900 dark:text-stone-100">
            <div class="flex justify-between items-center pb-2 border-b border-stone-100 dark:border-stone-800">
              <div class="flex items-center gap-1.5"><span class="text-base">📷</span><h3 class="font-extrabold text-sm">Barcode scannen</h3></div>
              <button onclick="closeBarcodeScannerModal();" class="text-stone-400 hover:text-stone-700 font-bold">✕</button>
            </div>
            <p class="text-xs text-stone-500 font-medium">Halte den Strichcode vor die Kamera deines Handys:</p>
            
            <div id="reader" class="w-full overflow-hidden rounded-2xl bg-black min-h-[250px]"></div>

            <div class="flex justify-end pt-2 border-t border-stone-100 dark:border-stone-800">
              <button onclick="closeBarcodeScannerModal();" class="px-4 py-2 bg-red-600 text-white font-extrabold text-xs rounded-xl shadow-xs">Abbrechen</button>
            </div>
          </div>
        </div>
      `;
    }

    if (state.showFinishModal) {
      const comp = state.items.filter(i => (i.listId || 'list-penny') === state.activeListId && i.isChecked);
      let doneSub = 0, doneDep = 0, doneB = 0;
      const modalSnapshot = comp.map(i => {
        const inf = calculateItemPriceInfo(i);
        doneSub += inf.totalItemPrice;
        doneDep += inf.totalItemDeposit;
        doneB += inf.totalItemBottles;
        return { 
          name: i.name, 
          quantity: i.quantity, 
          packageUnit: i.packageUnit || 'Packung', 
          totalPrice: inf.totalItemPrice,
          hasPromo: inf.hasPromo,
          promoText: inf.promoText,
          originalTotal: inf.originalSinglePrice * i.quantity
        };
      });
      
      const rec = parseFloat(state.finishDepositReceipt) || 0;
      const grossTotal = doneSub + doneDep;
      const toPay = Math.max(0, grossTotal - rec);

      html += `
        <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl max-w-sm w-full p-4 shadow-2xl space-y-3 max-h-[90vh] overflow-y-auto custom-scrollbar text-stone-900 dark:text-stone-100">
            <div class="flex justify-between items-center pb-2 border-b border-stone-100 dark:border-stone-800">
              <div class="flex items-center gap-1.5"><span class="text-lg">🧾</span><h3 class="font-extrabold text-sm">Kassenbon Abschluss</h3></div>
              <button onclick="state.showFinishModal=false; render();">✕</button>
            </div>
            <div class="bg-stone-50 dark:bg-stone-800/50 p-3 rounded-2xl border border-stone-200 dark:border-stone-700 space-y-2 text-xs max-h-36 overflow-y-auto custom-scrollbar shadow-inner">
              ${modalSnapshot.map(item => `
                <div class="flex justify-between items-center border-b border-stone-200 dark:border-stone-700 pb-1.5 last:border-0 last:pb-0">
                  <div>
                    <span class="font-bold block">${item.quantity}x ${item.name} [${item.packageUnit}]</span>
                    ${item.hasPromo ? `<span class="text-[9px] text-red-600 dark:text-red-400 font-bold block">⚡ ${item.promoText}</span>` : ''}
                  </div>
                  <div class="text-right">
                    ${item.hasPromo ? `<span class="line-through text-stone-400 block text-[9px]">${item.originalTotal.toFixed(2)} €</span>` : ''}
                    <span class="font-bold text-stone-900 dark:text-stone-100">${(item.totalPrice||0).toFixed(2)} €</span>
                  </div>
                </div>
              `).join('')}
            </div>
            <div class="bg-stone-50 dark:bg-stone-800/50 p-3 rounded-2xl border border-stone-200 dark:border-stone-700 space-y-1 text-xs">
              <div class="flex justify-between text-stone-600 dark:text-stone-400"><span>Warenwert:</span><span class="font-bold text-stone-900 dark:text-stone-100">${doneSub.toFixed(2)} €</span></div>
              <div class="flex justify-between text-emerald-800 dark:text-emerald-400"><span>Pfand (${doneB} Fl.):</span><span class="font-bold">+${doneDep.toFixed(2)} €</span></div>
              ${rec > 0 ? `<div class="flex justify-between text-emerald-600 dark:text-emerald-400 font-bold"><span>Pfandbon Abzug:</span><span>-${rec.toFixed(2)} €</span></div>` : ''}
            </div>
            <div class="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 p-3 rounded-2xl space-y-1">
              <label class="text-xs font-bold text-emerald-950 dark:text-emerald-300 block">Pfandbon abgegeben? (€)</label>
              <input type="number" step="0.01" min="0" value="${state.finishDepositReceipt||''}" oninput="state.finishDepositReceipt=parseFloat(this.value)||0; const newReceipt=parseFloat(this.value)||0; const finalCalc=Math.max(0, (${grossTotal})-newReceipt); document.getElementById('finish-total-display').innerText=finalCalc.toFixed(2)+' €';" placeholder="0,00 €" class="w-full bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 border border-emerald-300 dark:border-emerald-700 rounded-xl px-2.5 py-2 text-xs font-bold shadow-xs" />
            </div>
            <div class="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 p-3 rounded-2xl flex justify-between items-center">
              <span class="text-xs font-extrabold text-red-900 dark:text-red-300">Zu zahlen:</span>
              <span class="text-sm font-black text-red-600 dark:text-red-400" id="finish-total-display">${toPay.toFixed(2)} €</span>
            </div>
            <label class="flex items-center gap-2 text-xs text-stone-700 dark:text-stone-300 cursor-pointer pt-0.5 font-medium">
              <input type="checkbox" ${state.autoFillPantryOnFinish?'checked':''} onchange="state.autoFillPantryOnFinish=this.checked;" class="w-4 h-4 rounded text-red-600 shadow-xs" />
              <span>Vorrat beim Kassenbon auffrischen</span>
            </label>
            <div class="flex justify-end gap-2 pt-2 border-t border-stone-100 dark:border-stone-800">
              <button onclick="state.showFinishModal=false; render();" class="px-3 py-1.5 text-xs text-stone-600 dark:text-stone-400 font-medium">Abbrechen</button>
              <button onclick="confirmFinishShopping();" class="bg-emerald-600 text-white text-xs font-extrabold px-3.5 py-2 rounded-xl shadow-xs">Speichern 🎉</button>
            </div>
          </div>
        </div>
      `;
    }

    if (state.showWhatsAppModal) {
      const msg = generateWhatsAppMessage();
      html += `
        <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl max-w-lg w-full p-4 shadow-2xl space-y-3 max-h-[90vh] flex flex-col text-stone-900 dark:text-stone-100">
            <div class="flex justify-between items-center pb-2 border-b border-stone-100 dark:border-stone-800"><h3 class="font-extrabold text-xs">💬 WhatsApp Liste</h3><button onclick="state.showWhatsAppModal=false; render();">✕</button></div>
            <div class="flex-1 overflow-y-auto custom-scrollbar bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 rounded-2xl p-3 text-xs font-mono whitespace-pre-wrap select-all shadow-inner">${msg}</div>
            <div class="flex justify-between gap-2 pt-2 border-t border-stone-100 dark:border-stone-800">
              <button onclick="navigator.clipboard.writeText(generateWhatsAppMessage()); soundAdd(); showToast('Kopiert! 📋');" class="bg-stone-100 dark:bg-stone-800 text-stone-800 dark:text-stone-200 text-xs font-bold px-3 py-2 rounded-xl shadow-xs">Kopieren</button>
              <button onclick="window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(generateWhatsAppMessage()), '_blank');" class="bg-[#25D366] text-white text-xs font-extrabold px-3 py-2 rounded-xl shadow-xs">WhatsApp ↗</button>
            </div>
          </div>
        </div>
      `;
    }

    if (state.showNewListModal) {
      html += `
        <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl max-w-sm w-full p-4 shadow-2xl space-y-3 text-stone-900 dark:text-stone-100 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div class="flex justify-between items-center pb-1 border-b border-stone-100 dark:border-stone-800"><h3 class="font-extrabold text-xs">Neuen Markt anlegen</h3><button onclick="closeNewListModal();">✕</button></div>
            <div class="space-y-1">
              <label class="text-[11px] font-bold text-stone-700 dark:text-stone-300 block">Name des Marktes</label>
              <div class="flex items-center gap-2">
                <div id="new-list-icon-preview" class="w-9 h-9 rounded-xl bg-stone-100 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 flex items-center justify-center text-lg shrink-0 shadow-xs">${state.newListSelectedIcon||'📋'}</div>
                <input type="text" id="new-list-name" placeholder="z. B. Lidl / Fressnapf..." onkeydown="if(event.key==='Enter') createNewList();" class="flex-1 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-3 py-2 text-xs font-bold shadow-xs" />
              </div>
            </div>
            <div class="space-y-1">
              <label class="text-[11px] font-bold text-stone-700 dark:text-stone-300 block">Laufweg & Gang-Vorlagen</label>
              <select id="new-list-marketkey" onchange="selectListMarket(this.value)" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-3 py-2 text-xs font-bold shadow-xs">
                <option value="penny">Penny Vorlage (Standard)</option>
                <option value="rewe">Rewe Vorlage</option>
                <option value="lidl">Lidl Vorlage (Neu)</option>
                <option value="netto">Netto Vorlage (Neu)</option>
                <option value="fressnapf">Fressnapf Vorlage (Neu)</option>
                <option value="aldi">Aldi Nord Vorlage</option>
                <option value="edeka">Edeka Vorlage</option>
                <option value="rossmann">Rossmann Vorlage</option>
                <option value="custom">✏️ Eigene Gänge frei definieren</option>
              </select>
            </div>

            <div id="custom-aisles-input-section" class="space-y-1 hidden">
              <label class="text-[10px] font-bold text-red-600 dark:text-red-400 block">Eigene Gänge (1 Gang pro Zeile):</label>
              <textarea id="new-list-custom-aisles" rows="4" placeholder="1. Obst & Gemüse&#10;2. Kühlung&#10;3. Kasse" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl p-2.5 text-xs font-medium shadow-xs"></textarea>
            </div>

            <div class="space-y-1">
              <label class="text-[11px] font-bold text-stone-700 dark:text-stone-300 block">Emoji</label>
              <div class="grid grid-cols-6 gap-1 p-2 bg-stone-50 dark:bg-stone-800 rounded-2xl border border-stone-200 dark:border-stone-700 max-h-28 overflow-y-auto custom-scrollbar shadow-inner">
                ${EMOJI_PALETTE.map(em => `<button type="button" onclick="selectListEmoji('${em}')" class="w-8 h-8 rounded-xl flex items-center justify-center text-base shadow-xs ${state.newListSelectedIcon===em?'bg-red-600 text-white font-bold':'bg-white dark:bg-stone-700 border border-stone-200 dark:border-stone-600'}">${em}</button>`).join('')}
              </div>
            </div>
            <div class="flex justify-end gap-2 pt-2 border-t border-stone-100 dark:border-stone-800">
              <button onclick="closeNewListModal();" class="px-3 py-1.5 text-xs text-stone-600 dark:text-stone-400 font-medium">Abbrechen</button>
              <button onclick="createNewList();" class="bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold px-3 py-1.5 rounded-xl shadow-xs">Anlegen</button>
            </div>
          </div>
        </div>
      `;
    }

    if (state.showNewAisleModal) {
      html += `
        <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl max-w-sm w-full p-4 shadow-2xl space-y-3 text-stone-900 dark:text-stone-100">
            <div class="flex justify-between items-center pb-1 border-b border-stone-100 dark:border-stone-800"><h3 class="font-extrabold text-xs">Neuen Gang anlegen</h3><button onclick="state.showNewAisleModal=false; render();">✕</button></div>
            <div><label class="text-[11px] font-bold text-stone-700 dark:text-stone-300 block mb-1">Gang-Nummer</label><input type="number" id="new-aisle-num" value="${activeAisles.length+1}" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-3 py-2 text-xs font-bold shadow-xs" /></div>
            <div><label class="text-[11px] font-bold text-stone-700 dark:text-stone-300 block mb-1">Bezeichnung</label><input type="text" id="new-aisle-name" placeholder="z.B. Bio" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-3 py-2 text-xs font-semibold shadow-xs" /></div>
            <div class="flex justify-end gap-2 pt-2 border-t border-stone-100 dark:border-stone-800">
              <button onclick="state.showNewAisleModal=false; render();" class="px-3 py-1.5 text-xs text-stone-600 dark:text-stone-400 font-medium">Abbrechen</button>
              <button onclick="createNewAisle();" class="bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold px-3 py-1.5 rounded-xl shadow-xs">Anlegen</button>
            </div>
          </div>
        </div>
      `;
    }

    if (state.showNewPantryModal) {
      const pantryModalAisles = MARKET_AISLES['penny'];
      html += `
        <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl max-w-sm w-full p-4 shadow-2xl space-y-3 relative text-stone-900 dark:text-stone-100">
            <h3 class="font-extrabold text-xs">Neuen Vorrat anlegen</h3>
            <div class="relative">
              <input type="text" id="new-pantry-name" value="${state.pantrySearchQuery||''}" oninput="handlePantrySearchInput(this.value)" placeholder="Produkt suchen..." class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:border-red-600 shadow-xs" />
              <div id="pantry-search-dropdown" class="hidden absolute left-0 right-0 top-full mt-1 bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-xl shadow-xl z-50 max-h-36 overflow-y-auto custom-scrollbar"></div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-[10px] font-bold text-red-600 dark:text-red-400 block mb-1">🛒 Einkaufseinheit</label>
                <select id="new-pantry-shopunit" class="w-full bg-red-50 dark:bg-red-950/40 border border-red-200 rounded-xl px-2 py-1.5 text-xs font-bold text-red-600 shadow-xs">
                  ${COMMON_UNITS.map(u => `<option value="${u}" ${u==='Packung'?'selected':''}>${u}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="text-[10px] font-bold text-stone-600 dark:text-stone-400 block mb-1">Schrank-Einheit</label>
                <select id="new-pantry-pantryunit" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-2 py-1.5 text-xs font-semibold shadow-xs">
                  ${COMMON_UNITS.map(u => `<option value="${u}" ${u==='Stk.'?'selected':''}>${u}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div><label class="text-[10px] font-bold text-stone-600 dark:text-stone-400 block mb-1">Ist-Menge im Schrank</label><input type="number" id="new-pantry-pieces" min="0" value="10" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-2.5 py-1.5 text-xs font-bold shadow-xs" /></div>
              <div><label class="text-[10px] font-bold text-stone-600 dark:text-stone-400 block mb-1">Min. Menge (Warnung)</label><input type="number" id="new-pantry-min" min="1" value="2" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-2.5 py-1.5 text-xs font-bold shadow-xs" /></div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div><label class="text-[10px] font-bold text-red-600 dark:text-red-400 block mb-1">Anzahl Packungen kaufen</label><input type="number" id="new-pantry-buyqty" min="1" value="1" class="w-full bg-red-50 dark:bg-red-950/40 border border-red-200 text-red-600 rounded-xl px-2.5 py-1.5 text-xs font-bold shadow-xs" /></div>
              <div><label class="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 block mb-1">Inhalt pro Packung</label><input type="number" id="new-pantry-perpack" min="1" value="10" class="w-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-emerald-800 rounded-xl px-2.5 py-1.5 text-xs font-bold shadow-xs" /></div>
            </div>
            <div><label class="text-[10px] font-bold text-stone-600 dark:text-stone-400 block mb-1">Verbrauch / Tag (Fest)</label><input type="number" step="0.1" id="new-pantry-daily" min="0.1" value="3" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-2.5 py-1.5 text-xs shadow-xs" /></div>
            
            <div class="flex items-center gap-2 mt-2">
              <input type="checkbox" id="new-pantry-intervall" checked class="w-4 h-4 rounded text-red-600 cursor-pointer" />
              <label for="new-pantry-intervall" class="text-[10px] font-bold text-stone-700 dark:text-stone-300 cursor-pointer">
                Täglicher Verbrauch aktiv (Zyklus)
              </label>
            </div>

            <select id="new-pantry-aisle" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-3 py-2 text-xs font-semibold shadow-xs">
              ${pantryModalAisles.map(a => `<option value="${a.number}" ${a.number===12?'selected':''}>${a.name}</option>`).join('')}
            </select>
            <div class="flex justify-end gap-2 pt-2 border-t border-stone-100 dark:border-stone-800">
              <button onclick="state.showNewPantryModal=false; state.pantrySearchQuery=''; render();" class="px-3 py-1.5 text-xs text-stone-600 dark:text-stone-400 font-medium">Abbrechen</button>
              <button onclick="saveNewPantryItem();" class="bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold px-3.5 py-1.5 rounded-xl shadow-xs">Speichern</button>
            </div>
          </div>
        </div>
      `;
    }

    if (state.editingPantryModalItem) {
      const item = state.editingPantryModalItem;
      const currentPantryAisle = item.aisleNumber || getProductAisleForMarket(item.name, 'penny');
      const pantryEditModalAisles = MARKET_AISLES['penny'];
      html += `
        <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl max-w-sm w-full p-4 shadow-2xl space-y-3 text-stone-900 dark:text-stone-100">
            <div class="flex justify-between items-center pb-1 border-b border-stone-100 dark:border-stone-800"><h3 class="font-extrabold text-xs">Vorrat bearbeiten</h3><button onclick="state.editingPantryModalItem=null; render();">✕</button></div>
            <div><label class="text-[11px] font-bold text-stone-700 dark:text-stone-300 block mb-1">Name</label><input type="text" id="edit-pantry-name" value="${item.name}" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-3 py-2 text-xs font-bold shadow-xs" /></div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-[10px] font-bold text-red-600 dark:text-red-400 block mb-1">🛒 Einkaufseinheit</label>
                <select id="edit-pantry-shopunit" class="w-full bg-red-50 dark:bg-red-950/40 border border-red-200 rounded-xl px-2 py-1.5 text-xs font-bold text-red-600 shadow-xs">
                  ${COMMON_UNITS.map(u => `<option value="${u}" ${u===(item.shopUnit||'Packung')?'selected':''}>${u}</option>`).join('')}
                </select>
              </div>
              <div>
                <label class="text-[10px] font-bold text-stone-600 dark:text-stone-400 block mb-1">Schrank-Einheit</label>
                <select id="edit-pantry-pantryunit" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-2 py-1.5 text-xs font-semibold shadow-xs">
                  ${COMMON_UNITS.map(u => `<option value="${u}" ${u===(item.pantryUnit||'Stk.')?'selected':''}>${u}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div><label class="text-[10px] font-bold text-stone-700 dark:text-stone-300 block mb-1">Ist-Menge im Schrank</label><input type="number" id="edit-pantry-pieces" value="${item.totalPieces||0}" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-2.5 py-1.5 text-xs font-bold shadow-xs" /></div>
              <div><label class="text-[10px] font-bold text-stone-700 dark:text-stone-300 block mb-1">Min. Menge (Warnung)</label><input type="number" id="edit-pantry-min" value="${item.minPieces||1}" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-2.5 py-1.5 text-xs font-bold shadow-xs" /></div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div><label class="text-[10px] font-bold text-red-600 dark:text-red-400 block mb-1">Anzahl Packungen kaufen</label><input type="number" id="edit-pantry-buyqty" min="1" value="${item.buyQty||1}" class="w-full bg-red-50 dark:bg-red-950/40 border border-red-200 text-red-600 rounded-xl px-2.5 py-1.5 text-xs font-bold shadow-xs" /></div>
              <div><label class="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 block mb-1">Inhalt pro Packung</label><input type="number" id="edit-pantry-perpack" min="1" value="${item.itemsPerPack||10}" class="w-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-emerald-800 rounded-xl px-2.5 py-1.5 text-xs font-bold shadow-xs" /></div>
            </div>
            <div><label class="text-[10px] font-bold text-stone-700 dark:text-stone-300 block mb-1">Verbrauch / Tag (Fest)</label><input type="number" step="0.1" id="edit-pantry-daily" value="${item.dailyConsumption||3}" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-2.5 py-1.5 text-xs font-bold shadow-xs" /></div>
            
            <div class="flex items-center gap-2 mt-2">
              <input type="checkbox" id="edit-pantry-intervall" ${item.intervallAktiv !== false ? 'checked' : ''} class="w-4 h-4 rounded text-red-600 cursor-pointer" />
              <label for="edit-pantry-intervall" class="text-[10px] font-bold text-stone-700 dark:text-stone-300 cursor-pointer">
                Täglicher Verbrauch aktiv (Zyklus)
              </label>
            </div>

            <div>
              <label class="text-[11px] font-bold text-stone-700 dark:text-stone-300 block mb-1">Gang</label>
              <select id="edit-pantry-aisle" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-3 py-2 text-xs font-semibold shadow-xs">
                ${pantryEditModalAisles.map(a => `<option value="${a.number}" ${parseInt(currentPantryAisle,10)===parseInt(a.number,10)?'selected':''}>${a.name}</option>`).join('')}
              </select>
            </div>
            <div class="flex justify-end gap-2 pt-2 border-t border-stone-100 dark:border-stone-800">
              <button onclick="state.editingPantryModalItem=null; render();" class="px-3 py-1.5 text-xs text-stone-600 dark:text-stone-400 font-medium">Abbrechen</button>
              <button onclick="saveEditPantryModal('${item.id}');" class="bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold px-3.5 py-1.5 rounded-xl shadow-xs">Speichern</button>
            </div>
          </div>
        </div>
      `;
    }

    if (state.editingModalItem) {
      const item = state.editingModalItem, curUnit = item.packageUnit || 'Packung', mult = parsePackMultiplier(curUnit);
      const bPrice = getBaseUnitPrice(item.name, item.estimatedPrice || 0), curDep = item.depositAmount !== undefined ? item.depositAmount : getBaseUnitDeposit(item.name, 0);
      const promoVal = (item.promoPrice !== undefined && item.promoPrice !== null) ? item.promoPrice : '';
      const promoPercVal = (item.promoPercent !== undefined && item.promoPercent !== null) ? item.promoPercent : '';
      const isFavEdit = isFavoriteItem(item.name) || isFavoriteItem(item.id);
      const itemAisleVal = getProductAisleForMarket(item.name, marketKey);
      const editImg = item.imageUrl || getProductImageUrl(item.name);
      html += `
        <div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1a1a1a] border border-stone-200 dark:border-stone-800 rounded-3xl max-w-md w-full p-4 shadow-2xl space-y-3 max-h-[90vh] overflow-y-auto custom-scrollbar text-stone-900 dark:text-stone-100">
            <div class="flex justify-between items-center pb-2 border-b border-stone-100 dark:border-stone-800">
              <div class="flex items-center gap-2">
                <h3 class="font-extrabold text-xs">Artikel bearbeiten</h3>
                <button onclick="toggleFavorite('${item.name.replace(/'/g, "\\'")}');" class="sm:inline-block text-sm ${isFavEdit?'text-amber-500 font-black':'text-stone-300 dark:text-stone-600'}">${isFavEdit?'★':'☆'}</button>
              </div>
              <button onclick="state.editingModalItem=null; render();">✕</button>
            </div>
            ${editImg ? `<div class="flex justify-center"><img src="${editImg}" class="w-16 h-16 object-cover rounded-2xl border border-stone-200 shadow-sm" /></div>` : ''}
            <div><label class="text-[11px] font-bold text-stone-700 dark:text-stone-300 block mb-1">Name</label><input type="text" id="edit-item-name" value="${item.name}" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-3 py-2 text-xs font-bold shadow-xs" /></div>
            <div>
              <label class="text-[11px] font-bold text-stone-700 dark:text-stone-300 block mb-1">Einheit</label>
              <select id="edit-item-unit" onchange="updateModalPackCalculation()" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-3 py-2 text-xs font-semibold shadow-xs">
                ${COMMON_UNITS.map(u => `<option value="${u}" ${u===curUnit?'selected':''}>${u}</option>`).join('')}
              </select>
            </div>
            <div class="bg-stone-50 dark:bg-stone-800/50 p-3 rounded-2xl border border-stone-200 dark:border-stone-700 space-y-1 shadow-inner">
              <div class="flex justify-between items-center"><label class="text-xs font-bold text-stone-800 dark:text-stone-200">Standard-Preis (€)</label><span id="modal-pack-indicator" class="text-[10px] font-bold ${mult>1?'text-amber-600':'text-stone-400'}">${mult>1?`×${mult}`:'1 Stk.'}</span></div>
              <input type="number" step="0.01" id="edit-item-price" value="${bPrice}" oninput="updateModalPackCalculation()" class="w-full bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 border border-stone-200 dark:border-stone-700 rounded-xl px-2.5 py-1.5 text-xs font-bold shadow-xs" />
            </div>
            
            <div class="bg-red-50 dark:bg-red-950/20 p-3 rounded-2xl border border-red-200 dark:border-red-900/40 space-y-2 shadow-inner">
              <div class="flex justify-between items-center">
                <label class="text-xs font-extrabold text-red-700 dark:text-red-400">⚡ Angebot / Rabatt</label>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <label class="text-[10px] font-bold text-stone-600 dark:text-stone-400 block mb-1">Aktionspreis (€)</label>
                  <input type="number" step="0.01" id="edit-item-promo" value="${promoVal}" oninput="document.getElementById('edit-item-promopercent').value=''; updateModalPackCalculation();" placeholder="z.B. 0.99" class="w-full bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 border border-red-300 dark:border-red-800 rounded-xl px-2.5 py-1.5 text-xs font-bold text-red-600 shadow-xs" />
                </div>
                <div>
                  <label class="text-[10px] font-bold text-stone-600 dark:text-stone-400 block mb-1">Rabatt in %</label>
                  <input type="number" step="1" min="0" max="100" id="edit-item-promopercent" value="${promoPercVal}" oninput="document.getElementById('edit-item-promo').value=''; updateModalPackCalculation();" placeholder="z.B. 30" class="w-full bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 border border-red-300 dark:border-red-800 rounded-xl px-2.5 py-1.5 text-xs font-bold text-red-600 shadow-xs" />
                </div>
              </div>
              <div class="flex gap-1 overflow-x-auto custom-scrollbar py-0.5">
                <button type="button" onclick="setModalDiscountPercent(10)" class="px-2 py-1 text-[10px] font-bold bg-white dark:bg-stone-800 border border-red-200 dark:border-stone-700 rounded-lg text-red-700 dark:text-red-300 shrink-0 shadow-xs">-10%</button>
                <button type="button" onclick="setModalDiscountPercent(20)" class="px-2 py-1 text-[10px] font-bold bg-white dark:bg-stone-800 border border-red-200 dark:border-stone-700 rounded-lg text-red-700 dark:text-red-300 shrink-0 shadow-xs">-20%</button>
                <button type="button" onclick="setModalDiscountPercent(30)" class="px-2 py-1 text-[10px] font-bold bg-white dark:bg-stone-800 border border-red-200 dark:border-stone-700 rounded-lg text-red-700 dark:text-red-300 shrink-0 shadow-xs">-30%</button>
                <button type="button" onclick="setModalDiscountPercent(50)" class="px-2 py-1 text-[10px] font-bold bg-white dark:bg-stone-800 border border-red-200 dark:border-stone-700 rounded-lg text-red-700 dark:text-red-300 shrink-0 shadow-xs">-50%</button>
                <button type="button" onclick="clearModalDiscount()" class="px-2 py-1 text-[10px] font-bold bg-stone-100 dark:bg-stone-800 border border-stone-300 dark:border-stone-700 rounded-lg text-stone-600 dark:text-stone-400 shrink-0 shadow-xs">Kein Rabatt</button>
              </div>
              <div class="pt-1 text-[10px] flex justify-between border-t border-red-200 dark:border-red-900/40 mt-1 font-bold text-red-800 dark:text-red-300"><span>Gesamtpreis:</span><span class="font-black text-red-600 dark:text-red-400" id="modal-calc-total-price">0.00 €</span></div>
            </div>

            <div class="bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-2xl border border-emerald-200 dark:border-emerald-900/50 space-y-1 shadow-inner">
              <div class="flex justify-between items-center"><label class="text-xs font-extrabold text-emerald-950 dark:text-emerald-300">Pfand (€)</label></div>
              <div class="flex items-center gap-2">
                <input type="number" step="0.01" min="0" id="edit-item-deposit" value="${curDep}" oninput="updateModalPackCalculation()" class="w-20 bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 border border-emerald-300 dark:border-emerald-700 rounded-xl px-2.5 py-1.5 text-xs font-bold shadow-xs" />
                <div class="flex gap-1 overflow-x-auto custom-scrollbar flex-1 py-0.5">
                  <button onclick="setModalDeposit(0.25)" class="px-2 py-1 text-[10px] font-bold bg-white dark:bg-stone-700 border dark:border-stone-600 rounded-lg text-emerald-900 dark:text-emerald-300 shrink-0 shadow-xs">0,25 €</button>
                  <button onclick="setModalDeposit(0.15)" class="px-2 py-1 text-[10px] font-bold bg-white dark:bg-stone-700 border dark:border-stone-600 rounded-lg text-emerald-900 dark:text-emerald-300 shrink-0 shadow-xs">0,15 €</button>
                  <button onclick="setModalDeposit(0.00)" class="px-2 py-1 text-[10px] font-bold bg-white dark:bg-stone-700 border dark:border-stone-600 rounded-lg text-stone-600 dark:text-stone-300 shrink-0 shadow-xs">0,00 €</button>
                </div>
              </div>
              <div class="pt-1 text-[10px] text-emerald-800 dark:text-emerald-400 flex justify-between border-t border-emerald-200 dark:border-emerald-900/50 mt-1 font-bold"><span>Gesamtpfand:</span><span class="font-bold text-emerald-950 dark:text-emerald-300" id="modal-calc-total-deposit">0.00 €</span></div>
            </div>
            <div>
              <label class="text-[11px] font-bold text-stone-700 dark:text-stone-300 block mb-1">Gang</label>
              <select id="edit-item-aisle" class="w-full bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 rounded-xl px-3 py-2 text-xs font-semibold shadow-xs">
                ${activeAisles.map(a => `<option value="${a.number}" ${parseInt(itemAisleVal,10)===parseInt(a.number,10)?'selected':''}>${a.name}</option>`).join('')}
              </select>
            </div>
            <div class="flex justify-end gap-2 pt-2 border-t border-stone-100 dark:border-stone-800">
              <button onclick="state.editingModalItem=null; render();" class="px-3 py-1.5 text-xs text-stone-600 dark:text-stone-400 font-medium">Abbrechen</button>
              <button onclick="saveEditItemModal('${item.id}');" class="bg-red-600 hover:bg-red-700 text-white text-xs font-extrabold px-3.5 py-1.5 rounded-xl shadow-xs">Speichern</button>
            </div>
          </div>
        </div>
      `;
      setTimeout(updateModalPackCalculation, 50);
    }

    app.innerHTML = html;
  } catch (err) {}
}

function getFilteredDbHtml(marketKey) {
  const dbItems = getCatalog(), fQ = (state.dbSearchFilter || '').toLowerCase().trim();
  const filteredDb = fQ ? dbItems.filter(p => p.name.toLowerCase().includes(fQ)) : dbItems;
  if (filteredDb.length === 0) {
    return `<div class="p-3 text-xs text-stone-500 text-center font-medium">Kein Artikel gefunden</div>`;
  }
  return filteredDb.map(p => {
    const aNum = getProductAisleForMarket(p.name, marketKey), curP = getBaseUnitPrice(p.name, p.defaultPrice || 0);
    const pImg = p.imageUrl || getProductImageUrl(p.name);
    return `
      <div class="pt-2 pb-1 flex justify-between items-center gap-2 text-xs hover:bg-stone-50 dark:hover:bg-stone-800/60 px-2 rounded-xl">
        <div class="flex items-center gap-2.5 min-w-0 flex-1">
          ${pImg ? `<img src="${pImg}" class="w-8 h-8 object-cover rounded-xl shrink-0" />` : ''}
          <div class="min-w-0 flex-1">
            <span class="font-bold text-stone-900 dark:text-stone-100 leading-snug break-words block">${p.name}</span>
            <span class="text-stone-500 text-[10px] block truncate font-medium">Gang ${aNum} • Einheit: <b>${p.shopUnit||'Packung'}</b> • ${curP.toFixed(2)}€</span>
          </div>
        </div>
        <button onclick="purgeProductFromDatabase('${p.id}');" class="px-2.5 py-1 bg-red-50 hover:bg-red-600 hover:text-white text-red-600 rounded-xl text-xs font-bold border border-red-200 shrink-0 shadow-xs">🗑</button>
      </div>
    `;
  }).join('');
}

function purgeProduct(idOrName) {
  purgeProductFromDatabase(idOrName);
}

function purgeProductFromDatabase(idOrName) {
  const db = getCatalog();
  let target = db.find(p => p.id === idOrName || p.name.toLowerCase().trim() === String(idOrName).toLowerCase().trim());
  
  const targetName = target ? target.name : idOrName;
  const targetId = target ? target.id : idOrName;

  if (!state.deletedMasterIds.includes(targetId)) {
    state.deletedMasterIds.push(targetId);
  }
  if (!state.deletedMasterIds.includes(targetName.toLowerCase().trim())) {
    state.deletedMasterIds.push(targetName.toLowerCase().trim());
  }

  state.customProducts = state.customProducts.filter(cp => cp.id !== targetId && cp.name.toLowerCase().trim() !== targetName.toLowerCase().trim());
  
  state.favorites = cleanDuplicateList(state.favorites.filter(f => {
    const fKey = (typeof f === 'string' ? f : (f.name || f)).toLowerCase().trim();
    return fKey !== targetName.toLowerCase().trim();
  }));

  soundDelete();
  showToast(`"${targetName}" aus Datenbank gelöscht 🗑`);
  saveState();
  render();
}

function setModalDeposit(v) {
  const el = document.getElementById('edit-item-deposit');
  if (el) { el.value = v.toFixed(2); updateModalPackCalculation(); }
}

function setModalDiscountPercent(percent) {
  const pPercentEl = document.getElementById('edit-item-promopercent');
  const pPriceEl = document.getElementById('edit-item-promo');
  if (pPercentEl && pPriceEl) {
    pPriceEl.value = '';
    pPercentEl.value = percent;
    updateModalPackCalculation();
  }
}

function clearModalDiscount() {
  const pPercentEl = document.getElementById('edit-item-promopercent');
  const pPriceEl = document.getElementById('edit-item-promo');
  if (pPercentEl && pPriceEl) {
    pPercentEl.value = '';
    pPriceEl.value = '';
    updateModalPackCalculation();
  }
}

function updateModalPackCalculation() {
  const unitEl = document.getElementById('edit-item-unit');
  const priceEl = document.getElementById('edit-item-price');
  const promoEl = document.getElementById('edit-item-promo');
  const promoPercEl = document.getElementById('edit-item-promopercent');
  const depositEl = document.getElementById('edit-item-deposit');
  const totalDisplay = document.getElementById('modal-calc-total-price');
  const depositDisplay = document.getElementById('modal-calc-total-deposit');
  const indicator = document.getElementById('modal-pack-indicator');

  if (!priceEl) return;
  const unit = unitEl ? unitEl.value : 'Packung';
  const mult = parsePackMultiplier(unit);
  if (indicator) {
    indicator.innerText = mult > 1 ? `×${mult}` : '1 Stk.';
  }

  const basePrice = parseFloat(priceEl.value) || 0;
  let effSinglePrice = basePrice;

  const promoVal = promoEl ? parseFloat(promoEl.value) : NaN;
  const promoPercVal = promoPercEl ? parseFloat(promoPercEl.value) : NaN;

  if (!isNaN(promoVal) && promoVal >= 0) {
    effSinglePrice = promoVal;
  } else if (!isNaN(promoPercVal) && promoPercVal > 0) {
    effSinglePrice = basePrice * (1 - (promoPercVal / 100));
  }

  const singleDep = depositEl ? parseFloat(depositEl.value) || 0 : 0;
  const unitPrice = mult > 1 ? effSinglePrice * mult : effSinglePrice;
  const unitDep = mult > 1 && singleDep > 0 ? singleDep * mult : singleDep;

  if (totalDisplay) totalDisplay.innerText = unitPrice.toFixed(2) + ' €';
  if (depositDisplay) depositDisplay.innerText = unitDep.toFixed(2) + ' €';
}

function openEditItemModal(id) {
  const item = state.items.find(i => i.id === id);
  if (item) { state.editingModalItem = item; render(); }
}

function saveEditItemModal(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  const nameInp = document.getElementById('edit-item-name');
  const unitSel = document.getElementById('edit-item-unit');
  const priceInp = document.getElementById('edit-item-price');
  const promoInp = document.getElementById('edit-item-promo');
  const promoPercInp = document.getElementById('edit-item-promopercent');
  const depositInp = document.getElementById('edit-item-deposit');
  const aisleSel = document.getElementById('edit-item-aisle');

  const oldName = item.name;
  const newName = nameInp ? nameInp.value.trim() : item.name;
  if (!newName) return;

  item.name = newName;
  if (unitSel) item.packageUnit = unitSel.value;
  if (aisleSel) item.aisleNumber = parseInt(aisleSel.value, 10) || item.aisleNumber;

  const pVal = priceInp ? parseFloat(priceInp.value) : NaN;
  if (!isNaN(pVal)) {
    item.estimatedPrice = pVal;
    state.savedPrices[newName] = pVal;
  }

  const promoVal = promoInp && promoInp.value.trim() !== '' ? parseFloat(promoInp.value) : null;
  const promoPercVal = promoPercInp && promoPercInp.value.trim() !== '' ? parseFloat(promoPercInp.value) : null;

  item.promoPrice = !isNaN(promoVal) ? promoVal : null;
  item.promoPercent = !isNaN(promoPercVal) ? promoPercVal : null;

  const dVal = depositInp ? parseFloat(depositInp.value) : NaN;
  if (!isNaN(dVal)) {
    item.depositAmount = dVal;
    state.savedDeposits[newName] = dVal;
  }

  if (state.scannedBarcodeData && state.scannedBarcodeData.barcode) {
    const activeBarcode = state.scannedBarcodeData.barcode;
    state.savedBarcodes[activeBarcode] = newName;
  }

  persistProduct({ name: newName, shopUnit: item.packageUnit, defaultPrice: item.estimatedPrice, depositAmount: item.depositAmount, aisleNumber: item.aisleNumber, imageUrl: item.imageUrl }, oldName);

  state.editingModalItem = null;
  soundAdd();
  saveState();
  showToast('Artikel aktualisiert ✓');
  render();
}

function openEditPantryModal(id) {
  const item = state.pantry.find(i => i.id === id);
  if (item) { state.editingPantryModalItem = item; render(); }
}

function saveEditPantryModal(id) {
  const item = state.pantry.find(i => i.id === id);
  if (!item) return;

  const nameInp = document.getElementById('edit-pantry-name');
  const shopUnitSel = document.getElementById('edit-pantry-shopunit');
  const pantryUnitSel = document.getElementById('edit-pantry-pantryunit');
  const piecesInp = document.getElementById('edit-pantry-pieces');
  const minInp = document.getElementById('edit-pantry-min');
  const buyQtyInp = document.getElementById('edit-pantry-buyqty');
  const perPackInp = document.getElementById('edit-pantry-perpack');
  const dailyInp = document.getElementById('edit-pantry-daily');
  const intervallInp = document.getElementById('edit-pantry-intervall');

  const aisleSel = document.getElementById('edit-pantry-aisle');

  const oldName = item.name;
  const newName = nameInp ? nameInp.value.trim() : item.name;
  if (!newName) return;

  item.name = newName;
  if (shopUnitSel) item.shopUnit = shopUnitSel.value;
  if (pantryUnitSel) item.pantryUnit = pantryUnitSel.value;
  if (piecesInp) item.totalPieces = parseFloat(piecesInp.value) || 0;
  if (minInp) item.minPieces = parseFloat(minInp.value) || 1;
  if (buyQtyInp) item.buyQty = parseInt(buyQtyInp.value, 10) || 1;
  if (perPackInp) item.itemsPerPack = parseInt(perPackInp.value, 10) || 1;
  if (dailyInp) item.dailyConsumption = parseFloat(dailyInp.value) || 0.5;
  if (intervallInp) item.intervallAktiv = intervallInp.checked;

  if (aisleSel) item.aisleNumber = parseInt(aisleSel.value, 10) || item.aisleNumber;

  if (state.scannedBarcodeData && state.scannedBarcodeData.barcode) {
    state.savedBarcodes[state.scannedBarcodeData.barcode] = newName;
  }

  persistProduct({ name: newName, shopUnit: item.shopUnit, aisleNumber: item.aisleNumber }, oldName);

  state.editingPantryModalItem = null;
  item.lastChecked = Date.now();
  item.lastUpdateDate = getTodayString();
  soundAdd();
  saveState();
  showToast('Vorrat aktualisiert ✓');
  render();
}

function changePantryAisle(id, newAisle) {
  const item = state.pantry.find(i => i.id === id);
  if (item) {
    item.aisleNumber = parseInt(newAisle, 10);
    saveState();
    showToast('Gang geändert ✓');
    render();
  }
}

function updateFavoriteName(oldName, newName) {
  const trimmed = newName.trim();
  if (!trimmed) return;
  const lowerOld = oldName.toLowerCase().trim();
  
  state.favorites = state.favorites.map(f => {
    const fKey = (typeof f === 'string' ? f : (f.name || f)).toLowerCase().trim();
    return fKey === lowerOld ? trimmed : f;
  });
  state.favorites = cleanDuplicateList(state.favorites);
  soundAdd();
  saveState();
  showToast('Favorit umbenannt ✓');
  render();
}

function updateFavoriteUnit(favName, newUnit) {
  const db = getCatalog();
  let prod = db.find(p => p.name.toLowerCase().trim() === favName.toLowerCase().trim());
  if (prod) {
    prod.shopUnit = newUnit;
    persistProduct(prod);
  }
  soundAdd();
  saveState();
  showToast('Einheit aktualisiert ✓');
  render();
}

function updateAisleName(aisleId, newName) {
  const mk = getActiveMarketKey();
  const activeAisles = getActiveAisles();
  const aisle = activeAisles.find(a => a.id === aisleId);
  if (aisle) {
    aisle.name = newName.trim();
    state.customMarketAisles[mk] = activeAisles;
    saveState();
    showToast('Gang umbenannt ✓');
  }
}

function moveAisle(index, direction) {
  const mk = getActiveMarketKey();
  let activeAisles = getActiveAisles();
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= activeAisles.length) return;
  
  const temp = activeAisles[index];
  activeAisles[index] = activeAisles[targetIndex];
  activeAisles[targetIndex] = temp;

  activeAisles.forEach((a, idx) => { a.orderIndex = idx + 1; });
  state.customMarketAisles[mk] = activeAisles;
  saveState();
  render();
}

function generateWhatsAppMessage() {
  const curList = state.lists.find(l => l.id === state.activeListId) || state.lists[0];
  const curItems = state.items.filter(i => (i.listId || 'list-penny') === state.activeListId);
  openItems = curItems.filter(i => !i.isChecked);
  
  if (openItems.length === 0) return `🛒 Meine Einkaufsliste (${curList.name}) ist aktuell leer!`;

  let text = `🛒 Einkaufsliste (${curList.name}):\n\n`;
  openItems.forEach(i => {
    text += `• ${i.quantity}x ${i.name} [${i.packageUnit||'Packung'}]\n`;
  });
  text += `\nErstellt mit meiner Einkaufsapp`;
  return text;
}
let html5QrCode = null;

function openBarcodeScannerModal() {
  state.showScannerModal = true;
  render();
  
  setTimeout(() => {
    startScannerCamera();
  }, 300);
}

function closeBarcodeScannerModal() {
  if (html5QrCode) {
    html5QrCode.stop().then(() => {
      html5QrCode.clear();
      html5QrCode = null;
    }).catch(err => {
      html5QrCode = null;
    });
  }
  state.showScannerModal = false;
  render();
}

function startScannerCamera() {
  const scannerContainerId = "reader";
  if (!document.getElementById(scannerContainerId)) return;

  html5QrCode = new Html5Qrcode(scannerContainerId);
  const config = { fps: 10, qrbox: { width: 250, height: 150 } };

  html5QrCode.start(
    { facingMode: "environment" },
    config,
    async (decodedText, decodedResult) => {
      const barcode = decodedText.trim();
      
      await html5QrCode.stop();
      html5QrCode.clear();
      html5QrCode = null;
      state.showScannerModal = false;
      
      showToast(`Barcode erkannt: ${barcode}. Prüfe Datenbank... 🔍`);
      fetchProductByBarcode(barcode);
    },
    (errorMessage) => {}
  ).catch(err => {
    showToast("Kamera konnte nicht gestartet werden ❌");
  });
}

async function fetchProductByBarcode(barcode) {
  try {
    if (state.savedBarcodes && state.savedBarcodes[barcode]) {
      const rememberedName = state.savedBarcodes[barcode];
      const rememberedImg = state.savedImages ? state.savedImages[rememberedName] : '';
      showToast(`✨ Bekannter Barcode! Erkannt als: "${rememberedName}"`);
      handleScannedProductNameResolved(rememberedName, barcode, rememberedImg);
      return;
    }

    const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    
    if (!response.ok) {
      promptUnknownBarcode(barcode, "Neues Produkt", "");
      return;
    }

    const data = await response.json();

    if (data.status === 1 && data.product) {
      const rawApiName = (data.product.product_name || data.product.brands || `Produkt ${barcode}`).trim();
      const frontImgUrl = data.product.image_front_small_url || data.product.image_small_url || data.product.image_url || '';
      
      const catalog = getCatalog();
      const lowerApiName = rawApiName.toLowerCase();
      const queryWords = lowerApiName.split(/\s+/).filter(w => w.length > 2);
      
      const matchingCandidates = catalog.filter(p => {
        const pNameLower = p.name.toLowerCase();
        if (pNameLower.includes(lowerApiName) || lowerApiName.includes(pNameLower)) return true;
        return queryWords.some(w => pNameLower.includes(w));
      });

      if (matchingCandidates.length > 0) {
        state.scannedBarcodeData = { barcode, rawName: rawApiName, imageUrl: frontImgUrl };
        state.barcodeMatchCandidates = matchingCandidates.slice(0, 5);
        state.showBarcodeMatchModal = true;
        soundAdd();
        render();
      } else {
        handleScannedProductNameResolved(rawApiName, barcode, frontImgUrl);
      }
    } else {
      promptUnknownBarcode(barcode, `Produkt ${barcode}`, '');
    }
  } catch (err) {
    promptUnknownBarcode(barcode, `Produkt ${barcode}`, '');
  }
}

function promptUnknownBarcode(barcode, defaultName, imageUrl) {
  const customName = prompt(`Barcode ${barcode} nicht in weltweiter Datenbank gefunden. Wie heißt das Produkt?`, defaultName);
  if (customName && customName.trim()) {
    handleScannedProductNameResolved(customName.trim(), barcode, imageUrl);
  }
}

function assignBarcodeToExistingProduct(chosenName) {
  const barcode = state.scannedBarcodeData ? state.scannedBarcodeData.barcode : null;
  const scannedImg = state.scannedBarcodeData ? state.scannedBarcodeData.imageUrl : '';
  state.showBarcodeMatchModal = false;
  handleScannedProductNameResolved(chosenName, barcode, scannedImg);
}

function assignBarcodeAsNewProduct() {
  const raw = state.scannedBarcodeData ? state.scannedBarcodeData.rawName : 'Neues Produkt';
  const scannedImg = state.scannedBarcodeData ? state.scannedBarcodeData.imageUrl : '';
  const customName = prompt("Wie soll dieser Artikel in deiner Datenbank heißen?", raw);
  state.showBarcodeMatchModal = false;
  if (customName && customName.trim()) {
    const barcode = state.scannedBarcodeData ? state.scannedBarcodeData.barcode : null;
    handleScannedProductNameResolved(customName.trim(), barcode, scannedImg);
  }
}

function handleScannedProductNameResolved(finalName, barcode, imageUrl) {
  state.scannedBarcodeData = { barcode, finalName, imageUrl };
  state.showScanIntentModal = true;
  soundAdd();
  render();
}

function executeScanIntent(intent) {
  const scanned = state.scannedBarcodeData;
  if (!scanned) {
    state.showScanIntentModal = false;
    render();
    return;
  }

  const { barcode, imageUrl } = scanned;

  const nameInput = document.getElementById('scan-modal-name-input');
  const priceInput = document.getElementById('scan-modal-price-input');
  const depositInput = document.getElementById('scan-modal-deposit-input');

  const finalName = nameInput ? nameInput.value.trim() : scanned.finalName;
  const enteredPrice = priceInput && priceInput.value.trim() !== '' ? parseFloat(priceInput.value) : null;
  const enteredDeposit = depositInput && depositInput.value.trim() !== '' ? parseFloat(depositInput.value) : 0;

  if (!finalName) {
    state.showScanIntentModal = false;
    render();
    return;
  }

  if (barcode) {
    state.savedBarcodes[barcode] = finalName;
  }

  if (imageUrl) {
    if (!state.savedImages) state.savedImages = {};
    state.savedImages[finalName] = imageUrl;
  }

  if (enteredPrice !== null && !isNaN(enteredPrice)) {
    state.savedPrices[finalName] = enteredPrice;
  }
  if (!isNaN(enteredDeposit)) {
    state.savedDeposits[finalName] = enteredDeposit;
  }

  persistProduct({ 
    name: finalName, 
    defaultPrice: enteredPrice !== null && !isNaN(enteredPrice) ? enteredPrice : undefined,
    depositAmount: !isNaN(enteredDeposit) ? enteredDeposit : undefined,
    imageUrl: imageUrl || ''
  });

  if (intent === 'cart') {
    addItem({ 
      name: finalName, 
      defaultPrice: enteredPrice !== null && !isNaN(enteredPrice) ? enteredPrice : undefined,
      depositAmount: !isNaN(enteredDeposit) ? enteredDeposit : undefined,
      imageUrl: imageUrl || ''
    }, 1);
    showToast(`🛒 "${finalName}" (${enteredPrice !== null ? enteredPrice.toFixed(2) + ' €' : ''}) zur Einkaufsliste hinzugefügt!`);
  } else {
    showToast(`🗄️ "${finalName}" in Produktdatenbank gespeichert!`);
  }

  state.showScanIntentModal = false;
  state.scannedBarcodeData = null;
  saveState();
  render();
}

loadAppState();
