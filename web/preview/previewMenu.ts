import { offerUpdates } from '../src/pwa/update-prompt';
import { requireReload } from '../src/pwa/reload-floor';
import './previewMenu.css';

function button(label: string, action: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', action);
  return element;
}

/**
A small preview-only menu: marks the data as sample data and triggers the states
a service worker or an outdated client would cause on the real host.
*/
export function mountPreviewMenu(): void {
  const menu = document.createElement('details');
  menu.className = 'preview-menu';
  const summary = document.createElement('summary');
  summary.textContent = 'Vorschau · Beispieldaten';
  menu.append(
    summary,
    button('Neue Version anbieten', () =>
      offerUpdates(({ onNeedRefresh }) => {
        onNeedRefresh();
        return async () => window.location.reload();
      }),
    ),
    button('Veraltete Version simulieren', requireReload),
  );
  document.body.append(menu);
}
