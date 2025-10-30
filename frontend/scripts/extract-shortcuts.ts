/**
 * Keyboard Shortcuts Extractor
 *
 * Extracts keyboard shortcuts from command-palette.tsx and generates
 * a comprehensive markdown reference file.
 *
 * Run with: pnpm ts-node scripts/extract-shortcuts.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Keyboard shortcuts data (extracted from command-palette.tsx)
const shortcuts = [
  {
    category: 'Navigation',
    items: [
      { key: 'G dann K', description: 'Kanban-Ansicht öffnen', path: '/' },
      { key: 'G dann M', description: 'Karten-Ansicht öffnen', path: '/map' },
      { key: 'G dann E', description: 'Ereignis-Auswahl öffnen', path: '/events' },
    ],
  },
  {
    category: 'Aktionen',
    items: [
      { key: 'N', description: 'Neuen Einsatz erstellen' },
      { key: 'E oder Enter', description: 'Ausgewählten Einsatz bearbeiten' },
      { key: 'R oder F5', description: 'Daten aktualisieren' },
      { key: '?', description: 'Tastaturkürzel-Schnellreferenz anzeigen' },
      { key: '⌘K oder Strg+K', description: 'Befehlspalette öffnen (alle Befehle)' },
    ],
  },
  {
    category: 'Suche',
    items: [
      { key: '/', description: 'Einsätze durchsuchen (Fokus auf Suchfeld)' },
      { key: 'P', description: 'Personen durchsuchen' },
      { key: 'M', description: 'Material durchsuchen' },
      { key: 'Esc', description: 'Suchfeld verlassen / Auswahl aufheben' },
    ],
  },
  {
    category: 'Einsatz-Navigation',
    items: [
      { key: '↑ (Pfeil hoch)', description: 'Vorherigen Einsatz auswählen' },
      { key: '↓ (Pfeil runter)', description: 'Nächsten Einsatz auswählen' },
      { key: 'Enter', description: 'Ausgewählten Einsatz bearbeiten' },
      { key: 'Delete oder Backspace', description: 'Ausgewählten Einsatz löschen' },
    ],
  },
  {
    category: 'Status-Änderung',
    items: [
      { key: '> oder .', description: 'Einsatz-Status vorwärts bewegen (nächste Spalte)' },
      { key: '< oder ,', description: 'Einsatz-Status rückwärts bewegen (vorherige Spalte)' },
    ],
  },
  {
    category: 'Fahrzeug-Zuweisung (im Kanban)',
    items: [
      { key: '1', description: 'Erstes Fahrzeug zuweisen/entfernen' },
      { key: '2', description: 'Zweites Fahrzeug zuweisen/entfernen' },
      { key: '3', description: 'Drittes Fahrzeug zuweisen/entfernen' },
      { key: '4', description: 'Viertes Fahrzeug zuweisen/entfernen' },
      { key: '5', description: 'Fünftes Fahrzeug zuweisen/entfernen' },
    ],
  },
  {
    category: 'Priorität',
    items: [
      { key: 'Shift+1', description: 'Priorität auf Normal setzen' },
      { key: 'Shift+2', description: 'Priorität auf Hoch setzen' },
      { key: 'Shift+3', description: 'Priorität auf Kritisch setzen' },
    ],
  },
  {
    category: 'Ansicht',
    items: [
      { key: '[', description: 'Personen-Seitenleiste ein-/ausblenden' },
      { key: ']', description: 'Material-Seitenleiste ein-/ausblenden' },
    ],
  },
];

function generateMarkdown(): string {
  let markdown = `# Tastaturkürzel

KP Rück bietet umfassende Tastaturunterstützung für effizientes Arbeiten ohne Maus.

## Schnellreferenz

**Tipp:** Drücke \`?\` um die Schnellreferenz anzuzeigen oder \`⌘K\` (Mac) / \`Strg+K\` (Windows) für die vollständige Befehlspalette.

`;

  // Add each category
  for (const section of shortcuts) {
    markdown += `## ${section.category}\n\n`;
    markdown += `| Tastenkürzel | Beschreibung |\n`;
    markdown += `|--------------|-------------|\n`;

    for (const item of section.items) {
      markdown += `| \`${item.key}\` | ${item.description} |\n`;
    }

    markdown += `\n`;
  }

  markdown += `## Tipps

### Navigation mit G-Taste
Drücke \`G\` gefolgt von einem Buchstaben, um schnell zwischen Ansichten zu wechseln:
- \`G\` + \`K\` → Kanban
- \`G\` + \`M\` → Map
- \`G\` + \`E\` → Events

### Einsatz-Workflow
1. Drücke \`N\` um einen neuen Einsatz zu erstellen
2. Navigiere mit \`↑\`/\`↓\` durch die Einsätze
3. Drücke \`Enter\` um Details zu bearbeiten
4. Nutze \`>\` und \`<\` um den Status zu ändern
5. Nutze \`1\`-\`5\` um Fahrzeuge zuzuweisen

### Suche
- \`/\` öffnet die Hauptsuche für Einsätze
- Beginne einfach zu tippen, um zu filtern
- \`Esc\` um die Suche zu verlassen

### Befehlspalette (⌘K)
Die Befehlspalette zeigt alle verfügbaren Befehle und ihre Tastaturkürzel.
Sie ist der schnellste Weg, um Funktionen zu finden und auszuführen.

![Command Palette](/help/images/command-palette.png)

## Häufig verwendete Kombinationen

| Aufgabe | Tastenkürzel |
|---------|--------------|
| Schnell einen Einsatz finden | \`/\` → tippen → \`Enter\` |
| Einsatz erstellen und bearbeiten | \`N\` → Formular ausfüllen |
| Zwischen Ansichten wechseln | \`G\` + \`K\`/\`M\`/\`E\` |
| Einsatz weiter bearbeiten | \`↓\`/\`↑\` → \`Enter\` |
| Status schnell ändern | Einsatz auswählen → \`>\` oder \`<\` |

`;

  return markdown;
}

// Create content directory if it doesn't exist
const contentDir = path.join(__dirname, '../content/help');
if (!fs.existsSync(contentDir)) {
  fs.mkdirSync(contentDir, { recursive: true });
}

// Write markdown file
const outputPath = path.join(contentDir, 'keyboard-shortcuts.md');
const markdown = generateMarkdown();
fs.writeFileSync(outputPath, markdown, 'utf-8');

console.log(`✅ Keyboard shortcuts extracted to: ${outputPath}`);
console.log(`📄 Generated ${shortcuts.reduce((acc, cat) => acc + cat.items.length, 0)} shortcuts across ${shortcuts.length} categories`);
