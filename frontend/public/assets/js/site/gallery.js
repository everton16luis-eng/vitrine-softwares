// Galeria com ampliação acessível (teclado: Esc fecha, setas navegam).
const gallery = document.querySelector('[data-gallery]');
if (gallery) {
  const items = [...gallery.querySelectorAll('.gallery-item')].map((fig) => ({
    src: fig.querySelector('img').src, alt: fig.querySelector('img').alt, caption: fig.querySelector('figcaption')?.textContent || ''
  }));
  let index = 0;
  let opener = null;
  let box = null;

  const render = () => {
    const it = items[index];
    box.querySelector('img').src = it.src;
    box.querySelector('img').alt = it.alt;
    box.querySelector('figcaption').textContent = it.caption;
  };
  const close = () => { box?.remove(); box = null; document.removeEventListener('keydown', onKey); opener?.focus(); };
  const move = (d) => { index = (index + d + items.length) % items.length; render(); };
  function onKey(e) {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') move(1);
    if (e.key === 'ArrowLeft') move(-1);
  }

  gallery.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-gallery-open]');
    if (!btn) return;
    opener = btn;
    index = Number(btn.dataset.galleryOpen);
    box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Visualização ampliada');
    box.innerHTML = `<figure class="m-0 text-center"><img alt=""><figcaption></figcaption></figure>
      <button type="button" class="lb-close" aria-label="Fechar">✕</button>
      ${items.length > 1 ? '<button type="button" class="lb-prev" aria-label="Anterior">‹</button><button type="button" class="lb-next" aria-label="Próxima">›</button>' : ''}`;
    document.body.append(box);
    render();
    box.querySelector('.lb-close').addEventListener('click', close);
    box.querySelector('.lb-prev')?.addEventListener('click', () => move(-1));
    box.querySelector('.lb-next')?.addEventListener('click', () => move(1));
    box.addEventListener('click', (ev) => { if (ev.target === box) close(); });
    document.addEventListener('keydown', onKey);
    box.querySelector('.lb-close').focus();
  });
}
