// ==========================================
// DINO'S EINKAUFS- UND VORRATS-APP (V1.26 - FIX)
// ==========================================

const DB_NAME = 'DinoShoppingDB_v126';
const DB_VERSION = 1;
let db = null;

// Initialisierung der IndexedDB
function initDB() {
    return new Promise((resolve, reject) => {
        if (db) {
            resolve(db);
            return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = (event) => {
            console.error("IndexedDB Fehler:", event.target.error);
            reject(event.target.error);
        };
        
        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains('appData')) {
                database.createObjectStore('appData');
            }
        };
    });
}

// Daten speichern (Zukunftssicher & unbegrenzt groß für Bilder)
async function saveAppState(stateData) {
    try {
        const database = await initDB();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction(['appData'], 'readwrite');
            const store = transaction.objectStore('appData');
            const request = store.put(stateData, 'current_state');
            
            request.onsuccess = () => resolve(true);
            request.onerror = (event) => reject(event.target.error);
        });
    } catch (error) {
        console.error("Fehler beim Speichern in IndexedDB:", error);
    }
}

// Daten laden (Inklusive automatischer Rückwärts-Migration von v125 / v124)
async function loadAppState() {
    try {
        const database = await initDB();
        const state = await new Promise((resolve, reject) => {
            const transaction = database.transaction(['appData'], 'readonly');
            const store = transaction.objectStore('appData');
            const request = store.get('current_state');
            
            request.onsuccess = (event) => resolve(event.target.result);
            request.onerror = (event) => reject(event.target.error);
        });

        if (state) {
            return state; // Aktuelle Daten gefunden
        }

        // Falls noch nichts in v126 liegt, prüfen wir den alten LocalStorage (Migration)
        console.> "Keine v126 Daten gefunden, prüfe ältere Speicher..."
        let oldData = null;
        for (const key of ['dino_app_state_v125', 'dino_app_state_v124', 'shopping_app_state']) {
            const raw = localStorage.getItem(key);
            if (raw) {
                try {
                    oldData = JSON.parse(raw);
                    console.log(`Daten aus ${key} erfolgreich migriert!`);
                    break;
                } catch (e) {
                    console.error("Fehler beim Parsen der alten Daten", e);
                }
            }
        }

        if (oldData) {
            await saveAppState(oldData); // Direkt in die neue DB sichern
            return oldData;
        }

        return null; // Komplett frisch
    } catch (error) {
        console.error("Fehler beim Laden der App-Daten:", error);
        return null;
    }
}

// ==========================================
// ROBUSTE BACKUP-KOPIER-FUNKTION (OHNE FEHLER)
// ==========================================
function copyBackupToClipboard() {
    const textarea = document.getElementById('backupTextarea'); // ID dein Textbereichs im Modal
    if (!textarea) return;

    textarea.select();
    textarea.setSelectionRange(0, 99999); // Für Handys

    try {
        // Moderner Weg via Clipboard API
        navigator.clipboard.writeText(textarea.value).then(() => {
            showNotification("Erfolgreich in die Zwischenablage kopiert! 📋");
        }).catch(() => {
            // Fallback für strikte Handy-Browser
            fallbackCopy(textarea);
        });
    } catch (err) {
        fallbackCopy(textarea);
    }
}

function fallbackCopy(textarea) {
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showNotification("Erfolgreich in die Zwischenablage kopiert! 📋");
        } else {
            showNotification("Bitte Text im Feld lang antippen und manuell kopieren.");
        }
    } catch (err) {
        showNotification("Bitte Text im Feld lang antippen und manuell kopieren.");
    }
}

function showNotification(message) {
    // Falls du bereits eine Benachrichtigungs-Funktion hast, nutzt diese das; ansonsten ein simpler Alert oder Toast
    console.log(message);
    alert(message);
}
