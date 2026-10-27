// Carrega a demonstração correspondente ao produto (apenas módulos conhecidos).
const DEMOS = {
  churchflow: () => import('./churchflow.js'),
  spacecontrol: () => import('./spacecontrol.js'),
  fleetmanager: () => import('./fleetmanager.js')
};

const root = document.getElementById('demo-app');
const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = '/assets/css/demo.css';
document.head.append(link);

if (root) {
  const loader = DEMOS[root.dataset.demo];
  if (!loader) {
    root.textContent = 'Esta demonstração ainda não foi publicada.';
  } else {
    loader().then((m) => m.start(root)).catch(() => { root.textContent = 'Não foi possível carregar a demonstração.'; });
  }
}
