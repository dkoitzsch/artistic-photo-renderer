import { ACCEPT_ATTRIBUTE, ACCEPTED_TYPES, importImageAsLayer, openFile } from './import';

function pick(accept: string, onFile: (file: File) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) onFile(file);
  });
  input.click();
}

/** Öffnet den Dateidialog des Browsers (Bilder und Projektdateien → neues Projekt). */
export function openFileDialog(): void {
  pick(ACCEPT_ATTRIBUTE, (file) => void openFile(file));
}

/** Dateidialog für ein weiteres Bild als Ebene im offenen Projekt. */
export function addImageDialog(): void {
  pick(ACCEPTED_TYPES.join(','), (file) => void importImageAsLayer(file));
}
