import { ACCEPT_ATTRIBUTE, importImageFile } from './import';

/** Öffnet den Dateidialog des Browsers und importiert die gewählte Datei. */
export function openImageDialog(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPT_ATTRIBUTE;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void importImageFile(file);
  });
  input.click();
}
