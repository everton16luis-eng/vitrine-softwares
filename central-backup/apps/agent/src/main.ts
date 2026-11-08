// central-agent — uso:
//   central-agent enroll --url https://central.exemplo.com.br:8443 --ca-sha256 <hash> --code XXXX-XXXX-...
//   central-agent run
//   central-agent status
import { parseArgs } from 'node:util';
import { Agent, enroll, EXIT_REVOKED } from './agent.ts';
import { AgentState, LocalQueue } from './state.ts';

const [cmd, ...rest] = process.argv.slice(2);

async function main(): Promise<number> {
  switch (cmd) {
    case 'enroll': {
      const { values } = parseArgs({ args: rest, options: { url: { type: 'string' }, 'ca-sha256': { type: 'string' }, code: { type: 'string' } } });
      // o código também pode vir por variável de ambiente, para não ficar no histórico do shell
      const code = values.code ?? process.env.CENTRAL_ENROLL_CODE;
      if (!values.url || !values['ca-sha256'] || !code) {
        console.error('Uso: central-agent enroll --url <https://central:8443> --ca-sha256 <hash> --code <código>');
        return 2;
      }
      await enroll({ url: values.url, caSha256: values['ca-sha256'], code });
      console.log('Registro concluído. Inicie o serviço: sudo systemctl enable --now central-agent');
      return 0;
    }
    case 'run': {
      const agent = new Agent();
      for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { void agent.stop(); });
      console.log(`[central-agent] iniciado (${agent.agentId}).`);
      try {
        const code = await agent.run();
        // última tentativa de entregar resultados antes de sair
        await agent.flushResults().catch(() => {});
        return code;
      } finally { agent.close(); }
    }
    case 'status': {
      const state = new AgentState();
      if (!state.isEnrolled()) { console.log(`Não registrado (${state.dir}).`); return 1; }
      const c = state.config();
      const q = new LocalQueue(state.file('state.db'));
      console.log(JSON.stringify({ agent_id: c.agent_id, gateway: c.gateway_url, registrado_em: c.enrolled_at, resultados_pendentes: q.pending() }, null, 2));
      q.close();
      return 0;
    }
    default:
      console.error('Comandos: enroll | run | status');
      return 2;
  }
}

/** Falhas de conexão (ex.: "localhost" com IPv6 e IPv4 recusados) chegam como AggregateError sem mensagem. */
function describe(err: unknown): string {
  const e = err as Error & { code?: string; errors?: Error[] };
  if (e.message) return e.message;
  if (e.errors?.length) return e.errors.map((x) => (x as Error & { code?: string }).code ? `${(x as Error & { code?: string }).code}: ${x.message}` : x.message).join('; ');
  return e.code || String(err);
}

main().then((code) => { process.exitCode = code; }, (err) => {
  console.error(`[central-agent] ${describe(err)}`);
  process.exitCode = (err as Error).message.includes('recusou') ? EXIT_REVOKED : 1;
});
