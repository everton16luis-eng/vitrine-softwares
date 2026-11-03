// Execução de uma tarefa: percorre os passos pendentes, grava ponto de controle a cada
// passo e para na primeira falha ou espera. Toda ação concreta no servidor passa pelo
// executor (simulado ou linux), que só oferece operações de uma lista fechada.
import { db } from '../database/pool.js';
import { env } from '../config/env.js';
import { addLog, setEtapa } from '../modules/deployments/deployments.service.js';
import { verifyDomain, checkDns } from '../modules/deployments/domains.service.js';
import { encrypt, decrypt, generateSecret } from '../modules/deployments/secrets.js';
import { resourcesFor, maskSecrets } from '../modules/deployments/policy.js';
import { PASSO_ROTULO } from '../modules/deployments/steps.js';
import { heartbeat, finishTask } from './queue.js';

const MIN = 60_000;

class WaitingForCustomer extends Error {}

async function loadSecrets(id) {
  const rows = await db.many('SELECT chave, valor_cifrado FROM implantacao_segredos WHERE implantacao_id = $1', [id]);
  const map = new Map();
  for (const r of rows) {
    try { map.set(r.chave, decrypt(r.valor_cifrado)); } catch { /* chave trocada: tratado como ausente */ }
  }
  return map;
}

async function ensureSecret(ctx, chave, origem = 'gerado') {
  if (ctx.secrets.has(chave)) return ctx.secrets.get(chave);
  const value = generateSecret(24);
  await db.query(`INSERT INTO implantacao_segredos (implantacao_id, chave, valor_cifrado, origem) VALUES ($1,$2,$3,$4)
    ON CONFLICT (implantacao_id, chave) DO NOTHING`, [ctx.imp.id, chave, encrypt(value), origem]);
  const stored = await db.one('SELECT valor_cifrado FROM implantacao_segredos WHERE implantacao_id = $1 AND chave = $2', [ctx.imp.id, chave]);
  const final = decrypt(stored.valor_cifrado);
  ctx.secrets.set(chave, final);
  return final;
}

const databaseUrl = async (ctx) => {
  const pw = await ensureSecret(ctx, 'sistema:senha_banco', 'sistema');
  return `postgresql://${ctx.r.papelBanco}:${pw}@127.0.0.1:5432/${ctx.r.banco}`;
};

/** Monta as variáveis de ambiente a partir da receita (nomes vêm da receita validada). */
async function buildEnv(ctx) {
  const vars = {};
  for (const x of ctx.receita.variaveis) {
    switch (x.origem) {
      case 'fixo': vars[x.nome] = x.valor; break;
      case 'gerado': vars[x.nome] = await ensureSecret(ctx, `gerado:${x.nome}`); break;
      case 'banco': vars[x.nome] = await databaseUrl(ctx); break;
      case 'dominio': vars[x.nome] = ctx.dominio ? `https://${ctx.dominio.nome}` : ''; break;
      case 'host': vars[x.nome] = ctx.dominio?.nome || ''; break;
      case 'porta': vars[x.nome] = String(ctx.imp.porta); break;
      case 'cliente': vars[x.nome] = ctx.imp.dados_cliente[x.valor] ?? ''; break;
      case 'segredo': vars[x.nome] = ctx.secrets.get(`campo:${x.valor}`) ?? ''; break;
      default: throw new Error(`Origem desconhecida: ${x.origem}`);
    }
  }
  return vars;
}

async function runCommands(ctx, group, cwd, timeoutMs) {
  for (const argv of ctx.receita.comandos[group] || []) {
    await ctx.log('comando', `$ ${argv.join(' ')}`);
    const res = await ctx.executor.runAppCommand(ctx.r, argv, { cwd, timeoutMs, useEnvFile: cwd === ctx.r.current });
    if (res?.saida) await ctx.log('saida', res.saida);
  }
}

