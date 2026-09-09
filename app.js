function buildAppContextPrompt() {
  const curList = state.lists.find(l => l.id === state.activeListId) || state.lists[0];
  const activeListItems = state.items.filter(i => (i.listId || 'list-penny') === state.activeListId);
  const openItems = activeListItems.map(i => `- ${i.quantity}x ${i.name} (${i.packageUnit||'Packung'})`).join('\n');
  const favoritesList = cleanDuplicateList(state.favorites).map(f => (typeof f === 'string' ? f : f.name)).join(', ');
  
  // Exakte Liste des Vorratsschranks für den Bot aufbereiten
  const pantrySummary = state.pantry.map(p => {
    return `- ${p.name}: ${p.totalPieces} ${p.pantryUnit || 'Stk.'}`;
  }).join('\n');

  const allListsInfo = state.lists.map(l => `- Markt/Liste: "${l.name}" (ID: "${l.id}")`).join('\n');
  
  const dbCatalog = getCatalog();
  const catalogSummary = dbCatalog.slice(0, 150).map(p => p.name).join(', ');

  return `Du bist Dinos persönlicher Alltags-, Koch- und Einkaufs-Assistent für Schwarzenbek. 
Du hast Einblick in Dinos Einkaufsliste und den Vorratsschrank.

VERFÜGBARE LISTEN:
[
${allListsInfo}
]

AKTIVE LISTE: "${curList.name}" (ID: "${curList.id}")

OFFENE EINKAUFSLISTE:
[
${openItems || 'Die Einkaufsliste ist leer.'}
]

EXAKTER VORRATSSCHRANK (NUR DAS IST IM HAUS!):
[
${pantrySummary || 'Der Vorratsschrank ist komplett leer.'}
]

PRODUKTDATENBANK:
[ ${catalogSummary} ]

ABSOLUT STRIKTE REGELN FÜR REZEPTE UND ZUTATEN:
1. **Der Vorratsschrank ist Gesetz:** Du darfst NIEMALS annehmen, dass Standard-Zutaten (wie Öl, Salz, Pfeffer, Zwiebeln, Eier, Gewürze etc.) im Haus sind, nur weil man sie zum Kochen braucht! Wenn ein Artikel nicht EXAKT oben in der Liste [EXAKTER VORRATSSCHRANK] steht, ist er NICHT im Haus und muss als fehlend gelistet werden.
2. **Einkaufslisten-Check:** Prüfe, ob eine fehlende Zutat bereits auf der [OFFENE EINKAUFSLISTE] steht. Wenn sie dort schon steht, liste sie nicht doppelt auf.
3. Wenn Dino nach einem Rezept fragt, antworte genau so:
   - "Für das Rezept hast du [Zutaten, die im Vorrat stehen]. Dir fehlen noch folgende Artikel: [Zutaten, die weder im Vorrat noch auf der Einkaufsliste sind]. Soll ich die fehlenden Artikel direkt auf deine Einkaufsliste setzen?"
4. BEFEHL: Stimmt Dino zu ("Ja", "Bitte", "Mach" etc.), gib sofort den Befehl aus:
[ADD_ITEM: {"name": "Exakter Datenbank-Name", "quantity": 1, "listId": "${curList.id}"}]`;
}
