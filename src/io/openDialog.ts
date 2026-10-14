import { ACCEPT_ATTRIBUTE, openFile } from './import';

/** Öffnet den Dateidialog des Browsers (Bilder und Projektdateien). */
export function openFileDialog(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPT_ATTRIBUTE;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void openFile(file);
  });
  input.click();
}
