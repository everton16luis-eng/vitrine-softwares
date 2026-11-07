// Nova identidade visual ("prancha técnica"): papel claro, tinta escura, destaque vermelhão.
// Troca SOMENTE as cores que ainda são os padrões da identidade anterior (seed 02 antigo) e atualiza
// as descrições dessas três configurações. Cores escolhidas no painel são preservadas.
import { SETTINGS } from './02-configuracoes.js';

const OLD_COLORS = { cor_primaria: '#0F172A', cor_destaque: '#0EA5E9', cor_secundaria: '#8B5CF6' };

export async function seed(tx) {
  for (const [chave, antigo] of Object.entries(OLD_COLORS)) {
    const [valor, , descricao] = SETTINGS[chave];
    await tx.query('UPDATE configuracoes SET valor = $1 WHERE chave = $2 AND upper(valor #>> \'{}\') = upper($3)',
      [JSON.stringify(valor), chave, antigo]);
    await tx.query('UPDATE configuracoes SET descricao = $1 WHERE chave = $2', [descricao, chave]);
  }
}