async function waitHttp(ctx, url, seconds = 60) {
  const until = Date.now() + seconds * 1000;
  let last = '';
  while (Date.now() < until) {
    const res = await ctx.executor.httpGet(url).catch((err) => ({ error: err.message }));
    if (res && !res.error && res.status < 500) return res;
    last = res?.error || `HTTP ${res?.status}`;
    await new Promise((r) => setTimeout(r, ctx.executor.pollMs ?? 2000));
  }
  throw new Error(`A aplicação não respondeu em ${url} (${last}). Veja ${ctx.r.logs}/app-erro.log.`);
}

const releaseDir = (ctx) => `${ctx.r.releases}/${ctx.imp.release_atual}`;

async function refreshDomain(ctx) {
  ctx.dominio = await db.one('SELECT * FROM dominios WHERE implantacao_id = $1', [ctx.imp.id]);
}

// ------------------------------------------------------------------ passos
const STEPS = {
  async verificar_requisitos(ctx) {
    const info = await ctx.executor.checkRequirements({ nodeMin: ctx.receita.node_versao_minima, requerBanco: ctx.receita.requer_banco, discoMb: ctx.receita.disco_mb });
    await ctx.log('info', `Servidor: ${Object.entries(info).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  },
  async criar_usuario(ctx) { await ctx.executor.ensureUser(ctx.r); },
  async preparar_diretorios(ctx) { await ctx.executor.prepareDirs(ctx.r, ctx.receita.diretorios_persistentes); },
  async obter_codigo(ctx) {
    const release = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    const token = ctx.receita.token_git_cifrado ? decrypt(ctx.receita.token_git_cifrado) : null;
    if (token) ctx.secretValues.push(token);
    const res = await ctx.executor.fetchCode(ctx.r, { url: ctx.receita.repositorio_url, ref: ctx.receita.referencia, token, release });
    await db.query('UPDATE implantacoes SET release_atual = $2, versao_instalada = $3 WHERE id = $1', [ctx.imp.id, release, res.commit || ctx.receita.referencia]);
    ctx.imp.release_atual = release;
    await ctx.log('info', `Código obtido de ${ctx.receita.repositorio_url} (${ctx.receita.referencia}${res.commit ? `, commit ${res.commit}` : ''}) em releases/${release}.`);
  },
  async criar_banco(ctx) {
    await databaseUrl(ctx);
    await ctx.executor.ensureDatabase(ctx.r, { password: ctx.secrets.get('sistema:senha_banco') });
    await ctx.log('info', `Banco ${ctx.r.banco} e papel ${ctx.r.papelBanco} prontos (sem privilégios de superusuário).`);
  },
  async gravar_env(ctx) {
    const vars = await buildEnv(ctx);
    ctx.secretValues.push(...ctx.secrets.values());
    await ctx.executor.writeEnv(ctx.r, vars);
    await ctx.log('info', `Variáveis gravadas em ${ctx.r.envFile} (permissão 600): ${Object.keys(vars).join(', ')}.`);
  },
  async instalar_dependencias(ctx) { await runCommands(ctx, 'instalacao', releaseDir(ctx), 20 * MIN); },
  async build(ctx) { await runCommands(ctx, 'build', releaseDir(ctx), 20 * MIN); },
  async ativar_versao(ctx) {
    await ctx.executor.activateRelease(ctx.r, { release: ctx.imp.release_atual, sharedDirs: ctx.receita.diretorios_persistentes });
    await ctx.log('info', `Versão ${ctx.imp.release_atual} ativada (${ctx.r.current}).`);
  },
  async backup_banco(ctx) {
    const res = await ctx.executor.backupDatabase(ctx.r, { motivo: 'antes das migrations' });
    if (res?.arquivo) {
      await db.query('INSERT INTO implantacao_backups (implantacao_id, arquivo, tamanho_bytes, motivo) VALUES ($1,$2,$3,$4)', [ctx.imp.id, res.arquivo, res.tamanho ?? null, 'Antes das migrations']);
      await ctx.log('info', `Backup gravado: ${res.arquivo}.`);
    }
  },
  async migracoes(ctx) { await runCommands(ctx, 'migracoes', ctx.r.current, 10 * MIN); },
  async seed(ctx) { await runCommands(ctx, 'seed', ctx.r.current, 10 * MIN); },
  async instalar_servico(ctx) {
    await ctx.executor.installService(ctx.r, { inicio: ctx.receita.comandos.inicio });
    await ctx.log('info', `Serviço ${ctx.r.servico} configurado (usuário ${ctx.r.usuario}).`);
  },
  async iniciar_aplicacao(ctx) {
    await ctx.executor.serviceAction(ctx.r, 'restart');
    await waitHttp(ctx, `http://127.0.0.1:${ctx.imp.porta}/`);
    await db.query('UPDATE implantacoes SET instalada_em = COALESCE(instalada_em, now()) WHERE id = $1', [ctx.imp.id]);
    await ctx.log('info', `Aplicação respondendo na porta interna ${ctx.imp.porta}.`);
  },
  async configurar_nginx(ctx) {
    if (!ctx.dominio) throw new Error('Implantação sem domínio.');
    await ctx.executor.writeNginx(ctx.r, { dominio: ctx.dominio.nome, porta: ctx.imp.porta, ssl: ctx.dominio.status_ssl === 'emitido', opcoes: ctx.receita.nginx_opcoes });
    await ctx.log('info', `Nginx: site ${ctx.r.nginxSite} validado (nginx -t) e recarregado. Outros sites não foram alterados.`);
  },
  async verificar_dns(ctx) {
    const res = await verifyDomain(ctx.imp.id);
    await ctx.log(res.status_dns === 'ok' ? 'info' : 'aviso', `DNS de ${res.nome}: ${res.mensagem}`);
    if (res.status_dns !== 'ok') throw new WaitingForCustomer(`O domínio ${res.nome} ainda não aponta para o servidor.\n${res.instrucoes || ''}`);
  },
  async emitir_ssl(ctx) {
    await ctx.executor.issueCertificate(ctx.r, { dominio: ctx.dominio.nome, email: env.implantacao.emailSsl });
    const info = await ctx.executor.certificateInfo(ctx.dominio.nome);
    await db.query("UPDATE dominios SET status_ssl = 'emitido', ssl_expira_em = $2, renovacao_automatica = $3, ssl_verificado_em = now() WHERE id = $1",
      [ctx.dominio.id, info.expira_em, info.renovacao_automatica]);
    await refreshDomain(ctx);
    await ctx.log('info', `Certificado emitido para ${ctx.dominio.nome}, válido até ${new Date(info.expira_em).toLocaleDateString('pt-BR')}. Renovação automática: ${info.renovacao_automatica ? 'ativa' : 'NÃO detectada'}.`);
  },
  async ativar_https(ctx) {
    await ctx.executor.writeNginx(ctx.r, { dominio: ctx.dominio.nome, porta: ctx.imp.porta, ssl: true, opcoes: ctx.receita.nginx_opcoes });
    await ctx.log('info', `HTTPS ativo em https://${ctx.dominio.nome} (HTTP redireciona para HTTPS).`);
  },
  async personalizar(ctx) {
    const vars = await buildEnv(ctx);
    ctx.secretValues.push(...ctx.secrets.values());
    await ctx.executor.writeEnv(ctx.r, vars);
    await runCommands(ctx, 'personalizacao', ctx.r.current, 10 * MIN);
    await ctx.executor.serviceAction(ctx.r, 'restart');
    await waitHttp(ctx, `http://127.0.0.1:${ctx.imp.porta}/`);
    await setEtapa(db, ctx.imp.id, 5, 'concluida', 'Dados do cliente aplicados.');
    await ctx.log('info', 'Personalização aplicada e aplicação reiniciada.');
  },
  async testes(ctx) { await runChecks(ctx); }
};

// ------------------------------------------------------------------ verificações
async function runChecks(ctx) {
  const results = [];
  const check = async (codigo, descricao, fn) => {
    try {
      const detail = await fn();
      results.push({ codigo, descricao, ok: true, detalhe: detail || null });
    } catch (err) {
      results.push({ codigo, descricao, ok: false, detalhe: maskSecrets(err.message, ctx.secretValues) });
    }
  };
  const { executor, r, imp } = ctx;
  await refreshDomain(ctx);
  const dominio = ctx.dominio?.nome;

  await check('aplicacao', 'Aplicação respondendo na porta interna', async () => {
    const res = await executor.httpGet(`http://127.0.0.1:${imp.porta}/`);
    if (res.error || res.status >= 500) throw new Error(res.error || `HTTP ${res.status}`);
    return `HTTP ${res.status}`;
  });
  await check('servico', 'Serviço da aplicação em execução', async () => {
    const st = await executor.serviceAction(r, 'is-active');
    if (st?.estado !== 'active') throw new Error(`Estado: ${st?.estado || 'desconhecido'}`);
    return st.estado;
  });
  if (ctx.receita.requer_banco) {
    await check('banco', 'Banco de dados conectado', async () => { await executor.dbPing(await databaseUrl(ctx)); return 'SELECT 1 executado'; });
  }
  if (ctx.receita.comandos.migracoes?.length) {
    await check('migracoes', 'Migrations executadas', async () => {
      const p = await db.one("SELECT status, concluido_em FROM implantacao_passos WHERE implantacao_id = $1 AND passo = 'migracoes'", [imp.id]);
      if (p?.status !== 'concluido') throw new Error('O passo de migrations não foi concluído.');
      return `Concluídas em ${new Date(p.concluido_em).toLocaleString('pt-BR')}`;
    });
  }
  await check('dns', 'Domínio apontando para o servidor', async () => {
    const res = await checkDns(dominio);
    if (res.status_dns !== 'ok') throw new Error(res.mensagem);
    return res.mensagem;
  });
  await check('ssl', 'Certificado SSL válido', async () => {
    const info = await executor.certificateInfo(dominio);
    const days = Math.floor((new Date(info.expira_em) - Date.now()) / 86_400_000);
    await db.query('UPDATE dominios SET ssl_expira_em = $2, renovacao_automatica = $3, ssl_verificado_em = now(), status_ssl = $4 WHERE implantacao_id = $1',
      [imp.id, info.expira_em, info.renovacao_automatica, days < 0 ? 'expirado' : days < 15 ? 'expirando' : 'emitido']);
    if (days < 7) throw new Error(`Expira em ${days} dia(s).`);
    return `Válido até ${new Date(info.expira_em).toLocaleDateString('pt-BR')} (${days} dias)`;
  });
  await check('renovacao', 'Renovação automática do certificado ativa', async () => {
    const info = await executor.certificateInfo(dominio);
    if (!info.renovacao_automatica) throw new Error('certbot.timer inativo: ative com systemctl enable --now certbot.timer.');
    return 'certbot.timer ativo';
  });
  await check('https', `Acesso público em https://${dominio}`, async () => {
    const res = await executor.httpGet(`https://${dominio}/`);
    if (res.error || res.status >= 500) throw new Error(res.error || `HTTP ${res.status}`);
    return `HTTP ${res.status}${res.simulado ? ' (simulado)' : ''}`;
  });
  for (const v of ctx.receita.verificacoes || []) {
    await check(`receita:${v.caminho}`.slice(0, 40), `Recurso ${v.caminho} responde ${v.status}`, async () => {
      const res = await executor.httpGet(`https://${dominio}${v.caminho}`);
      if (res.error) throw new Error(res.error);
      if (res.simulado) return 'simulado';
      if (res.status !== v.status) throw new Error(`Esperado ${v.status}, recebido ${res.status}.`);
      if (v.contem && !String(res.body || '').includes(v.contem)) throw new Error(`Resposta não contém "${v.contem}".`);
      return `HTTP ${res.status}`;
    });
  }
  for (const x of results) {
    await db.query('INSERT INTO implantacao_verificacoes (implantacao_id, tarefa_id, codigo, descricao, ok, detalhe) VALUES ($1,$2,$3,$4,$5,$6)',
      [imp.id, ctx.task.id, x.codigo, x.descricao, x.ok, x.detalhe]);
    await ctx.log(x.ok ? 'info' : 'erro', `${x.ok ? '✔' : '✖'} ${x.descricao}${x.detalhe ? ` — ${x.detalhe}` : ''}`);
  }
  const failed = results.filter((x) => !x.ok);
  if (failed.length) throw new Error(`${failed.length} de ${results.length} verificações falharam.`);
}

// ------------------------------------------------------------------ orquestração
async function stepsToRun(task) {
  const id = task.implantacao_id;
  if (task.tipo === 'reexecutar') {
    // Depois de mexer em qualquer passo, a validação precisa ser refeita antes da entrega.
    if (task.passo !== 'testes') await db.query("UPDATE implantacao_passos SET status = 'pendente', erro = NULL WHERE implantacao_id = $1 AND passo = 'testes' AND status = 'concluido'", [id]);
    return [task.passo];
  }
  if (task.tipo === 'testar') {
    await db.query("UPDATE implantacao_passos SET status = 'pendente', erro = NULL WHERE implantacao_id = $1 AND passo = 'testes'", [id]);
    return ['testes'];
  }
  if (task.tipo === 'personalizar') {
    await db.query("UPDATE implantacao_passos SET status = 'pendente', erro = NULL WHERE implantacao_id = $1 AND passo IN ('personalizar','testes')", [id]);
    return ['personalizar', 'testes'];
  }
  return (await db.many("SELECT passo FROM implantacao_passos WHERE implantacao_id = $1 AND status = 'pendente' ORDER BY ordem", [id])).map((p) => p.passo);
}

async function updateProgress(id) {
  await db.query(`UPDATE implantacoes SET progresso = LEAST(99, (SELECT (100 * count(*) FILTER (WHERE status = 'concluido') / GREATEST(count(*), 1))::int
    FROM implantacao_passos WHERE implantacao_id = $1)) WHERE id = $1`, [id]);
}

async function closeEtapaIfDone(id, etapa) {
  const left = await db.one("SELECT count(*)::int AS n FROM implantacao_passos WHERE implantacao_id = $1 AND etapa = $2 AND status NOT IN ('concluido','ignorado')", [id, etapa]);
  if (!left.n && etapa !== 5) await setEtapa(db, id, etapa, 'concluida', null);
}

/** Executa uma tarefa já reivindicada da fila. Nunca lança: o resultado fica no banco. */
export async function runTask(task, { executor }) {
  const id = task.implantacao_id;
  const imp = await db.one('SELECT * FROM implantacoes WHERE id = $1', [id]);
  const receita = await db.one('SELECT * FROM receitas_implantacao WHERE id = $1', [imp.receita_id]);
  const ctx = {
    task, imp, receita, executor, r: resourcesFor(imp.slug),
    dominio: await db.one('SELECT * FROM dominios WHERE implantacao_id = $1', [id]),
    secrets: await loadSecrets(id), secretValues: [], passo: null
  };
  ctx.secretValues.push(...ctx.secrets.values());
  ctx.log = (nivel, msg) => addLog(db, id, nivel, maskSecrets(msg, ctx.secretValues), { tarefaId: task.id, passo: ctx.passo });
  const beat = setInterval(() => heartbeat(task.id).catch(() => {}), 10_000);
  beat.unref?.();

  try {
    if (['entregue', 'cancelada'].includes(imp.status)) throw new Error('Implantação encerrada.');
    const steps = await stepsToRun(task);
    await ctx.log('info', `Tarefa #${task.id} iniciada (${task.tipo}${task.tentativas > 1 ? `, tentativa ${task.tentativas}` : ''}). Passos: ${steps.map((s) => PASSO_ROTULO[s] || s).join(' → ') || 'nenhum'}.`);
    for (const passo of steps) {
      const meta = await db.one('SELECT etapa FROM implantacao_passos WHERE implantacao_id = $1 AND passo = $2', [id, passo]);
      if (!meta || !STEPS[passo]) throw new Error(`Passo desconhecido: ${passo}`);
      ctx.passo = passo;
      await db.query("UPDATE implantacao_passos SET status = 'executando', tentativas = tentativas + 1, iniciado_em = now(), erro = NULL WHERE implantacao_id = $1 AND passo = $2", [id, passo]);
      await db.query("UPDATE implantacoes SET etapa_atual = $2, status = 'em_execucao' WHERE id = $1", [id, meta.etapa]);
      await setEtapa(db, id, meta.etapa, 'em_andamento', PASSO_ROTULO[passo]);
      await ctx.log('info', `▶ ${PASSO_ROTULO[passo]}`);
      try {
        await STEPS[passo](ctx);
      } catch (err) {
        const msg = maskSecrets(err.message || String(err), ctx.secretValues);
        if (err instanceof WaitingForCustomer) {
          await db.query("UPDATE implantacao_passos SET status = 'aguardando', erro = $3 WHERE implantacao_id = $1 AND passo = $2", [id, passo, msg]);
          await setEtapa(db, id, meta.etapa, 'aguardando_cliente', msg);
          await db.query("UPDATE implantacoes SET status = 'aguardando_cliente' WHERE id = $1", [id]);
          await ctx.log('aviso', `⏸ Aguardando o cliente: ${msg}`);
          await finishTask(task.id, 'aguardando', msg);
          return;
        }
        await db.query("UPDATE implantacao_passos SET status = 'falhou', erro = $3 WHERE implantacao_id = $1 AND passo = $2", [id, passo, msg]);
        await setEtapa(db, id, meta.etapa, 'falhou', `${PASSO_ROTULO[passo]}: ${msg}`);
        await db.query("UPDATE implantacoes SET status = 'falhou' WHERE id = $1", [id]);
        await ctx.log('erro', `✖ ${PASSO_ROTULO[passo]} falhou: ${msg}`);
        await finishTask(task.id, 'falhou', msg);
        return;
      }
      await db.query("UPDATE implantacao_passos SET status = 'concluido', concluido_em = now() WHERE implantacao_id = $1 AND passo = $2", [id, passo]);
      await updateProgress(id);
      await closeEtapaIfDone(id, meta.etapa);
      await ctx.log('info', `✔ ${PASSO_ROTULO[passo]}`);
    }
    ctx.passo = null;
    const left = await db.one("SELECT count(*)::int AS n FROM implantacao_passos WHERE implantacao_id = $1 AND status NOT IN ('concluido','ignorado')", [id]);
    if (!left.n) {
      await db.query("UPDATE implantacoes SET status = 'pronta_para_entrega', etapa_atual = 7 WHERE id = $1", [id]);
      await setEtapa(db, id, 7, 'aguardando_tecnico', 'Tudo verificado: registre a entrega.');
      await ctx.log('info', 'Instalação concluída e verificada. Pronta para entrega.');
    } else {
      await db.query("UPDATE implantacoes SET status = 'aguardando_tecnico' WHERE id = $1", [id]);
      await ctx.log('info', 'Tarefa concluída. Há passos pendentes: use "Continuar implantação".');
    }
    await finishTask(task.id, 'concluida');
  } catch (err) {
    const msg = maskSecrets(err.message || String(err), ctx.secretValues);
    await addLog(db, id, 'erro', `Erro inesperado na tarefa #${task.id}: ${msg}`, { tarefaId: task.id });
    await db.query("UPDATE implantacao_passos SET status = 'falhou', erro = $2 WHERE implantacao_id = $1 AND status = 'executando'", [id, msg]);
    await db.query("UPDATE implantacoes SET status = 'falhou' WHERE id = $1 AND status NOT IN ('entregue','cancelada')", [id]);
    await finishTask(task.id, 'falhou', msg);
  } finally {
    clearInterval(beat);
  }
}
